/**
 * End-to-end: the chat surface (D9) over the real server --
 * `/api/chat/:skill/*` against `fixtures/fake-acp-chat.cjs` (a
 * deterministic long-lived adapter with provider-side session persistence).
 * Covers: explicit-start flow (no implicit spawn), multi-turn prompting
 * over one session, SSE streaming + replay, the reject-concurrent-prompts
 * 409, cancel, inline permission forwarding (auto-approve inside the
 * project, human answer outside), provider-side resume across a REAL
 * session end, session-id persistence in .skillmaker/chat-sessions.json,
 * and helper-skill injection into the agent home. No real LLM -- CI-safe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer, type StartedE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeChatAdapter = join(import.meta.dir, "fixtures", "fake-acp-chat.cjs");

let scratchDir: string;
let scratchHome: string;
let fakeStateDir: string;
let server: StartedE2eServer;
let baseUrl: string;

const SKILL = "example-skill";

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const getJson = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const postJson = async (path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

interface ChatStateBody {
  readonly active: null | { provider: string; status: string; sessionId: string; resumed: boolean };
  readonly providers: ReadonlyArray<string>;
  readonly resumable: ReadonlyArray<{ provider: string; providerSessionId: string }>;
}

const getState = async (): Promise<ChatStateBody> =>
  (await getJson(`/api/chat/${SKILL}/state`)).body as unknown as ChatStateBody;

const waitFor = async <T>(probe: () => Promise<T | undefined>, what: string, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** Collects one SSE stream's data events into an array until aborted. */
const openStream = (path: string): { events: Array<Record<string, unknown>>; close: () => void } => {
  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  void (async () => {
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              events.push(JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
            } catch {
              // ignore malformed frames
            }
          }
        }
      }
    } catch {
      // aborted / server stopped
    }
  })();
  return { events, close: () => controller.abort() };
};

const eventTypes = (events: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<string> =>
  events.map((event) => String(event.type));

const agentTextOf = (events: ReadonlyArray<Record<string, unknown>>): string =>
  events
    .filter((event) => event.type === "update")
    .map((event) => {
      const update = (event.update as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } })?.update;
      return update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text"
        ? (update.content.text ?? "")
        : "";
    })
    .join("");

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-"));
  scratchHome = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-home-"));
  fakeStateDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-state-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", SKILL, "--json"], scratchDir).exitCode).toBe(0);

  // A William helper bundle in the workspace, to observe agent-home injection.
  const williamDir = join(scratchDir, "skills", "william-draft-skill-md");
  mkdirSync(join(williamDir, "output"), { recursive: true });
  writeFileSync(join(williamDir, "bundle.json"), `${JSON.stringify({ slug: "william-draft-skill-md" })}\n`);
  writeFileSync(join(williamDir, "output", "SKILL.md"), "# William drafts\n");

  // Point the claude-code provider at the fake chat adapter.
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command: ["node", fakeChatAdapter] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // The spawned server (and through it the adapter) gets this env:
  // fake provider-side session store + a scratch HOME so the agent-home
  // injection never touches the operator's real ~/.skillmaker.
  server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
    env: {
      FAKE_CHAT_STATE_DIR: fakeStateDir,
      SKILLMAKER_AGENT_HOME_DIR: join(scratchHome, ".skillmaker", "agent-home"),
    },
  });
  baseUrl = server.baseUrl;
}, 60_000);

