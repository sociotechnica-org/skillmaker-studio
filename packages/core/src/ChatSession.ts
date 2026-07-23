/**
 * The chat surface's session driver (D9): a LONG-LIVED, multi-prompt ACP
 * session against a provider adapter, in contrast to `runAcpSession`'s
 * one-shot spawn -> prompt -> close lifecycle. Built on the same
 * `AcpClient` wire client, the same typed `AcpError` union, and the same
 * failure classification -- extended with what a conversation needs:
 *
 * - **Resume via the provider's own session model.** ACP `session/load` is
 *   attempted when (a) the caller carries a previously persisted provider
 *   session id and (b) `initialize` advertised `agentCapabilities.
 *   loadSession: true`. On load, the agent replays the whole prior
 *   conversation as `session/update` notifications before answering -- so
 *   the caller's `onUpdate` stream sees history arrive first, and
 *   skillmaker never needs a transcript store of its own. When the
 *   capability is absent or the load fails (expired/unknown id), the
 *   session falls back to a FRESH `session/new` and reports that honestly
 *   via `resumed: false` + `resumeFallback` -- a chat that opens fresh is
 *   better than a chat that refuses to open.
 * - **Streamed updates via callback**: every `session/update` notification
 *   is pushed through `onUpdate` as it arrives (structured method/params,
 *   not raw wire frames).
 * - **Serialized prompts**: one turn at a time. A `prompt()` while another
 *   is in flight fails immediately with `ChatBusyError` -- queueing is the
 *   caller's decision to make visibly (the server rejects with 409), never
 *   something this driver does silently.
 * - **Interactive permissions**: `makeChatPermissionPolicy` auto-approves
 *   any request whose referenced paths all stay inside the project
 *   directory (the "comfortable Claude Code session" ruling -- the chat
 *   agent works DIRECTLY in the project, so in-project effects are its
 *   job), and forwards anything reaching outside to the caller's async
 *   `ask` handler -- the server renders that in the browser as an inline
 *   approve/deny card, and the returned Promise settles when the human
 *   answers (or the session tears down: `cancelled`).
 */
import { Effect, Schema } from "effect";
import {
  AcpClient,
  classifyAcpFailure,
  extractPermissionOptions,
  permissionPathsOutside,
  pickApproveOption,
  type AcpError,
  type PermissionPolicy,
  type PermissionPolicyResult,
  type TranscriptEntry,
} from "./AcpClient.ts";
import { buildPromptBlocks, type ChatImageAttachment } from "./ChatCapabilities.ts";
import { CLAUDE_CODE_PROFILE, type ProviderProfile } from "./ProviderProfile.ts";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A `prompt()` arrived while another turn is still in flight. The caller decides queue-vs-reject semantics; the driver only refuses to interleave. */
export class ChatBusyError extends Schema.TaggedErrorClass<ChatBusyError>()("ChatBusyError", {
  message: Schema.String,
}) {}

/** The session has been closed (or its adapter process died); no further prompts are possible. Carries whether the adapter exited on its own. */
export class ChatClosedError extends Schema.TaggedErrorClass<ChatClosedError>()("ChatClosedError", {
  message: Schema.String,
  adapterExited: Schema.Boolean,
}) {}

export type ChatSessionError = AcpError | ChatBusyError | ChatClosedError;

// ---------------------------------------------------------------------------
// Interactive permission policy (the D9 ruling)
// ---------------------------------------------------------------------------

/**
 * What the browser (via the server) answers a forwarded permission request
 * with: one of the agent's offered optionIds, plus whether that choice is
 * an approval or a refusal (for the transcript's synthetic record).
 */
export interface ChatPermissionAnswer {
  readonly optionId: string;
  readonly decision: "allowed" | "denied";
}

/**
 * Asks the human about one out-of-project permission request. `outside`
 * names the offending paths so the UI can say WHY this one needs a human.
 * Resolving settles the agent's pending `session/request_permission`;
 * the handler may also resolve with `"cancelled"` when the pending request
 * is torn down (session closed) before anyone answered.
 */
export type ChatPermissionAsk = (request: {
  readonly params: unknown;
  readonly outside: ReadonlyArray<{ readonly origin: string; readonly value: string }>;
}) => Promise<ChatPermissionAnswer | "cancelled">;

