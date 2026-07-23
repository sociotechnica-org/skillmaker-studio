/**
 * ChatSession (D9) lifecycle against the deterministic fake adapter
 * (test/e2e/fixtures/fake-acp-chat.cjs): multi-prompt turns, provider-side
 * resume via session/load (including the unknown-id fresh-session
 * fallback), interactive permission forwarding, cancel, and busy/closed
 * error semantics.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  makeChatPermissionPolicy,
  startChatSession,
  type ChatPermissionAnswer,
  type ChatSessionHandle,
  type ChatSessionOptions,
} from "../src/ChatSession.ts";

const FAKE_ADAPTER = join(import.meta.dir, "..", "..", "..", "test", "e2e", "fixtures", "fake-acp-chat.cjs");

let stateDir: string;
let projectDir: string;
const openHandles: ChatSessionHandle[] = [];

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "fake-chat-state-"));
  projectDir = mkdtempSync(join(tmpdir(), "fake-chat-project-"));
});

afterEach(async () => {
  for (const handle of openHandles.splice(0)) {
    await handle.close();
  }
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

interface StartOverrides {
  readonly resumeSessionId?: string;
  readonly modelId?: string;
  readonly onUpdate?: (update: unknown) => void;
  readonly ask?: (request: { readonly params: unknown }) => Promise<ChatPermissionAnswer | "cancelled">;
  readonly onAdapterExit?: (code: number | null) => void;
}

const start = async (overrides: StartOverrides = {}): Promise<ChatSessionHandle> => {
  const options: ChatSessionOptions = {
    command: ["node", FAKE_ADAPTER],
    cwd: projectDir,
    env: { FAKE_CHAT_STATE_DIR: stateDir },
    onUpdate: overrides.onUpdate ?? (() => {}),
    permissionPolicy: makeChatPermissionPolicy(
      projectDir,
      overrides.ask ?? (() => Promise.resolve({ optionId: "opt-reject-once", decision: "denied" })),
    ),
    ...(overrides.resumeSessionId !== undefined ? { resumeSessionId: overrides.resumeSessionId } : {}),
    ...(overrides.modelId !== undefined ? { modelId: overrides.modelId } : {}),
    ...(overrides.onAdapterExit !== undefined ? { onAdapterExit: overrides.onAdapterExit } : {}),
  };
  const handle = await Effect.runPromise(startChatSession(options));
  openHandles.push(handle);
  return handle;
};

const agentText = (updates: ReadonlyArray<unknown>): string =>
  updates
    .map((u) => {
      const update = (u as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }).update;
      return update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text"
        ? (update.content.text ?? "")
        : "";
    })
    .join("");

describe("startChatSession", () => {
  test("establishes a fresh session and reports capabilities + model", async () => {
    const handle = await start();
    expect(handle.sessionId).toStartWith("fake-chat-");
    expect(handle.resumed).toBe(false);
    expect(handle.resumeFallback).toBeUndefined();
    expect(handle.loadSessionSupported).toBe(true);
    // The fake now lists availableModels with descriptions (mirroring the
    // real adapters), and extractModel resolves the current id to its
    // DESCRIPTION per resolveModelLabel (Phase 20 F2) -- the wire id stays
    // available as handle.modelId.
    expect(handle.model).toBe("The fake default");
    expect(handle.modelId).toBe("fake-chat-model");
  });

  test("applies a caller-chosen model at start via session/set_model, and switches mid-session", async () => {
    const updates: unknown[] = [];
    const handle = await start({ modelId: "fake-chat-model-pro", onUpdate: (u) => updates.push(u) });
    // The fake announces every set_model as an agent chunk.
    expect(agentText(updates)).toContain("model set: fake-chat-model-pro");
    expect(handle.modelId).toBe("fake-chat-model-pro");

    await Effect.runPromise(handle.setModel("fake-chat-model"));
    expect(agentText(updates)).toContain("model set: fake-chat-model");
    expect(handle.modelId).toBe("fake-chat-model");
  });

  test("an unknown model at start degrades to the adapter default with modelFallback set (never a refused session)", async () => {
    const handle = await start({ modelId: "no-such-model" });
    expect(handle.modelFallback).toContain("no-such-model");
    expect(handle.modelId).toBe("fake-chat-model");
    // The session still works.
    const turn = await Effect.runPromise(handle.prompt("hello"));
    expect(turn.stopReason).toBe("end_turn");
  });

  test("prompt with image attachments sends ACP image content blocks (decoded size acknowledged by the fake)", async () => {
    const updates: unknown[] = [];
    const handle = await start({ onUpdate: (u) => updates.push(u) });
    const png = Buffer.from("fake image bytes").toString("base64");
    const turn = await Effect.runPromise(
      handle.prompt("describe this", [{ data: png, mimeType: "image/png", name: "x.png" }]),
    );
    expect(turn.stopReason).toBe("end_turn");
    const text = agentText(updates);
    expect(text).toContain("describe this");
    expect(text).toContain(`[image image/png ${String(Buffer.from(png, "base64").length)}b]`);
  });

  test("drives MULTIPLE prompt turns over one session, streaming updates for each", async () => {
    const updates: unknown[] = [];
    const handle = await start({ onUpdate: (u) => updates.push(u) });

    const first = await Effect.runPromise(handle.prompt("hello"));
    expect(first.stopReason).toBe("end_turn");
    const second = await Effect.runPromise(handle.prompt("again"));
    expect(second.stopReason).toBe("end_turn");

    const text = agentText(updates);
    expect(text).toContain("turn 1: hello");
    expect(text).toContain("turn 2: again");
    // Tool-call updates stream through too (chip rendering feeds on these).
    const kinds = updates.map(
      (u) => (u as { update?: { sessionUpdate?: string } }).update?.sessionUpdate,
    );
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_call_update");
  });

  test("resumes a provider-persisted session via session/load, replaying history through onUpdate", async () => {
    const first = await start();
    await Effect.runPromise(first.prompt("remember me"));
    const persistedId = first.sessionId;
    await first.close();

    // A brand-new adapter process (real restart) resumes by id.
    const replayed: unknown[] = [];
    const second = await start({ resumeSessionId: persistedId, onUpdate: (u) => replayed.push(u) });
    expect(second.resumed).toBe(true);
    expect(second.sessionId).toBe(persistedId);
    expect(second.resumeFallback).toBeUndefined();
    expect(agentText(replayed)).toContain("turn 1: remember me");

    // And the resumed session keeps counting turns where it left off.
    await Effect.runPromise(second.prompt("continue"));
    expect(agentText(replayed)).toContain("turn 2: continue");
  });

  test("an unknown resume id falls back to a fresh session, honestly reported", async () => {
    const handle = await start({ resumeSessionId: "fake-chat-never-existed" });
    expect(handle.resumed).toBe(false);
    expect(handle.resumeFallback).toContain("session/load failed");
    expect(handle.sessionId).not.toBe("fake-chat-never-existed");
    const result = await Effect.runPromise(handle.prompt("fresh"));
    expect(result.stopReason).toBe("end_turn");
  });

  test("an in-project permission request auto-approves without asking the human", async () => {
    let asked = 0;
    const updates: unknown[] = [];
    const handle = await start({
      onUpdate: (u) => updates.push(u),
      ask: () => {
        asked += 1;
        return Promise.resolve({ optionId: "opt-reject-once", decision: "denied" });
      },
    });
    await Effect.runPromise(handle.prompt(`NEEDS-PERMISSION:${join(projectDir, "notes.md")}`));
    expect(asked).toBe(0);
    expect(agentText(updates)).toContain("permission answer: opt-allow-once");
  });

  test("an out-of-project permission request forwards to the async ask handler and answers with the human's choice", async () => {
    const asks: unknown[] = [];
    const updates: unknown[] = [];
    const handle = await start({
      onUpdate: (u) => updates.push(u),
      ask: (request) => {
        asks.push(request.params);
        return Promise.resolve({ optionId: "opt-allow-always", decision: "allowed" });
      },
    });
    await Effect.runPromise(handle.prompt("NEEDS-PERMISSION:/etc/skillmaker-chat-test.txt"));
    expect(asks.length).toBe(1);
    expect(agentText(updates)).toContain("permission answer: opt-allow-always");
  });

  test("a torn-down ask resolves the agent's request as cancelled", async () => {
    const updates: unknown[] = [];
    const handle = await start({
      onUpdate: (u) => updates.push(u),
      ask: () => Promise.resolve("cancelled"),
    });
    await Effect.runPromise(handle.prompt("NEEDS-PERMISSION:/etc/never.txt"));
    expect(agentText(updates)).toContain("permission answer: cancelled");
  });

  test("a second prompt while one is in flight fails with ChatBusyError; cancel resolves the hung turn", async () => {
    const handle = await start();
    const hanging = Effect.runPromise(handle.prompt("HANG"));
    // Give the adapter a beat to accept the turn.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(handle.busy()).toBe(true);

    const second = await Effect.runPromise(Effect.result(handle.prompt("too eager")));
    expect(second._tag).toBe("Failure");
    if (second._tag === "Failure") {
      expect(String(second.failure)).toContain("ChatBusyError");
    }

    handle.cancel();
    const result = await hanging;
    expect(result.stopReason).toBe("cancelled");
    expect(handle.busy()).toBe(false);
  });

  test("prompting after close fails with ChatClosedError", async () => {
    const handle = await start();
    await handle.close();
    const outcome = await Effect.runPromise(Effect.result(handle.prompt("late")));
    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      expect(String(outcome.failure)).toContain("ChatClosedError");
    }
  });
});
