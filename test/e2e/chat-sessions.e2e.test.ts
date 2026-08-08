/**
 * End-to-end: the chat surface (D9) over the real server --
 * `/api/chat/:skill/*` against `fixtures/fake-acp-chat.cjs` (a
 * deterministic long-lived adapter with provider-side session persistence).
 * Covers: explicit-start flow (no implicit spawn), multi-turn prompting
 * over one session, SSE streaming + replay, mid-turn steering + the
 * boundary queue (issue #191: a message during a running turn delivers
 * live or queues -- never 409), cancel, inline permission forwarding
 * (auto-approve inside the project, human answer outside), provider-side
 * resume across a REAL session end, session-id persistence in
 * .skillmaker/chat-sessions.json, and helper-skill injection into the
 * agent home. No real LLM -- CI-safe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer, type StartedE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeChatAdapter = join(import.meta.dir, "fixtures", "fake-acp-chat.cjs");

let scratchDir: string;
let scratchHome: string;
let fakeStateDir: string;
let fakeClaudeConfigDir: string;
let server: StartedE2eRegistryServer;
let baseUrl: string;
let projectUrl: string;

const SKILL = "example-skill";
const ORIENT_SKILL = "orient-skill";

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const getJson = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${projectUrl}${path.replace(/^\/api/, "")}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const postJson = async (path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${projectUrl}${path.replace(/^\/api/, "")}`, {
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

interface SseDataFrame {
  readonly id: string | undefined;
  readonly event: Record<string, unknown>;
}

/** Collects one SSE stream's data events and their native resume ids until aborted. */
const openStream = (
  path: string,
  lastEventId?: string,
): { events: Array<Record<string, unknown>>; frames: Array<SseDataFrame>; close: () => void } => {
  const controller = new AbortController();
  const events: Array<Record<string, unknown>> = [];
  const frames: Array<SseDataFrame> = [];
  void (async () => {
    try {
      const response = await fetch(`${projectUrl}${path.replace(/^\/api/, "")}`, {
        signal: controller.signal,
        ...(lastEventId === undefined ? {} : { headers: { "last-event-id": lastEventId } }),
      });
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
          const id = part
            .split("\n")
            .find((line) => line.startsWith("id: "))
            ?.slice("id: ".length);
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
              events.push(event);
              frames.push({ id, event });
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
  return { events, frames, close: () => controller.abort() };
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
  fakeClaudeConfigDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-claude-config-"));
  writeFileSync(join(fakeClaudeConfigDir, ".credentials.json"), "{}\n");
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", SKILL, "--json"], scratchDir).exitCode).toBe(0);

  // A second bundle for the agent-speaks-first (orient) test, with a real
  // one-liner so the preamble's mission clause is observable.
  expect(runCli(["new", ORIENT_SKILL, "--json"], scratchDir).exitCode).toBe(0);
  const orientBundlePath = join(scratchDir, "skills", ORIENT_SKILL, "bundle.json");
  const orientBundle = JSON.parse(readFileSync(orientBundlePath, "utf8")) as Record<string, unknown>;
  writeFileSync(orientBundlePath, `${JSON.stringify({ ...orientBundle, oneLiner: "orients the director" }, null, 2)}\n`);

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
  server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
    env: {
      FAKE_CHAT_STATE_DIR: fakeStateDir,
      SKILLMAKER_AGENT_HOME_DIR: join(scratchHome, ".skillmaker", "agent-home"),
      CLAUDE_CONFIG_DIR: fakeClaudeConfigDir,
    },
  });
  baseUrl = server.baseUrl;
  projectUrl = server.projectUrls[0] as string;
}, 60_000);