/**
 * The ruled chat permission policy: NOT the run-engine's deny-by-default
 * and NOT dangerously-skip. Operations whose every referenced path stays
 * inside `projectDir` auto-approve (same syntactic path collection as
 * `makeSandboxPermissionPolicy`, same realpath tolerance); anything
 * reaching outside forwards to `ask` and waits for the human.
 */
export const makeChatPermissionPolicy = (
  projectDir: string,
  ask: ChatPermissionAsk,
): PermissionPolicy => {
  return (params): PermissionPolicyResult | Promise<PermissionPolicyResult> => {
    const options = extractPermissionOptions(params);
    const outside = permissionPathsOutside(projectDir, params);
    if (outside.length === 0) {
      const option = pickApproveOption(options);
      return {
        optionId: option.optionId,
        decision: "allowed",
        reason: "auto-approved: every referenced path stays inside the project directory",
      };
    }
    const summary = outside
      .slice(0, 3)
      .map((candidate) => `${candidate.value} (${candidate.origin})`)
      .join(", ");
    return ask({ params, outside }).then((answer) =>
      answer === "cancelled"
        ? { cancelled: true, reason: `pending permission request torn down before a human answered (${summary})` }
        : {
            optionId: answer.optionId,
            decision: answer.decision,
            reason: `human ${answer.decision === "allowed" ? "approved" : "denied"} a request referencing path(s) outside the project: ${summary}`,
          },
    );
  };
};

// ---------------------------------------------------------------------------
// Session driver
// ---------------------------------------------------------------------------

export interface ChatSessionOptions {
  /** The adapter command, e.g. `["npx", "-y", "@zed-industries/claude-code-acp@latest"]`. */
  readonly command: ReadonlyArray<string>;
  /** The PROJECT ROOT -- the D9 ruling: the chat agent works direct in the project, no sandbox, no copyback. */
  readonly cwd: string;
  /** Extra env for the adapter subprocess (the agent-home `configDirEnvVar` injection lives here). */
  readonly env?: Readonly<Record<string, string>>;
  /** A previously persisted provider session id to resume via `session/load`. Absent -> always a fresh session. */
  readonly resumeSessionId?: string;
  /**
   * A WIRE model id to apply right after the session opens (new or
   * resumed), via ACP `session/set_model` -- for codex this is the
   * bracketed `model[effort]` form (see ChatCapabilities.composeModelId).
   * Applying at start IS the protocol's model-at-start door: neither
   * shipped adapter takes a model in `session/new` params, but both honor
   * `set_model` before the first prompt. A failed set_model degrades to
   * the adapter's default with `modelFallback` set -- an open chat on the
   * default model beats a refused session.
   */
  readonly modelId?: string;
  /** Every `session/update` notification's params, streamed as it arrives (including `session/load`'s history replay). */
  readonly onUpdate: (update: unknown) => void;
  /** Decides every `session/request_permission` -- typically `makeChatPermissionPolicy`. */
  readonly permissionPolicy: PermissionPolicy;
  /** Raw wire observer, same shape the engines persist as transcript.jsonl. Optional: chat keeps no transcript store of its own. */
  readonly onTranscript?: (entry: TranscriptEntry) => void;
  /** Called once if the adapter process exits while the session is supposed to be alive. */
  readonly onAdapterExit?: (exitCode: number | null) => void;
  readonly providerProfile?: ProviderProfile;
}

