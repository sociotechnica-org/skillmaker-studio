/**
 * The chat surface's server side (D9): one long-lived ACP session per
 * skill, spawned on EXPLICIT user choice (never implicitly on panel open),
 * streamed to the browser over SSE, permission requests forwarded inline,
 * and persistence delegated to the PROVIDER's own session model -- the
 * only thing skillmaker stores is `{provider, providerSessionId,
 * updatedAt}` per (skill, provider) in `.skillmaker/chat-sessions.json`,
 * so reopening a chat resumes via ACP `session/load` and the provider
 * replays the history itself.
 *
 * Concurrency ruling (documented choice): concurrent prompts are REJECTED
 * (HTTP 409), not queued. The panel disables its input while a turn runs,
 * so a 409 only ever surfaces to racing clients -- and an honest "busy"
 * beats a silent queue whose entries fire into a conversation state the
 * user no longer sees.
 *
 * Isolation ruling: the chat agent runs DIRECT in the project directory
 * (cwd = project root; no sandbox, no copyback), with the run-engines'
 * config-dir isolation REPURPOSED as an injection door: the adapter's
 * `configDirEnvVar` points at a persistent skillmaker-managed agent home
 * (`~/.skillmaker/agent-home/<provider>/`) seeded with the operator's auth
 * (AuthSeeding) and skillmaker's own helper skills -- so the agent sees
 * William's research/drafting material without those skills being
 * installed in the user's project or personal config dir.
 */
import {
  makeChatPermissionPolicy,
  resolveProviderProfile,
  seedProviderAuth,
  startChatSession,
  type ChatPermissionAnswer,
  type ChatSessionHandle,
  type WorkspaceConfig,
} from "@skillmaker/core";
import { Effect } from "effect";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** A ready (not mid-turn) session with no prompt/stream activity for this long is reaped: the adapter closes, the provider session id stays persisted, and the panel shows the resume affordance again. */
const IDLE_REAP_MS = 15 * 60 * 1000;
const REAP_CHECK_MS = 60 * 1000;

/** Skillmaker's own helper skills (William material), injected via the agent home -- resolved from the studio workspace's skillsDir when present, silently skipped when absent (a user project without the William bundles still chats fine, just without the helpers). */
const HELPER_SKILL_SLUGS = ["william-research-a-skill", "william-draft-skill-md"] as const;

// ---------------------------------------------------------------------------
// Persistence: .skillmaker/chat-sessions.json + chat-live.json
// ---------------------------------------------------------------------------

interface PersistedSession {
  readonly providerSessionId: string;
  readonly updatedAt: string;
}

/** skill -> provider -> persisted session. Per (skill, provider), so switching provider keeps the other provider's session resumable. */
type SessionStore = Record<string, Record<string, PersistedSession>>;

interface PersistedLiveAdapter {
  readonly pid: number;
  readonly command: string;
  readonly startedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readSessionStore = (path: string): SessionStore => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.skills)) return {};
    const out: SessionStore = {};
    for (const [skill, byProvider] of Object.entries(parsed.skills)) {
      if (!isRecord(byProvider)) continue;
      const entry: Record<string, PersistedSession> = {};
      for (const [provider, session] of Object.entries(byProvider)) {
        if (
          isRecord(session) &&
          typeof session.providerSessionId === "string" &&
          typeof session.updatedAt === "string"
        ) {
          entry[provider] = { providerSessionId: session.providerSessionId, updatedAt: session.updatedAt };
        }
      }
      if (Object.keys(entry).length > 0) out[skill] = entry;
    }
    return out;
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------------------
// Agent-home injection
// ---------------------------------------------------------------------------

const copyDirRecursive = (src: string, dest: string): void => {
  let names: ReadonlyArray<string>;
  try {
    names = readdirSync(src);
  } catch {
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const name of names) {
    const s = join(src, name);
    const d = join(dest, name);
    const info = statSync(s);
    if (info.isDirectory()) copyDirRecursive(s, d);
    else if (info.isFile()) writeFileSync(d, readFileSync(s));
  }
};