afterAll(async () => {
  server?.process.kill("SIGTERM");
  await server?.process.exited;
  for (const dir of [scratchDir, scratchHome, fakeStateDir, fakeClaudeConfigDir]) {
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
      await waitFor(
        async () => (stream.events.some((event) => event.type === "replay_reset") ? true : undefined),
        "fresh stream replay reset",
      );
      expect(stream.frames.find((frame) => frame.event.type === "state")?.id).toBeUndefined();
      expect(stream.frames.find((frame) => frame.event.type === "replay_reset")?.id).toBeUndefined();

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
      // Multi-prompt over one session: the fake counts turns. Turn 1
      // carries the production-context preamble (Blocker #5): mission,
      // slug, stage-appropriate step, installed helper -- then the user's
      // own words after the separator.
      expect(text).toContain("turn 1: You're inside Skillmaker Studio.");
      expect(text).toContain(`(slug: ${SKILL})`);
      expect(text).toContain("The current step is: clarify intent and research.");
      expect(text).toContain("william-draft-skill-md");
      expect(text).toContain("william-research-a-skill");
      expect(text).toContain("\n\n---\n\nhello agent");
      expect(text).toContain("turn 2: and again");
      // The preamble names the skillmaker CLI as the studio-state door (D6)
      // and goes only on the FIRST prompt.
      expect(text).toContain("skillmaker");
      expect(text.split("You're inside Skillmaker Studio.").length - 1).toBe(1);
      const replayIds = stream.frames
        .map((frame) => frame.id)
        .filter((id): id is string => id !== undefined)
        .map(Number);
      expect(replayIds).toEqual(Array.from({ length: replayIds.length }, (_, index) => index));
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

  test("SSE reconnect resumes from Last-Event-ID without replaying or clearing the live transcript", async () => {
    const initial = openStream(`/api/chat/${SKILL}/stream`);
    try {
      await waitFor(
        async () => (initial.events.some((event) => event.type === "replay_reset") ? true : undefined),
        "initial replay reset",
      );
      const marker = "resume-cursor-marker";
      expect((await postJson(`/api/chat/${SKILL}/message`, { text: marker })).status).toBe(202);
      await waitFor(
        async () =>
          initial.events.some((event) => event.type === "turn_ended") &&
          agentTextOf(initial.events).includes(marker)
            ? true
            : undefined,
        "cursor turn",
      );
      const lastId = initial.frames
        .map((frame) => frame.id)
        .filter((id): id is string => id !== undefined)
        .at(-1);
      expect(lastId).toBeDefined();
      initial.close();

      const resumed = openStream(`/api/chat/${SKILL}/stream`, lastId);
      try {
        await waitFor(
          async () => (resumed.events.some((event) => event.type === "state") ? true : undefined),
          "resumed stream state",
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(resumed.events.map((event) => event.type)).toEqual(["state"]);
        expect(resumed.frames[0]?.id).toBeUndefined();

        const missedMarker = "resume-missed-marker";
        resumed.close();
        expect((await postJson(`/api/chat/${SKILL}/message`, { text: missedMarker })).status).toBe(202);
        await waitFor(async () => {
          const state = await getState();
          return state.active?.status === "ready" ? true : undefined;
        }, "missed turn to complete");

        const suffix = openStream(`/api/chat/${SKILL}/stream`, lastId);
        try {
          await waitFor(
            async () => (agentTextOf(suffix.events).includes(missedMarker) ? true : undefined),
            "missed suffix",
          );
          expect(suffix.events.some((event) => event.type === "replay_reset")).toBe(false);
          const ids = suffix.frames
            .map((frame) => frame.id)
            .filter((id): id is string => id !== undefined)
            .map(Number);
          expect(ids.length).toBeGreaterThan(0);
          expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => Number(lastId) + index + 1));
          expect(new Set(ids).size).toBe(ids.length);
          expect(suffix.events.filter((event) => event.type === "user_message" && event.text === missedMarker)).toHaveLength(1);
          expect(agentTextOf(suffix.events).split(missedMarker).length - 1).toBe(1);
        } finally {
          suffix.close();
        }
      } finally {
        resumed.close();
      }
    } finally {
      initial.close();
    }
  }, 30_000);

  test("agent home injection uses packaged helpers, never writes them into the project", async () => {
    for (const slug of ["william-research-a-skill", "william-draft-skill-md"]) {
      expect(
        existsSync(join(scratchHome, ".skillmaker", "agent-home", "claude-code", "skills", slug, "SKILL.md")),
      ).toBe(true);
      expect(existsSync(join(scratchDir, "skills", slug))).toBe(false);
    }
    const bundles = await getJson("/bundles");
    expect((bundles.body.bundles as ReadonlyArray<{ slug: string }>).map(({ slug }) => slug).sort()).toEqual(
      [SKILL, ORIENT_SKILL].sort(),
    );
    // Chat runs DIRECT in the project -- no project-level skill install.
    expect(existsSync(join(scratchDir, ".claude", "skills"))).toBe(false);
  });

  test("a message sent mid-turn is STEERING (issue #191): delivered live, never 409; a refused mid-turn prompt queues and flushes at the boundary in order; Stop still cancels", async () => {
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      const hang = await postJson(`/api/chat/${SKILL}/message`, { text: "please HANG here" });
      expect(hang.status).toBe(202);
      await waitFor(async () => {
        const state = await getState();
        return state.active?.status === "running" ? true : undefined;
      }, "turn to start running");

      // Live delivery: the composer never blocks, the message goes straight
      // into the running session (the fake answers it as its own turn).
      const steered = await postJson(`/api/chat/${SKILL}/message`, { text: "impatient redirect" });
      expect(steered.status).toBe(202);
      expect(steered.body.delivery).toBe("steered");
      await waitFor(
        async () => (agentTextOf(stream.events).includes("impatient redirect") ? true : undefined),
        "live-steered message to cross the wire",
      );

      // An adapter refusing the mid-turn prompt -> the server-side boundary
      // queue, visible as a pending bubble + in state.
      const refused = await postJson(`/api/chat/${SKILL}/message`, { text: "REJECT-MIDTURN hold me" });
      expect(refused.status).toBe(202);
      await waitFor(async () => {
        const state = (await getJson(`/api/chat/${SKILL}/state`)).body as {
          active?: { queued?: ReadonlyArray<{ text: string }> };
        };
        return state.active?.queued?.length === 1 ? true : undefined;
      }, "refused steer to enter the queue");

      const cancelled = await postJson(`/api/chat/${SKILL}/cancel`, {});
      expect(cancelled.status).toBe(200);
      await waitFor(async () => {
        const ended = stream.events.find((event) => event.type === "turn_ended" && event.stopReason === "cancelled");
        return ended !== undefined ? true : undefined;
      }, "cancelled turn to end");

      // The cancel boundary flushes the queue: the held message becomes its
      // own turn, exactly once, and the session comes back to ready.
      await waitFor(
        async () => (agentTextOf(stream.events).includes("REJECT-MIDTURN hold me") ? true : undefined),
        "queued message to flush at the boundary",
      );
      await waitFor(async () => {
        const state = await getState();
        return state.active?.status === "ready" ? true : undefined;
      }, "ready after the flush");
      expect(
        stream.events.filter((event) => event.type === "user_message" && event.text === "REJECT-MIDTURN hold me").length,
      ).toBe(1);
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
    // a fresh SSE connect sees the replayed history -- ORIGINAL preamble
    // included, because it was part of the first wire prompt.
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      await waitFor(
        async () => (agentTextOf(stream.events).includes("turn 1:") ? true : undefined),
        "replayed history on the stream",
      );

      // The first post-resume prompt carries the one-line re-orientation
      // (not the full preamble -- the replay already has that), exposed to
      // the panel via the user_message event's context field.
      const sent = await postJson(`/api/chat/${SKILL}/message`, { text: "where were we?" });
      expect(sent.status).toBe(202);
      await waitFor(
        async () => (agentTextOf(stream.events).includes("where were we?") ? true : undefined),
        "post-resume turn to echo",
      );
      const text = agentTextOf(stream.events);
      expect(text).toContain("Re-orientation:");
      expect(text).toContain("\n\n---\n\nwhere were we?");
      // Full preamble only once (the replayed original), never re-sent.
      expect(text.split("You're inside Skillmaker Studio.").length - 1).toBe(1);
      const userEvent = stream.events.find(
        (event) => event.type === "user_message" && event.text === "where were we?",
      );
      expect(String(userEvent?.context)).toStartWith("Re-orientation:");
    } finally {
      stream.close();
    }
  }, 30_000);

  test("agent speaks first: orient start sends the preamble + orientation instruction alone, then user sends carry no second preamble", async () => {
    const started = await postJson(`/api/chat/${ORIENT_SKILL}/session`, {
      provider: "claude-code",
      mode: "new",
      orient: true,
    });
    expect(started.status).toBe(200);

    const stream = openStream(`/api/chat/${ORIENT_SKILL}/stream`);
    try {
      // The opening turn was dispatched by the server itself -- no user
      // message posted -- and streams like any other turn.
      await waitFor(
        async () => (eventTypes(stream.events).includes("turn_ended") ? true : undefined),
        "orientation turn to end",
      );
      const text = agentTextOf(stream.events);
      expect(text).toContain("turn 1: You're inside Skillmaker Studio.");
      expect(text).toContain("orients the director"); // the bundle's one-liner
      expect(text).toContain("william-draft-skill-md");
      expect(text).toContain("william-research-a-skill");
      expect(text).toContain("Orient the director");
      // Preamble ALONE: machine context only, no separator, no user words.
      expect(text).not.toContain("\n\n---\n\n");

      // The stream's user_message event is context-only (the panel renders
      // just the collapsed chip, no user bubble).
      const opening = stream.events.find((event) => event.type === "user_message");
      expect(opening?.text).toBe("");
      expect(String(opening?.context)).toStartWith("You're inside Skillmaker Studio.");
      expect(String(opening?.context)).toContain("Orient the director");

      // A later user send is an ordinary prompt: no second preamble.
      await waitFor(async () => {
        const body = (await getJson(`/api/chat/${ORIENT_SKILL}/state`)).body as unknown as ChatStateBody;
        return body.active?.status === "ready" ? true : undefined;
      }, "session ready after the orientation turn");
      const sent = await postJson(`/api/chat/${ORIENT_SKILL}/message`, { text: "sounds right, go on" });
      expect(sent.status).toBe(202);
      await waitFor(
        async () => (agentTextOf(stream.events).includes("turn 2: sounds right, go on") ? true : undefined),
        "second turn to echo",
      );
      expect(agentTextOf(stream.events).split("You're inside Skillmaker Studio.").length - 1).toBe(1);
    } finally {
      stream.close();
      await postJson(`/api/chat/${ORIENT_SKILL}/end`, {});
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