export interface ChatSessionHandle {
  /** The provider's session id -- persist this (with the provider id) to resume later. */
  readonly sessionId: string;
  /** True when this session resumed a prior conversation via `session/load`. */
  readonly resumed: boolean;
  /** Set when a resume was REQUESTED but a fresh session was started instead; says why (capability absent / load failed). */
  readonly resumeFallback: string | undefined;
  /** `initialize`'s advertised agent capabilities (e.g. `loadSession`), for callers that report them. */
  readonly loadSessionSupported: boolean;
  /** `session/new`'s advertised model, provider-resolved; null when unavailable. */
  readonly model: string | null;
  /** The wire model id in effect: the requested `modelId` when set_model succeeded, else the adapter's own current id (or null). */
  readonly modelId: string | null;
  /** Set when a requested `modelId` could NOT be applied (set_model failed); the session runs on the adapter's default and this says why. */
  readonly modelFallback: string | undefined;
  /** Adapter subprocess pid, for best-effort orphan cleanup bookkeeping. */
  readonly pid: number | undefined;
  /** Sends one prompt turn (optionally with image attachments as ACP image content blocks); resolves with the turn's stop reason. Fails with `ChatBusyError` if a turn is in flight, `ChatClosedError` after close/adapter death. */
  readonly prompt: (
    text: string,
    images?: ReadonlyArray<ChatImageAttachment>,
  ) => Effect.Effect<{ readonly stopReason: string }, ChatSessionError>;
  /** Mid-session ACP `session/set_model` (both shipped adapters honor it; codex takes the bracketed `model[effort]` form). Rejects while a turn is in flight. */
  readonly setModel: (modelId: string) => Effect.Effect<void, ChatSessionError>;
  /** ACP `session/cancel` for the in-flight turn (no-op when idle): the running `prompt` then resolves with `stopReason: "cancelled"`. */
  readonly cancel: () => void;
  /** True while a prompt turn is in flight. */
  readonly busy: () => boolean;
  /** Tears the session down (adapter subprocess included). Idempotent. */
  readonly close: () => Promise<void>;
}

/**
 * Spawns the adapter and establishes one live chat session:
 * spawn -> initialize -> (session/load | session/new). The returned handle
 * stays valid until `close()` -- the caller (the CLI server's
 * ChatSessionManager) owns its lifetime, idle reaping included. Failures
 * during establishment tear the subprocess down before failing.
 */
