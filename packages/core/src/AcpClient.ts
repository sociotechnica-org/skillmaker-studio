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
import { realpathSync } from "node:fs";
import { isAbsolute as pathIsAbsolute, relative as pathRelative, resolve as pathResolve } from "node:path";
import { Schema } from "effect";
import { Effect } from "effect";
import { CLAUDE_CODE_PROFILE, resolveModelLabel, type ProviderProfile } from "./ProviderProfile.ts";

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
 * commentary (currently: `permission_decision` records carrying the policy's
 * optionId, allowed/denied verdict, and reason -- issue #140) clearly marked
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

const stderrLooksInfra = (stderr: string, extraSignatures: ReadonlyArray<string> = []): boolean =>
  [...INFRA_STDERR_SIGNATURES, ...extraSignatures].some((signature) => stderr.includes(signature));

// ---------------------------------------------------------------------------
// Permission policy (issue #140: deny-by-default for run/station agents)
// ---------------------------------------------------------------------------

export interface PermissionOption {
  readonly optionId: string;
  readonly kind: string;
}

/**
 * The outcome of a permission policy for one `session/request_permission`:
 * which offered option to answer with, whether the net effect is an approval
 * or a refusal, and a human-readable reason. Recorded verbatim in the
 * transcript's synthetic `permission_decision` entry and surfaced through
 * the engines' `permission-decision` progress events, so a denial is
 * diagnosable from one run (issue #140).
 */
export interface PermissionDecision {
  readonly optionId: string;
  readonly decision: "allowed" | "denied";
  readonly reason: string;
}

/**
 * A policy may also answer "cancelled" -- the ACP `RequestPermissionOutcome`
 * for a request that became moot (the turn was cancelled, the session is
 * closing) rather than being decided. Run/station policies never produce
 * this; interactive chat policies (D9) do, when a pending browser-forwarded
 * request is torn down before a human answers it.
 */
export interface PermissionCancelled {
  readonly cancelled: true;
  readonly reason: string;
}

export type PermissionPolicyResult = PermissionDecision | PermissionCancelled;

export const isPermissionCancelled = (
  result: PermissionPolicyResult,
): result is PermissionCancelled => "cancelled" in result && result.cancelled;

/**
 * Decides one permission request. Run/station policies (issue #140) are
 * deterministic and synchronous: same request payload -> same decision.
 * Interactive policies (the chat surface, D9) may return a Promise that
 * settles only when a human answers -- `AcpClient` awaits it and holds the
 * JSON-RPC response open meanwhile, exactly how ACP expects
 * `session/request_permission` to behave. Throwing/rejecting means the
 * request cannot be answered at all (e.g. the agent offered zero options);
 * `AcpClient` then responds with a JSON-RPC error.
 */
export type PermissionPolicy = (
  params: unknown,
) => PermissionPolicyResult | Promise<PermissionPolicyResult>;

export const extractPermissionOptions = (params: unknown): ReadonlyArray<PermissionOption> =>
  params !== null && typeof params === "object" && "options" in params
    ? ((params as { readonly options?: ReadonlyArray<PermissionOption> }).options ?? [])
    : [];

export const pickApproveOption = (options: ReadonlyArray<PermissionOption>): PermissionOption => {
  const preferred =
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind === "allow_always") ??
    options[0];
  if (!preferred) throw new Error("no permission options offered");
  return preferred;
};

/**
 * The reject/deny option per issue #140's decision: `reject_once` first,
 * then `reject_always`, then anything whose kind mentions reject/deny.
 * Returns undefined when the agent offered no refusal at all -- the caller
 * must then fall back to the least-permissive offered option and record the
 * compromise.
 */
const pickDenyOption = (options: ReadonlyArray<PermissionOption>): PermissionOption | undefined =>
  options.find((o) => o.kind === "reject_once") ??
  options.find((o) => o.kind === "reject_always") ??
  options.find((o) => o.kind.includes("reject") || o.kind.includes("deny"));

