/**
 * The ACP (Agent Client Protocol) client — drives a provider adapter (e.g.
 * `@zed-industries/claude-code-acp`) as a subprocess over ndjson JSON-RPC.
 *
 * Productionized from the Phase-8 prep spike (`git show
 * spike-acp-client:spike/acp-client.ts`, `spike/FINDINGS.md`) — adapted, not
 * imported: the wire protocol, env-stripping, and infra/task classification
 * are all empirically proven against `claude-code-acp@0.16.2`. Kept as a
 * standalone module (Bun built-ins only, no `@agentclientprotocol/sdk`
 * dependency) exactly like the spike, since the spike found that a
 * hand-rolled client is small enough not to need the SDK.
 *
 * The low-level `AcpClient` class is Promise-based (JSON-RPC is inherently a
 * long-lived bidirectional connection, awkward to express as a single Effect
 * value). `runAcpSession` is the Effect-native entry point `RunEngine.ts`
 * actually calls: it drives the whole spawn -> initialize -> newSession ->
 * prompt -> close lifecycle as one `Effect.tryPromise`, classifying every
 * failure into one of four typed, schema-backed errors that carry enough
 * context (stderr, JSON-RPC code, a `likelyInfra` hint) for `RunEngine` to
 * decide `infra-error` vs `failed` (data-model.md §2.8).
 */
import { Schema } from "effect";
import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Env stripping (spike/FINDINGS.md "Critical, non-obvious gotcha")
// ---------------------------------------------------------------------------

/**
 * Env vars that must never reach the spawned adapter process: `CLAUDECODE`
 * (and anything else prefixed `CLAUDE_CODE_`) leaks in whenever the engine
 * itself runs inside a Claude-Code-driven process (a dev's own Claude Code
 * session, or a Fabro/agent station driving `skillmaker run`), and trips
 * the underlying `claude` CLI's own nested-session guard — surfacing as an
 * opaque JSON-RPC `-32603 Internal error`, with the real cause only visible
 * in the adapter's stderr. Stripping unconditionally (not just the four vars
 * the spike named, but the whole `CLAUDE_CODE_*` family) is the fix.
 */
export const stripClaudeCodeEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE") continue;
    if (key.startsWith("CLAUDE_CODE_")) continue;
    out[key] = value;
  }
  return out;
};

// ---------------------------------------------------------------------------
// JSON-RPC wire types
// ---------------------------------------------------------------------------

export type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcErrorMessage {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcInbound = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcErrorMessage;

function isResponse(msg: JsonRpcInbound): msg is JsonRpcSuccess | JsonRpcErrorMessage {
  return "id" in msg && !("method" in msg);
}
function isRequest(msg: JsonRpcInbound): msg is JsonRpcRequest {
  return "id" in msg && "method" in msg;
}
function isNotification(msg: JsonRpcInbound): msg is JsonRpcNotification {
  return !("id" in msg) && "method" in msg;
}

/**
 * Every raw JSON-RPC message in wire order, tagged with a wall-clock
 * timestamp and direction. `"synthetic"` entries are runner-injected
 * commentary (currently: auto-approved permission decisions) clearly marked
 * so a human reading `transcript.jsonl` later can tell real protocol traffic
 * from out-of-band decisions (spike/FINDINGS.md).
 */
export interface TranscriptEntry {
  readonly t: string;
  readonly dir: "send" | "recv" | "synthetic";
  readonly message: unknown;
}

// ---------------------------------------------------------------------------
// Typed errors (Effect boundary)
// ---------------------------------------------------------------------------

/** The adapter process could not be spawned, or exited before the handshake completed. Always infra. */
export class AcpSpawnError extends Schema.TaggedErrorClass<AcpSpawnError>()("AcpSpawnError", {
  message: Schema.String,
  stderr: Schema.String,
}) {}

/** JSON-RPC code `-32000` (or an equivalent "please /login" signal): auth is missing. Always infra. */
export class AcpAuthError extends Schema.TaggedErrorClass<AcpAuthError>()("AcpAuthError", {
  message: Schema.String,
  stderr: Schema.String,
}) {}

/**
 * A JSON-RPC error the adapter itself raised for a reason other than auth,
 * or a connection drop mid-flight. `likelyInfra` is set when the captured
 * stderr matches a known infra-fault signature (e.g. the nested-session
 * guard) -- callers should treat that as infra-error; otherwise treat it as
 * a task-level failure (data-model.md §2.8, spike/FINDINGS.md's classification table).
 */
export class AcpProtocolError extends Schema.TaggedErrorClass<AcpProtocolError>()(
  "AcpProtocolError",
  {
    message: Schema.String,
    code: Schema.optionalKey(Schema.Number),
    stderr: Schema.String,
    likelyInfra: Schema.Boolean,
  },
) {}

/** `session/prompt` exceeded its wall-clock budget; the process is killed. Treated as infra (spike/FINDINGS.md open question #2 -- re-litigate once there's a real timeout corpus). */
export class AcpTimeoutError extends Schema.TaggedErrorClass<AcpTimeoutError>()(
  "AcpTimeoutError",
  {
    message: Schema.String,
    timeoutMs: Schema.Number,
    stderr: Schema.String,
  },
) {}

export type AcpError = AcpSpawnError | AcpAuthError | AcpProtocolError | AcpTimeoutError;

/** Internal-only: mirrors the spike's InfraError/TaskError split before classification into the typed Acp*Error union above. */
class InfraFault extends Error {
  constructor(
    public readonly reason: "spawn" | "auth" | "connection" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "InfraFault";
  }
}

class TaskFault extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "TaskFault";
  }
}