export const startChatSession = Effect.fn("ChatSession.start")(function* (
  opts: ChatSessionOptions,
) {
  const providerProfile = opts.providerProfile ?? CLAUDE_CODE_PROFILE;
  const client = new AcpClient({
    command: opts.command,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.onTranscript !== undefined ? { onTranscript: opts.onTranscript } : {}),
    onNotification: (method, params) => {
      if (method === "session/update") opts.onUpdate(params);
    },
    permissionPolicy: opts.permissionPolicy,
    // No prompt timeout: a chat turn legitimately runs as long as the human
    // lets it; cancellation is explicit (session/cancel), never a clock.
  });

  let closed = false;
  let adapterDied = false;

  const established = yield* Effect.tryPromise({
    try: async () => {
      await client.spawn();

      // Observe the adapter dying out from under a live session -- a chat
      // panel needs to show "agent exited", not silently hang forever.
      void client.exited().then((exitCode) => {
        adapterDied = true;
        if (!closed) opts.onAdapterExit?.(exitCode);
      });

      const init = await client.initialize();
      const loadSessionSupported = readLoadSessionCapability(init);

      let sessionId: string;
      let resumed = false;
      let resumeFallback: string | undefined;
      let model: string | null = null;
      let currentModelId: string | null = null;

      const readWireModelId = (session: unknown): string | null => {
        if (typeof session !== "object" || session === null) return null;
        const models = (session as { readonly models?: { readonly currentModelId?: unknown } }).models;
        return typeof models?.currentModelId === "string" ? models.currentModelId : null;
      };

      if (opts.resumeSessionId !== undefined && loadSessionSupported) {
        try {
          const loaded = await client.loadSession(opts.resumeSessionId, opts.cwd);
          sessionId = opts.resumeSessionId;
          resumed = true;
          // Both shipped adapters return the models state on session/load
          // too (same shape as session/new) -- read it tolerantly.
          currentModelId = readWireModelId(loaded);
        } catch (loadErr) {
          // A dead/expired/unknown session id is an expected lifecycle
          // event (provider session stores get pruned), not a fault:
          // fall back to a fresh session and say so.
          resumeFallback = `session/load failed (${loadErr instanceof Error ? loadErr.message : String(loadErr)}); started a fresh session`;
          const session = await client.newSession(opts.cwd);
          sessionId = session.sessionId;
          model = providerProfile.extractModel(session);
          currentModelId = readWireModelId(session);
        }
      } else {
        if (opts.resumeSessionId !== undefined) {
          resumeFallback = "adapter does not advertise the loadSession capability; started a fresh session";
        }
        const session = await client.newSession(opts.cwd);
        sessionId = session.sessionId;
        model = providerProfile.extractModel(session);
        currentModelId = readWireModelId(session);
      }

      // Model-at-start: apply the caller's choice via session/set_model
      // right after the session opens (there is no model param in
      // session/new -- see ChatCapabilities.ts). A failure degrades to the
      // adapter's default, honestly reported.
      let modelFallback: string | undefined;
      if (opts.modelId !== undefined && opts.modelId !== currentModelId) {
        try {
          await client.setModel(sessionId, opts.modelId);
          currentModelId = opts.modelId;
          model = opts.modelId;
        } catch (setErr) {
          modelFallback = `session/set_model(${opts.modelId}) failed (${setErr instanceof Error ? setErr.message : String(setErr)}); the session runs on the adapter's default model`;
        }
      } else if (opts.modelId !== undefined) {
        // Already the adapter's current model -- nothing to do, but the
        // handle should still report the requested id as in effect.
        model = model ?? opts.modelId;
      }

      return { sessionId, resumed, resumeFallback, loadSessionSupported, model, currentModelId, modelFallback };
    },
    catch: (err) => classifyAcpFailure(err, client.getStderr(), providerProfile),
  }).pipe(
    // Establishment failed -> never leak the subprocess.
    Effect.tapError(() => Effect.promise(() => client.close())),
  );

  let inFlight = false;
  let liveModelId = established.currentModelId;

  const failIfUnavailable = (): ChatClosedError | ChatBusyError | undefined => {
    if (closed || adapterDied) {
      return ChatClosedError.make({
        message: adapterDied ? "the adapter process exited" : "the chat session is closed",
        adapterExited: adapterDied,
      });
    }
    if (inFlight) {
      return ChatBusyError.make({ message: "a prompt turn is already in flight for this session" });
    }
    return undefined;
  };

  const prompt = Effect.fn("ChatSession.prompt")(function* (
    text: string,
    images: ReadonlyArray<ChatImageAttachment> = [],
  ) {
    const unavailable = failIfUnavailable();
    if (unavailable !== undefined) return yield* Effect.fail(unavailable);
    inFlight = true;
    return yield* Effect.tryPromise({
      try: () =>
        client.prompt(
          established.sessionId,
          images.length === 0 ? text : buildPromptBlocks(text, images),
        ),
      catch: (err) => classifyAcpFailure(err, client.getStderr(), providerProfile),
    }).pipe(Effect.ensuring(Effect.sync(() => {
      inFlight = false;
    })));
  });

  const setModel = Effect.fn("ChatSession.setModel")(function* (modelId: string) {
    const unavailable = failIfUnavailable();
    if (unavailable !== undefined) return yield* Effect.fail(unavailable);
    yield* Effect.tryPromise({
      try: () => client.setModel(established.sessionId, modelId),
      catch: (err) => classifyAcpFailure(err, client.getStderr(), providerProfile),
    });
    liveModelId = modelId;
  });

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.close();
  };

  return {
    sessionId: established.sessionId,
    resumed: established.resumed,
    resumeFallback: established.resumeFallback,
    loadSessionSupported: established.loadSessionSupported,
    model: established.model,
    get modelId() {
      return liveModelId;
    },
    modelFallback: established.modelFallback,
    pid: client.getPid(),
    prompt,
    setModel,
    cancel: () => {
      if (!closed && !adapterDied) client.cancel(established.sessionId);
    },
    busy: () => inFlight,
    close,
  } satisfies ChatSessionHandle;
});

/** Reads `agentCapabilities.loadSession` out of an `initialize` result, tolerantly: absent/malformed -> false (the spec's default). */
const readLoadSessionCapability = (init: unknown): boolean => {
  if (typeof init !== "object" || init === null) return false;
  const caps = (init as { readonly agentCapabilities?: unknown }).agentCapabilities;
  if (typeof caps !== "object" || caps === null) return false;
  return (caps as { readonly loadSession?: unknown }).loadSession === true;
};
