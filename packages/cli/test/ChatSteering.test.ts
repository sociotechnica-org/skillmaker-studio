/**
 * ChatSessionManager mid-turn steering + boundary queue (issue #191,
 * director ruling 2026-08-08), against the deterministic fake chat adapter
 * (test/e2e/fixtures/fake-acp-chat.cjs). Covers the ruled contract:
 *
 * - typing is never blocked: a message during a running turn is DELIVERED
 *   LIVE into the session (never 409);
 * - an adapter that refuses the mid-turn prompt falls back to the
 *   server-side boundary queue -- flushed at the turn boundary, in send
 *   order, exactly once, riding the same preamble-less non-first path;
 * - the queue flushes even when the boundary is a cancelled/errored turn;
 * - promptQueueing adapters (claude-agent-acp's shape) keep status
 *   `running` until the steered turn itself completes;
 * - a message sent while the session is still `starting` queues and
 *   flushes on ready -- and when it IS the first prompt, it still carries
 *   the production preamble.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceConfig } from "@skillmaker/core";
import { ChatSessionManager } from "../src/server/ChatSessions.ts";

const FAKE_ADAPTER = join(import.meta.dir, "..", "..", "..", "test", "e2e", "fixtures", "fake-acp-chat.cjs");
const SKILL = "steer-skill";

let root: string;
let stateDir: string;
let agentHome: string;
let claudeConfig: string;
let manager: ChatSessionManager | undefined;
const savedEnv = new Map<string, string | undefined>();

const setEnv = (key: string, value: string | undefined): void => {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chat-steer-root-"));
  stateDir = mkdtempSync(join(tmpdir(), "chat-steer-state-"));
  agentHome = mkdtempSync(join(tmpdir(), "chat-steer-home-"));
  claudeConfig = mkdtempSync(join(tmpdir(), "chat-steer-claude-"));
  writeFileSync(join(claudeConfig, ".credentials.json"), "{}\n");
  mkdirSync(join(root, "skills", SKILL), { recursive: true });
  writeFileSync(
    join(root, "skills", SKILL, "bundle.json"),
    `${JSON.stringify({ slug: SKILL, oneLiner: "steers the agent" })}\n`,
  );
  setEnv("FAKE_CHAT_STATE_DIR", stateDir);
  setEnv("SKILLMAKER_AGENT_HOME_DIR", agentHome);
  setEnv("CLAUDE_CONFIG_DIR", claudeConfig);
  setEnv("FAKE_CHAT_PROMPT_QUEUEING", undefined);
  setEnv("FAKE_CHAT_SLOW_START_MS", undefined);
});

afterEach(async () => {
  await manager?.stop();
  manager = undefined;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  for (const dir of [root, stateDir, agentHome, claudeConfig]) rmSync(dir, { recursive: true, force: true });
});

const makeManager = (): ChatSessionManager => {
  manager = new ChatSessionManager({
    root,
    config: WorkspaceConfig.make({
      schemaVersion: 1,
      name: "steer-test",
      skillsDir: "skills",
      viewer: { port: 0 },
      trackRuns: false,
      providers: { "claude-code": { command: ["node", FAKE_ADAPTER] } },
      publishTargets: [],
    }),
  });
  return manager;
};

const waitFor = async <T>(probe: () => T | undefined, what: string, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** Reads one snapshot of the skill's stream buffer: connect, drain the replay for `readMs`, disconnect. */
const snapshotEvents = async (m: ChatSessionManager, readMs = 400): Promise<Array<Record<string, unknown>>> => {
  const response = m.streamResponse(SKILL, new Request("http://localhost/api/chat/stream"));
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  const deadline = Date.now() + readMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), deadline - Date.now())),
    ]);
    if (chunk === undefined || chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  for (const part of buffer.split("\n\n")) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        events.push(JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
      } catch {
        // malformed frame: ignore
      }
    }
  }
  return events;
};