/**
 * Prepares `~/.skillmaker/agent-home/<provider>/` for a chat session:
 * refreshes auth material (AuthSeeding's pattern -- ONLY auth, never the
 * operator's own skills/settings) and installs skillmaker's helper skills
 * into the home's user-level skill directory. The claude CLI reads
 * user-level skills from `$CLAUDE_CONFIG_DIR/skills`, codex from
 * `$CODEX_HOME/skills` -- both "skills/" relative to the relocated config
 * dir (the cwd-relative `.claude/skills` vs `.agents/skills` split in
 * ProviderProfile applies to PROJECT-level skills, which chat deliberately
 * does not touch: the injection must not write into the user's project).
 *
 * Helper skills are re-installed fresh on every session start (rm + copy)
 * so a skillmaker upgrade's newer William material always wins over stale
 * copies.
 */
/** Where per-provider agent homes live. `SKILLMAKER_AGENT_HOME_DIR` overrides the default `~/.skillmaker/agent-home` -- primarily for tests (a scratch base instead of the operator's real home; overriding $HOME wholesale breaks version-manager shims like asdf's `node`), but also a legitimate ops knob. */
export const agentHomeBaseDir = (): string =>
  process.env.SKILLMAKER_AGENT_HOME_DIR ?? join(homedir(), ".skillmaker", "agent-home");

export const prepareAgentHome = (
  provider: string,
  workspaceRoot: string,
  skillsDir: string,
): { readonly home: string; readonly installedHelpers: ReadonlyArray<string> } => {
  const home = join(agentHomeBaseDir(), provider);
  mkdirSync(home, { recursive: true });
  seedProviderAuth(provider, home);

  const installed: string[] = [];
  for (const slug of HELPER_SKILL_SLUGS) {
    const bundleDir = join(workspaceRoot, skillsDir, slug);
    // output/ layout is the William bundles' real shape; an in-place bundle
    // (SKILL.md at the root) installs the bundle dir itself.
    const sourceDir = existsSync(join(bundleDir, "output", "SKILL.md"))
      ? join(bundleDir, "output")
      : existsSync(join(bundleDir, "SKILL.md"))
        ? bundleDir
        : undefined;
    if (sourceDir === undefined) continue;
    const dest = join(home, "skills", slug);
    rmSync(dest, { recursive: true, force: true });
    copyDirRecursive(sourceDir, dest);
    installed.push(slug);
  }
  return { home, installedHelpers: installed };
};

// ---------------------------------------------------------------------------
// First-prompt preamble (agent-first, D6)
// ---------------------------------------------------------------------------

export const buildChatPreamble = (skill: string, skillsDir: string): string =>
  [
    `You are the working agent for the skill "${skill}" in this project.`,
    ``,
    `- The skill's bundle lives at ${skillsDir}/${skill}/ -- design.md (the design doc), output/SKILL.md (the shipped skill text), evals/ (risk map + fixtures), research/ (notes).`,
    `- Studio state -- todos, fixtures, runs, stages -- is read and changed through the \`skillmaker\` CLI (run \`skillmaker --help\` to see commands). Prefer the CLI over editing .skillmaker/ files by hand.`,
    `- You are working DIRECTLY in the project; edits are real, not sandboxed.`,
    ``,
  ].join("\n");

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

export type ChatStatus = "starting" | "ready" | "running";

export interface ChatActiveState {
  readonly provider: string;
  readonly status: ChatStatus;
  readonly sessionId: string;
  readonly resumed: boolean;
  readonly resumeFallback?: string;
  readonly model?: string;
}

export interface ChatStateResponse {
  readonly skill: string;
  readonly providers: ReadonlyArray<string>;
  readonly defaultProvider: string | undefined;
  readonly active: ChatActiveState | null;
  readonly resumable: ReadonlyArray<{
    readonly provider: string;
    readonly providerSessionId: string;
    readonly updatedAt: string;
  }>;
  readonly lastError?: string;
}