const JSON_RPC_AUTH_REQUIRED_CODE = -32000;

/**
 * Stderr substrings known (from real runs) to indicate an infra fault even
 * when the JSON-RPC layer reports an ambiguous internal error. Kept small
 * and grown from real Phase-8 failures rather than guessed broadly
 * (spike/FINDINGS.md's explicit recommendation).
 */
const INFRA_STDERR_SIGNATURES: ReadonlyArray<string> = [
  "cannot be launched inside another Claude Code session",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "npm ERR!",
];

const stderrLooksInfra = (stderr: string): boolean =>
  INFRA_STDERR_SIGNATURES.some((signature) => stderr.includes(signature));

// ---------------------------------------------------------------------------
// Low-level client (Promise-based; see module doc for why)
// ---------------------------------------------------------------------------

export interface AcpClientOptions {
  readonly command: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly onTranscript?: (entry: TranscriptEntry) => void;
  readonly promptTimeoutMs?: number;
  readonly onPermissionRequest?: (params: unknown) => string;
}

interface PermissionOption {
  readonly optionId: string;
  readonly kind: string;
}

interface NewSessionResult {
  readonly sessionId: string;
  readonly models?: { readonly currentModelId?: string; readonly availableModels?: ReadonlyArray<{ readonly modelId: string; readonly description?: string }> };
  readonly [key: string]: unknown;
}