const agentTextOf = (events: ReadonlyArray<Record<string, unknown>>): string =>
  events
    .filter((event) => event.type === "update")
    .map((event) => {
      const update = (event.update as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } })
        ?.update;
      return update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text"
        ? (update.content.text ?? "")
        : "";
    })
    .join("");

const status = (m: ChatSessionManager): string | undefined => m.state(SKILL).active?.status;
const queuedTexts = (m: ChatSessionManager): ReadonlyArray<string> =>
  (m.state(SKILL).active?.queued ?? []).map((entry) => entry.text);

describe("chat steering (issue #191)", () => {
  test("a message during a running turn is delivered LIVE (never 409), and Stop still cancels the primary turn", async () => {
    const m = makeManager();
    const started = await m.startSession(SKILL, "claude-code", "new");
    expect(started.ok).toBe(true);
    await waitFor(() => (status(m) === "ready" ? true : undefined), "session ready");

    const hang = await m.sendMessage(SKILL, "please HANG here");
    expect(hang.ok && hang.delivery).toBe("sent");
    await waitFor(() => (status(m) === "running" ? true : undefined), "turn running");

    const steered = await m.sendMessage(SKILL, "redirect: other folder");
    expect(steered.ok && steered.delivery).toBe("steered");
    // Live delivery: the fake answers the mid-turn prompt as its own turn
    // while the primary keeps hanging -- nothing ever queued.
    await waitFor(
      () => (m.state(SKILL).active?.queued === undefined ? true : undefined),
      "no server queue",
      1_000,
    );
    const events = await snapshotEvents(m);
    expect(agentTextOf(events)).toContain("redirect: other folder");
    const bubble = events.find((e) => e.type === "user_message" && e.text === "redirect: other folder");
    expect(bubble?.queued).toBeUndefined(); // delivered, not pending
    expect(status(m)).toBe("running"); // the primary turn still owns the boundary

    expect(m.cancelTurn(SKILL).ok).toBe(true);
    await waitFor(() => (status(m) === "ready" ? true : undefined), "ready after cancel");
    const after = await snapshotEvents(m);
    expect(after.some((e) => e.type === "turn_ended" && e.stopReason === "cancelled")).toBe(true);
  }, 30_000);

  test("an adapter refusing the mid-turn prompt falls back to the boundary queue: flushed at the boundary, in order, exactly once, preamble-less", async () => {
    const m = makeManager();
    await m.startSession(SKILL, "claude-code", "new");
    await waitFor(() => (status(m) === "ready" ? true : undefined), "session ready");
    // First wire prompt (carries the preamble) hangs the turn.
    await m.sendMessage(SKILL, "please HANG here");
    await waitFor(() => (status(m) === "running" ? true : undefined), "turn running");

    // The steer attempt is refused (-32000) -> re-queued server-side.
    const first = await m.sendMessage(SKILL, "REJECT-MIDTURN but deliver me later");
    expect(first.ok && first.delivery).toBe("steered");
    await waitFor(
      () => (queuedTexts(m).length === 1 ? true : undefined),
      "refused steer to enter the queue",
    );

    // With the queue non-empty, later messages queue BEHIND it (order).
    const second = await m.sendMessage(SKILL, "second thought");
    expect(second.ok && second.delivery).toBe("queued");
    expect(queuedTexts(m)).toEqual(["REJECT-MIDTURN but deliver me later", "second thought"]);

    // The boundary here is a CANCELLED turn -- the queue must flush anyway.
    m.cancelTurn(SKILL);
    await waitFor(() => (status(m) === "ready" ? true : undefined), "ready after flush");
    expect(m.state(SKILL).active?.queued).toBeUndefined();

    const events = await snapshotEvents(m);
    const text = agentTextOf(events);
    // In order, exactly once, and preamble-less (the preamble went out on
    // the first -- hanging -- prompt; "turn N" numbering proves single
    // delivery, and the flushed turns' echoes carry no preamble text).
    expect(text).toContain("turn 1: REJECT-MIDTURN but deliver me later");
    expect(text).toContain("turn 2: second thought");
    expect(text).not.toContain("You're inside Skillmaker Studio.");
    // Only the FIRST message carried the machine context; flushed queued
    // messages ride the plain non-first path.
    const withContext = events.filter((e) => e.type === "user_message" && typeof e.context === "string");
    expect(withContext.length).toBe(1);
    expect(withContext[0]?.text).toBe("please HANG here");
    // One bubble per message -- the refused steer's re-queue never re-broadcast.
    expect(events.filter((e) => e.type === "user_message" && e.text === "REJECT-MIDTURN but deliver me later").length).toBe(1);
    expect(events.filter((e) => e.type === "user_message" && e.text === "second thought").length).toBe(1);
    // The queued bubble resolves via queue_delivered.
    const queuedBubble = events.find((e) => e.type === "user_message" && e.queued === true);
    expect(queuedBubble?.text).toBe("second thought");
    const delivered = events.filter((e) => e.type === "queue_delivered").map((e) => e.queueId);
    expect(delivered).toContain(queuedBubble?.queueId);
    // The refused live delivery surfaced honestly.
    expect(events.some((e) => e.type === "error" && String(e.message).includes("mid-turn delivery failed"))).toBe(true);
  }, 30_000);

  test("promptQueueing adapter (claude-agent-acp shape): the steered prompt is a counted turn -- status stays running until IT completes", async () => {
    setEnv("FAKE_CHAT_PROMPT_QUEUEING", "1");
    const m = makeManager();
    await m.startSession(SKILL, "claude-code", "new");
    await waitFor(() => (status(m) === "ready" ? true : undefined), "session ready");
    await m.sendMessage(SKILL, "please HANG here");
    await waitFor(() => (status(m) === "running" ? true : undefined), "turn running");

    const steered = await m.sendMessage(SKILL, "banked instruction");
    expect(steered.ok && steered.delivery).toBe("steered");
    // Held adapter-side; nothing queued server-side.
    expect(m.state(SKILL).active?.queued).toBeUndefined();
    expect(status(m)).toBe("running");

    m.cancelTurn(SKILL);
    // The cancel ends the primary turn, then the adapter runs the steered
    // turn; only after THAT completes does the session go ready.
    await waitFor(() => (status(m) === "ready" ? true : undefined), "ready after steered turn");
    const events = await snapshotEvents(m);
    expect(agentTextOf(events)).toContain("turn 1: banked instruction");
    const stopReasons = events.filter((e) => e.type === "turn_ended").map((e) => e.stopReason);
    expect(stopReasons).toEqual(["cancelled", "end_turn"]);
  }, 30_000);

  test("a message sent while the session is starting queues, then flushes on ready as the FIRST prompt -- preamble included", async () => {
    setEnv("FAKE_CHAT_SLOW_START_MS", "1500");
    const m = makeManager();
    const starting = m.startSession(SKILL, "claude-code", "new");
    await waitFor(() => (status(m) === "starting" ? true : undefined), "starting window");

    const sent = await m.sendMessage(SKILL, "early bird");
    expect(sent.ok && sent.delivery).toBe("queued");
    expect(queuedTexts(m)).toEqual(["early bird"]);

    expect((await starting).ok).toBe(true);
    await waitFor(() => (status(m) === "ready" ? true : undefined), "flushed and ready");
    expect(m.state(SKILL).active?.queued).toBeUndefined();
    const events = await snapshotEvents(m);
    const text = agentTextOf(events);
    expect(text).toContain("turn 1: You're inside Skillmaker Studio.");
    expect(text).toContain("\n\n---\n\nearly bird");
  }, 30_000);

  test("no session at all is still an honest 409", async () => {
    const m = makeManager();
    const sent = await m.sendMessage(SKILL, "hello?");
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.status).toBe(409);
  });
});