/** Least-permissive fallback when no reject/deny option exists: a one-shot approval over a standing one, else whatever came first. */
const pickLeastPermissiveOption = (options: ReadonlyArray<PermissionOption>): PermissionOption => {
  const preferred = options.find((o) => o.kind === "allow_once") ?? options[0];
  if (!preferred) throw new Error("no permission options offered");
  return preferred;
};

/**
 * The pre-#140 behavior, kept as the `--permissive` escape hatch: approve
 * every request via its most natural allow option. Decisions are still
 * recorded (issue #140 acceptance criteria).
 */
export const permissiveApprovePolicy: PermissionPolicy = (params) => {
  const option = pickApproveOption(extractPermissionOptions(params));
  return {
    optionId: option.optionId,
    decision: "allowed",
    reason: `permissive mode: auto-approved (option kind "${option.kind}")`,
  };
};

/** Keys whose string values are treated as filesystem paths even when relative (resolved against the sandbox dir). */
const PATH_LIKE_KEY = /(^|_)(path|file|dir|directory|cwd|destination|target|source)s?$/i;

/** Keys whose string values are shell-command-shaped: scanned for absolute-path tokens rather than treated as one path. */
const COMMAND_LIKE_KEY = /(^|_)(command|cmd|script)s?$/i;

/** Absolute-path-shaped tokens inside a shell command string: `/...` or `~...`, delimited by whitespace/quotes/common shell metacharacters. */
const COMMAND_PATH_TOKEN = /(?:^|[\s"'`=(<>|;&])((?:\/|~)[^\s"'`)<>|;&]*)/g;

export interface CandidatePath {
  /** Where in the payload the path was found, for the decision's reason. */
  readonly origin: string;
  readonly value: string;
}

/** Recursively collects every path-shaped string in a permission-request payload. Purely syntactic -- never touches the filesystem. */
const collectCandidatePaths = (value: unknown, key: string, origin: string, out: CandidatePath[]): void => {
  if (typeof value === "string") {
    if (COMMAND_LIKE_KEY.test(key)) {
      for (const match of value.matchAll(COMMAND_PATH_TOKEN)) {
        const token = match[1];
        if (token !== undefined && token !== "/" && token !== "~") {
          out.push({ origin, value: token });
        }
      }
      return;
    }
    if (value.startsWith("/") || value.startsWith("~")) {
      out.push({ origin, value });
      return;
    }
    if (PATH_LIKE_KEY.test(key)) {
      out.push({ origin, value });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCandidatePaths(item, key, `${origin}[${index}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectCandidatePaths(childValue, childKey, origin === "" ? childKey : `${origin}.${childKey}`, out);
    }
  }
};

/**
 * The issue #140 default policy: a request whose every referenced path stays
 * inside `sandboxDir` is allowed; any reference reaching outside it is
 * denied. Policy inputs are exactly the sandbox dir path and the request
 * payload (the issue's scope fence) -- no filesystem probing beyond one
 * upfront `realpath` of the sandbox dir itself (macOS `/var` vs `/private/
 * var` symlinking would otherwise misclassify in-sandbox paths), so the
 * policy is deterministic across identical requests.
 *
 * Paths are found syntactically: `toolCall.locations[].path` and any other
 * string in the payload that is absolute (`/...`), home-anchored (`~...`),
 * or sits under a path-like key (those may be relative; they resolve against
 * the sandbox cwd). Command-shaped strings are scanned for absolute-path
 * tokens. `~` always counts as outside -- the operator's home is never the
 * sandbox. A request referencing no paths at all is allowed: its cwd IS the
 * sandbox, so a pathless effect stays inside it.
 */
/**
 * The path-scoping core shared by the sandbox policy below and the chat
 * surface's project-dir policy (`ChatSession.ts`): every path-shaped string
 * in `params` that does NOT stay inside `rootDir`, with the same syntactic
 * collection rules and realpath tolerance `makeSandboxPermissionPolicy` has
 * always used. Empty result = the request's every referenced path stays
 * inside `rootDir` (or it references no paths at all).
 */
export const permissionPathsOutside = (
  rootDir: string,
  params: unknown,
): ReadonlyArray<CandidatePath> => {
  const roots = [pathResolve(rootDir)];
  try {
    const real = realpathSync(rootDir);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // Root dir not resolvable (already gone?): keep the syntactic root.
  }

  const isInsideRoot = (candidate: string): boolean => {
    if (candidate.startsWith("~")) return false;
    const resolved = pathResolve(roots[0] ?? rootDir, candidate);
    return roots.some((root) => {
      const rel = pathRelative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !pathIsAbsolute(rel));
    });
  };

  const candidates: CandidatePath[] = [];
  collectCandidatePaths(params, "", "", candidates);
  return candidates.filter((candidate) => !isInsideRoot(candidate.value));
};

export const makeSandboxPermissionPolicy = (sandboxDir: string): PermissionPolicy => {
  return (params) => {
    const options = extractPermissionOptions(params);
    const candidates: CandidatePath[] = [];
    collectCandidatePaths(params, "", "", candidates);

    const offending = permissionPathsOutside(sandboxDir, params);
    if (offending.length === 0) {
      const option = pickApproveOption(options);
      return {
        optionId: option.optionId,
        decision: "allowed",
        reason:
          candidates.length === 0
            ? "no filesystem paths referenced; the session cwd is the sandbox"
            : "every referenced path is inside the sandbox",
      };
    }

    const summary = offending
      .slice(0, 3)
      .map((candidate) => `${candidate.value} (${candidate.origin})`)
      .join(", ");
    const suffix = offending.length > 3 ? ` and ${offending.length - 3} more` : "";
    const why = `references path(s) outside the sandbox: ${summary}${suffix}`;

    const denyOption = pickDenyOption(options);
    if (denyOption !== undefined) {
      return { optionId: denyOption.optionId, decision: "denied", reason: why };
    }
    // Issue #140's decision: no reject/deny option offered -> answer with
    // the least-permissive option and record the compromise.
    const fallback = pickLeastPermissiveOption(options);
    return {
      optionId: fallback.optionId,
      decision: "allowed",
      reason: `policy verdict was deny (${why}), but the agent offered no reject/deny option; compromised on least-permissive option kind "${fallback.kind}"`,
    };
  };
};

// ---------------------------------------------------------------------------
// Low-level client (Promise-based; see module doc for why)
// ---------------------------------------------------------------------------

export interface AcpClientOptions {
  readonly command: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly onTranscript?: (entry: TranscriptEntry) => void;
  /**
   * Structured observer for inbound JSON-RPC notifications (`session/update`
   * lands here). `onTranscript` already sees the same frames as raw wire
   * entries; this exists for callers (the chat surface) that want the
   * method/params split without re-parsing transcript entries. Never affects
   * control flow.
   */
  readonly onNotification?: (method: string, params: unknown) => void;
  readonly promptTimeoutMs?: number;
  /**
   * Decides every `session/request_permission`. Defaults to
   * `permissiveApprovePolicy` for bare clients (a raw `AcpClient` has no
   * sandbox to scope decisions to); `RunEngine`/`StationEngine` always pass
   * `makeSandboxPermissionPolicy(sandboxDir)` unless the caller asked for
   * `--permissive` (issue #140).
   */
  readonly permissionPolicy?: PermissionPolicy;
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

  /** The adapter subprocess pid, once spawned. Long-lived callers (chat) record it for best-effort orphan cleanup after a server crash. */
  getPid(): number | undefined {
    return this.proc?.pid;
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
      // session/update lands here; the caller observes it via onTranscript
      // and (structured) via onNotification.
      this.opts.onNotification?.(msg.method, msg.params);
      return;
    }
  }

  private async respondToInboundRequest(req: JsonRpcRequest): Promise<void> {
    try {
      let result: unknown;
      if (req.method === "session/request_permission") {
        const decision = await this.decidePermission(req.params);
        if (isPermissionCancelled(decision)) {
          this.recordTranscript("synthetic", {
            type: "permission_decision",
            method: req.method,
            decision: "cancelled",
            reason: decision.reason,
          });
          result = { outcome: { outcome: "cancelled" } };
        } else {
          this.recordTranscript("synthetic", {
            type: "permission_decision",
            method: req.method,
            optionId: decision.optionId,
            decision: decision.decision,
            reason: decision.reason,
          });
          result = { outcome: { outcome: "selected", optionId: decision.optionId } };
        }
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

  private decidePermission(params: unknown): PermissionPolicyResult | Promise<PermissionPolicyResult> {
    return (this.opts.permissionPolicy ?? permissiveApprovePolicy)(params);
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

  /**
   * ACP `session/load` -- resume a provider-persisted session. Only valid
   * when `initialize`'s result advertised `agentCapabilities.loadSession:
   * true` (the spec forbids calling it otherwise). The agent replays the
   * whole prior conversation as `session/update` notifications
   * (`user_message_chunk` / `agent_message_chunk`) BEFORE answering this
   * request, so a caller streaming updates sees history arrive first.
   */
  async loadSession(sessionId: string, cwd: string, mcpServers: ReadonlyArray<unknown> = []): Promise<unknown> {
    return this.request("session/load", { sessionId, cwd, mcpServers });
  }

  /**
   * ACP `session/cancel` -- a NOTIFICATION (no response): asks the agent to
   * stop the in-flight turn. The turn's `session/prompt` then resolves with
   * `stopReason: "cancelled"`.
   */
  cancel(sessionId: string): void {
    const msg = { jsonrpc: "2.0" as const, method: "session/cancel", params: { sessionId } };
    this.recordTranscript("send", msg);
    this.writeRaw(msg);
  }

  /** Resolves when the adapter subprocess exits (never rejects). For long-lived callers (chat) that must observe an adapter dying mid-session. */
  async exited(): Promise<number | null> {
    if (!this.proc) return null;
    await this.proc.exited;
    return this.proc.exitCode;
  }

  /**
   * ACP `session/set_model` (confirmed against the real
   * `@zed-industries/claude-code-acp@0.16.2` adapter's `dist/acp-agent.js`:
   * `unstable_setSessionModel({sessionId, modelId})` calling
   * `query.setModel(modelId)` -- the JS binding name `unstable_setSessionModel`
   * maps to the wire method `session/set_model`, per
   * `@agentclientprotocol/sdk@0.14.1`'s `AGENT_METHODS.session_set_model`).
   * Must be called with a `modelId` already confirmed present in
   * `session/new`'s `models.availableModels` -- the adapter does not itself
   * validate the id (Fix 1, Phase 20 Story 2 friction log F1).
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.request("session/set_model", { sessionId, modelId });
  }

  /**
   * ACP `session/prompt`. A plain string sends one text block (the
   * historical shape every call site uses); an array sends the given
   * content blocks verbatim -- the chat surface's image path (`{type:
   * "image", data: <base64>, mimeType}`, accepted by both shipped adapters
   * per their `promptCapabilities.image: true`).
   */
  async prompt(
    sessionId: string,
    input: string | ReadonlyArray<{ readonly type: string; readonly [key: string]: unknown }>,
  ): Promise<{ readonly stopReason: string }> {
    const prompt = typeof input === "string" ? [{ type: "text", text: input }] : input;
    return this.request("session/prompt", { sessionId, prompt }, this.opts.promptTimeoutMs);
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
  /** Provider-specific model extraction + infra-stderr signatures (ProviderProfile.ts). Defaults to the claude-code-acp profile, whose tolerant `extractModel` also recognizes codex's shapes. */
  readonly providerProfile?: ProviderProfile;
  /**
   * Fix 1 (Phase 20 Story 2 friction log F1): a caller-requested model id
   * (e.g. `skillmaker run --model haiku`). Must match one of `session/new`'s
   * advertised `models.availableModels[].modelId` values -- an unadvertised
   * id is rejected with an error that lists what WAS advertised, rather than
   * silently running on whatever the adapter's own default is (the F1 bug:
   * an `ANTHROPIC_MODEL` env var that was silently ignored). `undefined`
   * (the default) leaves the adapter on its own default model, unchanged
   * from pre-Fix-1 behavior.
   */
  readonly requestedModel?: string;
  /** Issue #140: the permission policy for this session. Defaults to `permissiveApprovePolicy` (the pre-#140 behavior); engines supply the deny-by-default sandbox policy. */
  readonly permissionPolicy?: PermissionPolicy;
}

export interface AcpRunResult {
  readonly stopReason: string;
  /** Read via `providerProfile.extractModel` from `session/new`'s result, or null if unavailable (spike/FINDINGS.md, spike-codex/FINDINGS.md). */
  readonly model: string | null;
  readonly agentInfo: unknown;
  /** Full captured stderr, always populated (even on success) so callers can persist it on any failure classification made after the fact (e.g. stopReason != end_turn). */
  readonly stderr: string;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;

/** Classifies any error thrown while driving an `AcpClient` into the typed `AcpError` union (spike/FINDINGS.md's infra-vs-task table). Shared with `ChatSession.ts`, which drives the same client long-lived. */
export const classifyAcpFailure = (err: unknown, stderr: string, providerProfile: ProviderProfile): AcpError => {
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
    // session guard for claude-code, the model-compat fault for codex --
    // spike-codex/FINDINGS.md) whose real cause only appears in stderr.
    const likelyInfra = stderrLooksInfra(stderr, providerProfile.infraStderrSignatures);
    return AcpProtocolError.make({
      message: err.message,
      code: err.code,
      stderr,
      likelyInfra,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return AcpProtocolError.make({
    message,
    stderr,
    likelyInfra: stderrLooksInfra(stderr, providerProfile.infraStderrSignatures),
  });
};

/**
 * Drives one full ACP session (spawn -> initialize -> newSession -> prompt)
 * against `opts.command`, as a single Effect. Always closes the client
 * (`Effect.ensuring`), even on failure -- the adapter subprocess is never
 * leaked. All `session/update` notifications are pushed synchronously
 * through `opts.onTranscript` as they arrive, so the caller can write
 * `transcript.jsonl` incrementally (data-model.md §2.8).
 */
export const runAcpSession = (opts: AcpRunOptions): Effect.Effect<AcpRunResult, AcpError> => {
  const providerProfile = opts.providerProfile ?? CLAUDE_CODE_PROFILE;
  const client = new AcpClient({
    command: opts.command,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.onTranscript !== undefined ? { onTranscript: opts.onTranscript } : {}),
    ...(opts.permissionPolicy !== undefined ? { permissionPolicy: opts.permissionPolicy } : {}),
    promptTimeoutMs: opts.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
  });

  const attempt = Effect.tryPromise({
    try: async (): Promise<AcpRunResult> => {
      await client.spawn();
      const init = await client.initialize();
      const session = await client.newSession(opts.cwd);
      let model = providerProfile.extractModel(session);

      if (opts.requestedModel !== undefined) {
        const advertised = session.models?.availableModels ?? [];
        const match = advertised.find((candidate) => candidate.modelId === opts.requestedModel);
        if (!match) {
          const advertisedIds = advertised.map((candidate) => candidate.modelId);
          const list = advertisedIds.length > 0 ? advertisedIds.join(", ") : "(provider advertised no models)";
          throw new Error(
            `unknown model "${opts.requestedModel}" -- advertised models: ${list}`,
          );
        }
        await client.setModel(session.sessionId, opts.requestedModel);
        // Fix 2: record the RESOLVED model (advertised description), never
        // the bare requested alias -- same resolution `extractModel` applies
        // to the adapter's own default above.
        model = resolveModelLabel(session, opts.requestedModel);
      }

      const promptResult = await client.prompt(session.sessionId, opts.prompt);
      return {
        stopReason: promptResult.stopReason,
        model,
        agentInfo: init.agentInfo ?? null,
        stderr: client.getStderr(),
      };
    },
    catch: (err) => classifyAcpFailure(err, client.getStderr(), providerProfile),
  });

  return attempt.pipe(Effect.ensuring(Effect.promise(() => client.close())));
};