export class AcpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<
    JsonRpcId,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readLoopDone: Promise<void> | null = null;
  private stderrChunks: string[] = [];
  private closed = false;
  private connectionError: Error | null = null;

  constructor(private readonly opts: AcpClientOptions) {}

  getStderr(): string {
    return this.stderrChunks.join("");
  }

  /** Spawn the adapter subprocess and start the ndjson read loop. Does NOT perform `initialize` — call that after. */
  async spawn(): Promise<void> {
    const env = stripClaudeCodeEnv({ ...process.env, ...(this.opts.env ?? {}) });
    try {
      this.proc = Bun.spawn({
        cmd: [...this.opts.command],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
    } catch (err) {
      throw new InfraFault("spawn", `failed to spawn adapter: ${(err as Error).message}`);
    }

    if (!this.proc.stdin || !this.proc.stdout) {
      throw new InfraFault("spawn", "adapter process missing stdio pipes");
    }

    void this.drainStderr();
    this.readLoopDone = this.readLoop().catch((err) => {
      this.connectionError = err instanceof Error ? err : new Error(String(err));
    });

    const exitedEarly = await Promise.race([
      this.proc.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800)),
    ]);
    if (exitedEarly) {
      const code = this.proc.exitCode;
      throw new InfraFault(
        "spawn",
        `adapter exited immediately (code ${code}) before handshake. stderr: ${this.getStderr().slice(0, 2000)}`,
      );
    }
  }

  private async drainStderr(): Promise<void> {
    if (!this.proc?.stderr) return;
    const reader = (this.proc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.stderrChunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // process torn down; ignore
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.proc?.stdout) return;
    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg: JsonRpcInbound;
          try {
            msg = JSON.parse(trimmed) as JsonRpcInbound;
          } catch {
            this.connectionError = new InfraFault(
              "connection",
              `non-JSON line on adapter stdout: ${trimmed.slice(0, 200)}`,
            );
            continue;
          }
          this.handleInbound(msg);
        }
      }
    } finally {
      reader.releaseLock();
      const closeErr = new InfraFault("connection", "adapter closed stdout (connection ended)");
      for (const [, p] of this.pending) p.reject(closeErr);
      this.pending.clear();
    }
  }

  private recordTranscript(dir: TranscriptEntry["dir"], message: unknown): void {
    this.opts.onTranscript?.({ t: new Date().toISOString(), dir, message });
  }

  private handleInbound(msg: JsonRpcInbound): void {
    this.recordTranscript("recv", msg);

    if (isResponse(msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if ("error" in msg) {
        const e = msg.error;
        if (e.code === JSON_RPC_AUTH_REQUIRED_CODE) {
          pending.reject(new InfraFault("auth", e.message));
        } else {
          pending.reject(new TaskFault(e.message, e.code, e.data));
        }
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (isRequest(msg)) {
      void this.respondToInboundRequest(msg);
      return;
    }

    if (isNotification(msg)) {
      // session/update lands here; the caller observes it via onTranscript.
      return;
    }
  }

  private async respondToInboundRequest(req: JsonRpcRequest): Promise<void> {
    try {
      let result: unknown;
      if (req.method === "session/request_permission") {
        const optionId = this.decidePermission(req.params);
        this.recordTranscript("synthetic", {
          type: "permission_decision",
          method: req.method,
          optionId,
        });
        result = { outcome: { outcome: "selected", optionId } };
      } else {
        // We do not advertise fs/terminal client capabilities (see
        // initialize()), so the agent should not call fs/* or terminal/* on
        // us. Decline politely rather than hanging the agent.
        this.sendResponseError(req.id, -32601, `Method not found: ${req.method}`);
        return;
      }
      this.sendResponseResult(req.id, result);
    } catch (err) {
      this.sendResponseError(req.id, -32603, (err as Error).message);
    }
  }

  private decidePermission(params: unknown): string {
    if (this.opts.onPermissionRequest) return this.opts.onPermissionRequest(params);
    const options: ReadonlyArray<PermissionOption> =
      params !== null && typeof params === "object" && "options" in params
        ? ((params as { readonly options?: ReadonlyArray<PermissionOption> }).options ?? [])
        : [];
    const preferred =
      options.find((o) => o.kind === "allow_once") ??
      options.find((o) => o.kind === "allow_always") ??
      options[0];
    if (!preferred) throw new Error("no permission options offered");
    return preferred.optionId;
  }

  private sendResponseResult(id: JsonRpcId, result: unknown): void {
    const msg = { jsonrpc: "2.0" as const, id, result };
    this.recordTranscript("send", msg);
    this.writeRaw(msg);
  }

  private sendResponseError(id: JsonRpcId, code: number, message: string): void {
    const msg = { jsonrpc: "2.0" as const, id, error: { code, message } };
    this.recordTranscript("send", msg);
    this.writeRaw(msg);
  }

  private writeRaw(message: unknown): void {
    if (!this.proc?.stdin) throw new InfraFault("connection", "stdin not available");
    const line = `${JSON.stringify(message)}\n`;
    (this.proc.stdin as unknown as { write: (data: string) => void }).write(line);
  }

  private request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.connectionError) return Promise.reject(this.connectionError);
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    this.recordTranscript("send", msg);
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.writeRaw(msg);
    if (!timeoutMs) return promise;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => {
          this.pending.delete(id);
          reject(new InfraFault("timeout", `${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs),
      ),
    ]);
  }

  /** ACP `initialize`. Deliberately advertises no fs/terminal capabilities (spike/FINDINGS.md). */
  async initialize(): Promise<{ readonly agentInfo?: unknown; readonly [key: string]: unknown }> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
  }

  async newSession(cwd: string, mcpServers: ReadonlyArray<unknown> = []): Promise<NewSessionResult> {
    return this.request("session/new", { cwd, mcpServers });
  }

  async prompt(sessionId: string, text: string): Promise<{ readonly stopReason: string }> {
    return this.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text }] },
      this.opts.promptTimeoutMs,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      (this.proc?.stdin as unknown as { end?: () => void })?.end?.();
    } catch {
      /* ignore */
    }
    if (this.proc) {
      const exited = await Promise.race([
        this.proc.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (!exited) this.proc.kill();
    }
    await this.readLoopDone?.catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Effect-native entry point
// ---------------------------------------------------------------------------

export interface AcpRunOptions {
  readonly command: ReadonlyArray<string>;
  readonly cwd: string;
  readonly prompt: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Default 300_000ms (5 minutes). */
  readonly promptTimeoutMs?: number;
  readonly onTranscript?: (entry: TranscriptEntry) => void;
}

export interface AcpRunResult {
  readonly stopReason: string;
  /** From `session/new`'s `models.currentModelId`, or null if unavailable (spike/FINDINGS.md). */
  readonly model: string | null;
  readonly agentInfo: unknown;
  /** Full captured stderr, always populated (even on success) so callers can persist it on any failure classification made after the fact (e.g. stopReason != end_turn). */
  readonly stderr: string;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;

const classify = (err: unknown, stderr: string): AcpError => {
  if (err instanceof InfraFault) {
    if (err.reason === "spawn") {
      return AcpSpawnError.make({ message: err.message, stderr });
    }
    if (err.reason === "auth") {
      return AcpAuthError.make({ message: err.message, stderr });
    }
    if (err.reason === "timeout") {
      return AcpTimeoutError.make({
        message: err.message,
        timeoutMs: DEFAULT_PROMPT_TIMEOUT_MS,
        stderr,
      });
    }
    // "connection": a dropped connection is always infra, but we don't have
    // a dedicated tag for it -- report via AcpProtocolError with
    // likelyInfra: true so RunEngine still maps it to infra-error.
    return AcpProtocolError.make({
      message: err.message,
      stderr,
      likelyInfra: true,
    });
  }
  if (err instanceof TaskFault) {
    // -32603 is ambiguous per spike/FINDINGS.md: could be a genuine internal
    // task-ish error, or (as observed live) a pure infra fault (the nested-
    // session guard) whose real cause only appears in stderr.
    const likelyInfra = stderrLooksInfra(stderr);
    return AcpProtocolError.make({
      message: err.message,
      code: err.code,
      stderr,
      likelyInfra,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return AcpProtocolError.make({ message, stderr, likelyInfra: stderrLooksInfra(stderr) });
};

const extractModel = (session: NewSessionResult): string | null => session.models?.currentModelId ?? null;

/**
 * Drives one full ACP session (spawn -> initialize -> newSession -> prompt)
 * against `opts.command`, as a single Effect. Always closes the client
 * (`Effect.ensuring`), even on failure -- the adapter subprocess is never
 * leaked. All `session/update` notifications are pushed synchronously
 * through `opts.onTranscript` as they arrive, so the caller can write
 * `transcript.jsonl` incrementally (data-model.md §2.8).
 */
export const runAcpSession = (opts: AcpRunOptions): Effect.Effect<AcpRunResult, AcpError> => {
  const client = new AcpClient({
    command: opts.command,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.onTranscript !== undefined ? { onTranscript: opts.onTranscript } : {}),
    promptTimeoutMs: opts.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
  });

  const attempt = Effect.tryPromise({
    try: async (): Promise<AcpRunResult> => {
      await client.spawn();
      const init = await client.initialize();
      const session = await client.newSession(opts.cwd);
      const model = extractModel(session);
      const promptResult = await client.prompt(session.sessionId, opts.prompt);
      return {
        stopReason: promptResult.stopReason,
        model,
        agentInfo: init.agentInfo ?? null,
        stderr: client.getStderr(),
      };
    },
    catch: (err) => classify(err, client.getStderr()),
  });

  return attempt.pipe(Effect.ensuring(Effect.promise(() => client.close())));
};