/** One SSE event on `/api/chat/:skill/stream`. The buffer replays from session start on (re)connect, so a mid-session page reload rebuilds the live conversation; HISTORY of a resumed session arrives as replayed `update` events (the provider's session/load replay). */
export type ChatStreamEvent =
  | { readonly type: "state"; readonly state: ChatStateResponse }
  | { readonly type: "user_message"; readonly text: string; readonly t: string }
  | { readonly type: "update"; readonly update: unknown; readonly t: string }
  | { readonly type: "permission_request"; readonly id: string; readonly params: unknown; readonly t: string }
  | {
      readonly type: "permission_resolved";
      readonly id: string;
      readonly outcome: "allowed" | "denied" | "cancelled";
      readonly optionId?: string;
      readonly t: string;
    }
  | { readonly type: "turn_ended"; readonly stopReason: string; readonly t: string }
  | { readonly type: "error"; readonly message: string; readonly t: string };

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

interface PendingPermission {
  readonly params: unknown;
  readonly resolve: (answer: ChatPermissionAnswer | "cancelled") => void;
}

interface LiveChat {
  readonly skill: string;
  readonly provider: string;
  status: ChatStatus;
  handle: ChatSessionHandle | undefined;
  /** Everything streamed since this session spawned; replayed to each new SSE subscriber. */
  readonly events: ChatStreamEvent[];
  readonly subscribers: Set<(event: ChatStreamEvent) => void>;
  readonly pendingPermissions: Map<string, PendingPermission>;
  lastActivityAt: number;
  nextPermissionId: number;
}

export interface ChatManagerOptions {
  readonly root: string;
  readonly config: WorkspaceConfig;
}

export class ChatSessionManager {
  private readonly root: string;
  private readonly config: WorkspaceConfig;
  private readonly sessionsPath: string;
  private readonly livePath: string;
  private store: SessionStore;
  private readonly live = new Map<string, LiveChat>();
  private readonly lastErrors = new Map<string, string>();
  private readonly reapTimer: ReturnType<typeof setInterval>;

  constructor(options: ChatManagerOptions) {
    this.root = options.root;
    this.config = options.config;
    const stateDir = join(this.root, ".skillmaker");
    this.sessionsPath = join(stateDir, "chat-sessions.json");
    this.livePath = join(stateDir, "chat-live.json");
    this.store = readSessionStore(this.sessionsPath);
    this.cleanupOrphans();
    this.reapTimer = setInterval(() => this.reapIdle(), REAP_CHECK_MS);
  }

  // -- Persistence ----------------------------------------------------------

  private persistStore(): void {
    mkdirSync(join(this.root, ".skillmaker"), { recursive: true });
    writeFileSync(
      this.sessionsPath,
      `${JSON.stringify({ schemaVersion: 1, skills: this.store }, null, 2)}\n`,
    );
  }

  private recordSession(skill: string, provider: string, providerSessionId: string): void {
    const bySkill = { ...(this.store[skill] ?? {}) };
    bySkill[provider] = { providerSessionId, updatedAt: new Date().toISOString() };
    this.store = { ...this.store, [skill]: bySkill };
    this.persistStore();
  }

  /** Best-effort record of live adapter pids, so a crashed server's successor can clean up orphaned adapter subprocesses on boot. */
  private persistLiveAdapters(): void {
    const entries: Record<string, PersistedLiveAdapter> = {};
    for (const [skill, chat] of this.live) {
      const pid = chat.handle?.pid;
      if (pid !== undefined) {
        const command = this.config.providers[chat.provider]?.command.join(" ") ?? "";
        entries[skill] = { pid, command, startedAt: new Date().toISOString() };
      }
    }
    try {
      mkdirSync(join(this.root, ".skillmaker"), { recursive: true });
      writeFileSync(this.livePath, `${JSON.stringify(entries, null, 2)}\n`);
    } catch {
      // Bookkeeping only; never let it break a session.
    }
  }