afterAll(async () => {
  server?.process.kill("SIGTERM");
  await server?.process.exited;
  for (const dir of [scratchDir, scratchHome, fakeStateDir]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("chat sessions (D9)", () => {
  test("no implicit session: state opens pre-session, and message without a session is rejected", async () => {
    const state = await getState();
    expect(state.active).toBeNull();
    expect(state.providers).toContain("claude-code");
    expect(state.resumable).toEqual([]);

    const rejected = await postJson(`/api/chat/${SKILL}/message`, { text: "hello?" });
    expect(rejected.status).toBe(409);
    expect(String(rejected.body.error)).toContain("start one first");
  });

  test("explicit start -> multi-turn conversation over ONE session, streamed over SSE, session id persisted", async () => {
    const started = await postJson(`/api/chat/${SKILL}/session`, { provider: "claude-code", mode: "new" });
    if (started.status !== 200) console.error("session start failed:", JSON.stringify(started.body));
    expect(started.status).toBe(200);

    const ready = await waitFor(async () => {
      const state = await getState();
      return state.active?.status === "ready" ? state : undefined;
    }, "session ready");
    expect(ready.active?.provider).toBe("claude-code");
    expect(ready.active?.resumed).toBe(false);

    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      const first = await postJson(`/api/chat/${SKILL}/message`, { text: "hello agent" });
      expect(first.status).toBe(202);
      await waitFor(
        async () => (eventTypes(stream.events).includes("turn_ended") ? true : undefined),
        "first turn to end",
      );

      const second = await postJson(`/api/chat/${SKILL}/message`, { text: "and again" });
      expect(second.status).toBe(202);
      await waitFor(
        async () =>
          eventTypes(stream.events).filter((type) => type === "turn_ended").length >= 2 ? true : undefined,
        "second turn to end",
      );

      const text = agentTextOf(stream.events);
      // Multi-prompt over one session: the fake counts turns.
      expect(text).toContain("turn 1: You are the working agent"); // preamble on turn 1
      expect(text).toContain("hello agent");
      expect(text).toContain("turn 2: and again");
      // The preamble names the skillmaker CLI as the studio-state door (D6)
      // and goes only on the FIRST prompt.
      expect(text).toContain("skillmaker");
      expect(text.split("You are the working agent").length - 1).toBe(1);
      // Tool-call chips stream through.
      const kinds = stream.events
        .filter((event) => event.type === "update")
        .map((event) => (event.update as { update?: { sessionUpdate?: string } })?.update?.sessionUpdate);
      expect(kinds).toContain("tool_call");
      expect(kinds).toContain("tool_call_update");

      // Session id persisted per (skill, provider) -- the provider's id, not ours.
      const persisted = JSON.parse(
        readFileSync(join(scratchDir, ".skillmaker", "chat-sessions.json"), "utf8"),
      ) as { skills: Record<string, Record<string, { providerSessionId: string }>> };
      const record = persisted.skills[SKILL]?.["claude-code"];
      expect(record?.providerSessionId).toStartWith("fake-chat-");
      const stateNow = await getState();
      expect(record?.providerSessionId).toBe(stateNow.active?.sessionId ?? "");
    } finally {
      stream.close();
    }
  }, 30_000);

  test("agent home injection: helper skill installed under the scratch HOME, never the project", async () => {
    const injected = join(scratchHome, ".skillmaker", "agent-home", "claude-code", "skills", "william-draft-skill-md", "SKILL.md");
    expect(existsSync(injected)).toBe(true);
    // Chat runs DIRECT in the project -- no project-level skill install.
    expect(existsSync(join(scratchDir, ".claude", "skills"))).toBe(false);
  });

  test("concurrent prompts are REJECTED (409) while a turn runs; cancel ends the turn with stopReason cancelled", async () => {
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      const hang = await postJson(`/api/chat/${SKILL}/message`, { text: "please HANG here" });
      expect(hang.status).toBe(202);
      await waitFor(async () => {
        const state = await getState();
        return state.active?.status === "running" ? true : undefined;
      }, "turn to start running");

      const rejected = await postJson(`/api/chat/${SKILL}/message`, { text: "impatient" });
      expect(rejected.status).toBe(409);
      expect(String(rejected.body.error)).toContain("already running");

      const cancelled = await postJson(`/api/chat/${SKILL}/cancel`, {});
      expect(cancelled.status).toBe(200);
      await waitFor(async () => {
        const ended = stream.events.find((event) => event.type === "turn_ended" && event.stopReason === "cancelled");
        return ended !== undefined ? true : undefined;
      }, "cancelled turn to end");

      const state = await getState();
      expect(state.active?.status).toBe("ready");
    } finally {
      stream.close();
    }
  }, 30_000);

  test("permissions: in-project auto-approves with no browser round trip; out-of-project forwards inline and the human's answer crosses the wire", async () => {
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      // The stream REPLAYS the session's earlier turns on connect, so all
      // waits below are against growth past this baseline.
      await waitFor(
        async () => (eventTypes(stream.events).includes("state") ? true : undefined),
        "stream to connect",
      );
      const turnsAtStart = eventTypes(stream.events).filter((type) => type === "turn_ended").length;

      // Inside the project: auto-approved, no permission_request event.
      // realpath because the server resolves its workspace root (macOS
      // /var -> /private/var) and the fake echoes this literal path back
      // in its permission request.
      const insidePath = join(realpathSync(scratchDir), "inside-note.md");
      const insideSent = await postJson(`/api/chat/${SKILL}/message`, { text: `NEEDS-PERMISSION:${insidePath}` });
      if (insideSent.status !== 202) console.error("inside send failed:", JSON.stringify(insideSent.body));
      await waitFor(
        async () =>
          eventTypes(stream.events).filter((type) => type === "turn_ended").length > turnsAtStart
            ? true
            : undefined,
        "in-project permission turn",
      );
      expect(eventTypes(stream.events)).not.toContain("permission_request");
      expect(agentTextOf(stream.events)).toContain("permission answer: opt-allow-once");

      // Outside the project: forwarded to the browser; deny it.
      await postJson(`/api/chat/${SKILL}/message`, { text: "NEEDS-PERMISSION:/etc/skillmaker-chat-e2e.txt" });
      const request = await waitFor(async () => {
        const found = stream.events.find((event) => event.type === "permission_request");
        return found !== undefined ? found : undefined;
      }, "forwarded permission request");
      const params = request.params as { toolCall?: { title?: string }; options?: ReadonlyArray<{ optionId: string }> };
      expect(params.toolCall?.title).toContain("/etc/skillmaker-chat-e2e.txt");

      const answered = await postJson(`/api/chat/${SKILL}/permission`, {
        requestId: String(request.id),
        optionId: "opt-reject-once",
        decision: "denied",
      });
      expect(answered.status).toBe(200);
      await waitFor(async () => {
        const resolved = stream.events.find((event) => event.type === "permission_resolved" && event.id === request.id);
        return resolved !== undefined ? true : undefined;
      }, "permission resolution event");
      await waitFor(
        async () => (agentTextOf(stream.events).includes("permission answer: opt-reject-once") ? true : undefined),
        "denial to cross the wire",
      );
    } finally {
      stream.close();
    }
  }, 30_000);

  test("resume: end the session, start with mode resume -> provider replays history through the stream", async () => {
    const before = await getState();
    const sessionId = before.active?.sessionId ?? "";
    expect(sessionId).toStartWith("fake-chat-");

    const ended = await postJson(`/api/chat/${SKILL}/end`, {});
    expect(ended.status).toBe(200);
    const afterEnd = await getState();
    expect(afterEnd.active).toBeNull();
    expect(afterEnd.resumable.some((entry) => entry.providerSessionId === sessionId)).toBe(true);

    const resumed = await postJson(`/api/chat/${SKILL}/session`, { provider: "claude-code", mode: "resume" });
    expect(resumed.status).toBe(200);
    const state = await waitFor(async () => {
      const now = await getState();
      return now.active?.status === "ready" ? now : undefined;
    }, "resumed session ready");
    expect(state.active?.resumed).toBe(true);
    expect(state.active?.sessionId).toBe(sessionId);

    // The provider's session/load replay arrives through the stream buffer:
    // a fresh SSE connect sees the replayed history.
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      await waitFor(
        async () => (agentTextOf(stream.events).includes("turn 1:") ? true : undefined),
        "replayed history on the stream",
      );
    } finally {
      stream.close();
    }
  }, 30_000);

  test("bad requests: unknown provider 400, resume with no record 400", async () => {
    const badProvider = await postJson(`/api/chat/other-skill/session`, { provider: "nope", mode: "new" });
    expect(badProvider.status).toBe(400);
    expect(String(badProvider.body.error)).toContain("not configured");

    const badResume = await postJson(`/api/chat/other-skill/session`, { provider: "claude-code", mode: "resume" });
    expect(badResume.status).toBe(400);
    expect(String(badResume.body.error)).toContain("no resumable");
  });
});