  /**
   * Boot-time orphan cleanup: adapters spawned by a PREVIOUS server process
   * that crashed without closing them. Conservative: SIGTERM only pids
   * whose current `ps` command line still contains a token of the recorded
   * adapter command (pid reuse protection); anything else is left alone.
   */
  private cleanupOrphans(): void {
    let recorded: Record<string, PersistedLiveAdapter>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.livePath, "utf8"));
      if (!isRecord(parsed)) return;
      recorded = {};
      for (const [skill, entry] of Object.entries(parsed)) {
        if (isRecord(entry) && typeof entry.pid === "number" && typeof entry.command === "string") {
          recorded[skill] = {
            pid: entry.pid,
            command: entry.command,
            startedAt: typeof entry.startedAt === "string" ? entry.startedAt : "",
          };
        }
      }
    } catch {
      return;
    }
    for (const entry of Object.values(recorded)) {
      try {
        const ps = Bun.spawnSync({ cmd: ["ps", "-p", String(entry.pid), "-o", "command="] });
        const commandLine = new TextDecoder().decode(ps.stdout).trim();
        if (commandLine.length === 0) continue; // already gone
        const token = entry.command.split(" ").find((part) => part.length > 3);
        if (token !== undefined && commandLine.includes(token)) {
          process.kill(entry.pid, "SIGTERM");
        }
      } catch {
        // Process already gone or not ours to signal -- fine either way.
      }
    }
    try {
      rmSync(this.livePath, { force: true });
    } catch {
      /* ignore */
    }
  }

  // -- Introspection --------------------------------------------------------

  providerIds(): ReadonlyArray<string> {
    return Object.keys(this.config.providers);
  }

  state(skill: string): ChatStateResponse {
    const providers = this.providerIds();
    const chat = this.live.get(skill);
    const persisted = this.store[skill] ?? {};
    const resumable = Object.entries(persisted)
      .filter(([provider]) => providers.includes(provider))
      .map(([provider, session]) => ({
        provider,
        providerSessionId: session.providerSessionId,
        updatedAt: session.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const lastError = this.lastErrors.get(skill);
    return {
      skill,
      providers,
      defaultProvider: providers[0],
      active:
        chat === undefined
          ? null
          : {
              provider: chat.provider,
              status: chat.status,
              sessionId: chat.handle?.sessionId ?? "",
              resumed: chat.handle?.resumed ?? false,
              ...(chat.handle?.resumeFallback !== undefined
                ? { resumeFallback: chat.handle.resumeFallback }
                : {}),
              ...(chat.handle?.model != null ? { model: chat.handle.model } : {}),
            },
      resumable,
      ...(lastError !== undefined ? { lastError } : {}),
    };
  }

  // -- Streaming ------------------------------------------------------------

  private broadcast(chat: LiveChat, event: ChatStreamEvent): void {
    chat.events.push(event);
    for (const subscriber of chat.subscribers) subscriber(event);
  }

  private broadcastState(chat: LiveChat): void {
    this.broadcast(chat, { type: "state", state: this.state(chat.skill) });
  }

  /**
   * SSE stream for one skill's chat, following `/api/events-stream`'s
   * ReadableStream pattern -- but per-skill and with a REPLAY: on connect,
   * every buffered event since the live session spawned is sent first, so
   * a page reload mid-session rebuilds the conversation. With no live
   * session, the stream opens with just a `state` snapshot (the panel's
   * pre-session picker feeds on it).
   */
  streamResponse(skill: string): Response {
    const encoder = new TextEncoder();
    const chat = this.live.get(skill);
    let subscriber: ((event: ChatStreamEvent) => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const sendEvent = (event: ChatStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Client disconnected; cancel() will unsubscribe shortly.
          }
        };
        controller.enqueue(encoder.encode(": connected\n\n"));
        sendEvent({ type: "state", state: this.state(skill) });
        if (chat !== undefined) {
          for (const event of chat.events) sendEvent(event);
          subscriber = sendEvent;
          chat.subscribers.add(sendEvent);
          chat.lastActivityAt = Date.now();
        }
      },
      cancel: () => {
        if (chat !== undefined && subscriber !== undefined) chat.subscribers.delete(subscriber);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Explicitly starts (or resumes) a session for a skill -- the ruled
   * pre-session flow: the user picks the provider and new-vs-resume; no
   * session ever spawns implicitly. `mode: "resume"` requires a persisted
   * session for (skill, provider); on `session/load` failure the provider
   * fallback inside `startChatSession` opens a fresh session and the state
   * reports `resumeFallback`. Starting while a session is live for the
   * skill closes the old one first (switching provider starts over -- the
   * old provider's persisted session stays resumable).
   */
  async startSession(
    skill: string,
    provider: string,
    mode: "new" | "resume",
  ): Promise<{ readonly ok: true; readonly state: ChatStateResponse } | { readonly ok: false; readonly status: number; readonly error: string }> {
    if (this.config.providers[provider] === undefined) {
      return {
        ok: false,
        status: 400,
        error: `provider "${provider}" is not configured in skillmaker.config.json (configured: ${this.providerIds().join(", ")})`,
      };
    }
    const existing = this.live.get(skill);
    if (existing !== undefined) {
      if (existing.status === "running" || existing.status === "starting") {
        return { ok: false, status: 409, error: `a ${existing.status} session already exists for "${skill}" -- close it or wait for the turn to finish` };
      }
      await this.closeChat(existing, "replaced by a new session");
    }

    const resumeSessionId = mode === "resume" ? this.store[skill]?.[provider]?.providerSessionId : undefined;
    if (mode === "resume" && resumeSessionId === undefined) {
      return { ok: false, status: 400, error: `no resumable ${provider} session recorded for "${skill}"` };
    }

    const chat: LiveChat = {
      skill,
      provider,
      status: "starting",
      handle: undefined,
      events: [],
      subscribers: new Set(),
      pendingPermissions: new Map(),
      lastActivityAt: Date.now(),
      nextPermissionId: 1,
    };
    this.live.set(skill, chat);
    this.lastErrors.delete(skill);
    this.broadcastState(chat);

    const providerProfile = resolveProviderProfile(provider);
    const { home } = prepareAgentHome(provider, this.root, this.config.skillsDir);

    const outcome = await Effect.runPromise(
      Effect.result(
        startChatSession({
          command: this.config.providers[provider].command,
          cwd: this.root,
          env: { [providerProfile.configDirEnvVar]: home },
          ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
          providerProfile,
          onUpdate: (update) => {
            chat.lastActivityAt = Date.now();
            this.broadcast(chat, { type: "update", update, t: new Date().toISOString() });
          },
          permissionPolicy: makeChatPermissionPolicy(this.root, (request) =>
            this.askPermission(chat, request.params),
          ),
          onAdapterExit: (exitCode) => {
            if (this.live.get(skill) === chat) {
              this.lastErrors.set(skill, `the ${provider} agent process exited unexpectedly (code ${String(exitCode)})`);
              this.broadcast(chat, {
                type: "error",
                message: `agent process exited (code ${String(exitCode)})`,
                t: new Date().toISOString(),
              });
              void this.closeChat(chat, "adapter exited");
            }
          },
        }),
      ),
    );

    if (outcome._tag === "Failure") {
      const message = String(outcome.failure);
      this.lastErrors.set(skill, message);
      this.broadcast(chat, { type: "error", message, t: new Date().toISOString() });
      this.live.delete(skill);
      this.broadcast(chat, { type: "state", state: this.state(skill) });
      return { ok: false, status: 502, error: message };
    }

    chat.handle = outcome.success;
    chat.status = "ready";
    this.recordSession(skill, provider, outcome.success.sessionId);
    this.persistLiveAdapters();
    this.broadcastState(chat);
    return { ok: true, state: this.state(skill) };
  }

  /**
   * One prompt turn. Concurrent prompts are REJECTED with 409 (see module
   * doc). The first prompt of a FRESH (non-resumed) session carries the
   * preamble naming the skill, its bundle paths, and the `skillmaker` CLI
   * as the studio-state door (D6).
   */
  async sendMessage(
    skill: string,
    text: string,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly status: number; readonly error: string }> {
    const chat = this.live.get(skill);
    if (chat === undefined || chat.handle === undefined) {
      return { ok: false, status: 409, error: `no active chat session for "${skill}" -- start one first (POST /api/chat/${skill}/session)` };
    }
    if (chat.status === "running") {
      return { ok: false, status: 409, error: "a turn is already running for this session" };
    }

    const isFirstPrompt = !chat.events.some((event) => event.type === "user_message");
    const promptText =
      isFirstPrompt && !chat.handle.resumed
        ? `${buildChatPreamble(skill, this.config.skillsDir)}${text}`
        : text;

    chat.status = "running";
    chat.lastActivityAt = Date.now();
    this.broadcast(chat, { type: "user_message", text, t: new Date().toISOString() });
    this.broadcastState(chat);

    const handle = chat.handle;
    // Detached: the HTTP response returns immediately; the turn streams
    // over SSE (same detached-run shape as handleTriggerRun).
    void Effect.runPromise(Effect.result(handle.prompt(promptText))).then((outcome) => {
      chat.lastActivityAt = Date.now();
      if (outcome._tag === "Success") {
        this.broadcast(chat, {
          type: "turn_ended",
          stopReason: outcome.success.stopReason,
          t: new Date().toISOString(),
        });
        this.recordSession(skill, chat.provider, handle.sessionId);
      } else {
        this.broadcast(chat, {
          type: "error",
          message: String(outcome.failure),
          t: new Date().toISOString(),
        });
      }
      if (this.live.get(skill) === chat && chat.status === "running") {
        chat.status = "ready";
        this.broadcastState(chat);
      }
    });
    return { ok: true };
  }

  /** ACP `session/cancel` for the in-flight turn; the running prompt then ends with `stopReason: "cancelled"` through the normal turn_ended path. */
  cancelTurn(skill: string): { readonly ok: boolean } {
    const chat = this.live.get(skill);
    if (chat?.handle === undefined || chat.status !== "running") return { ok: false };
    chat.handle.cancel();
    return { ok: true };
  }

  // -- Permissions ----------------------------------------------------------

  private askPermission(chat: LiveChat, params: unknown): Promise<ChatPermissionAnswer | "cancelled"> {
    const id = `perm-${chat.nextPermissionId++}`;
    return new Promise((resolve) => {
      chat.pendingPermissions.set(id, { params, resolve });
      this.broadcast(chat, {
        type: "permission_request",
        id,
        params,
        t: new Date().toISOString(),
      });
    });
  }

  /** The browser's answer to a forwarded permission request: one of the agent's offered optionIds plus its allow/deny meaning. */
  answerPermission(
    skill: string,
    requestId: string,
    optionId: string,
    decision: "allowed" | "denied",
  ): { readonly ok: true } | { readonly ok: false; readonly status: number; readonly error: string } {
    const chat = this.live.get(skill);
    const pending = chat?.pendingPermissions.get(requestId);
    if (chat === undefined || pending === undefined) {
      return { ok: false, status: 404, error: `no pending permission request "${requestId}" for "${skill}"` };
    }
    chat.pendingPermissions.delete(requestId);
    chat.lastActivityAt = Date.now();
    this.broadcast(chat, {
      type: "permission_resolved",
      id: requestId,
      outcome: decision,
      optionId,
      t: new Date().toISOString(),
    });
    pending.resolve({ optionId, decision });
    return { ok: true };
  }

  // -- Teardown -------------------------------------------------------------

  private async closeChat(chat: LiveChat, reason: string): Promise<void> {
    // Pending permission requests answer "cancelled" so the agent's JSON-RPC
    // round trip settles instead of hanging into a dead session.
    for (const [id, pending] of chat.pendingPermissions) {
      pending.resolve("cancelled");
      this.broadcast(chat, {
        type: "permission_resolved",
        id,
        outcome: "cancelled",
        t: new Date().toISOString(),
      });
    }
    chat.pendingPermissions.clear();
    if (this.live.get(chat.skill) === chat) this.live.delete(chat.skill);
    await chat.handle?.close();
    this.persistLiveAdapters();
    this.broadcast(chat, { type: "state", state: this.state(chat.skill) });
    void reason;
  }

  /** Explicit close (the panel's "end session"), also used when switching providers. */
  async endSession(skill: string): Promise<{ readonly ok: boolean }> {
    const chat = this.live.get(skill);
    if (chat === undefined) return { ok: false };
    await this.closeChat(chat, "closed by request");
    return { ok: true };
  }

  private reapIdle(): void {
    const now = Date.now();
    for (const chat of this.live.values()) {
      if (chat.status === "ready" && now - chat.lastActivityAt > IDLE_REAP_MS) {
        void this.closeChat(chat, "idle timeout");
      }
    }
  }

  /** Server shutdown: close every live adapter. */
  async stop(): Promise<void> {
    clearInterval(this.reapTimer);
    for (const chat of [...this.live.values()]) {
      await this.closeChat(chat, "server stopping");
    }
  }
}
