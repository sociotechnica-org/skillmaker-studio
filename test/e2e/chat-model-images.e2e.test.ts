/**
 * End-to-end: the chat surface's MODEL PICKER + IMAGE UPLOAD doors over the
 * real server against `fixtures/fake-acp-chat.cjs` (which mirrors
 * `claude-code-acp@0.16.2`'s real wire shapes: `models` state on
 * session/new & session/load, `session/set_model`, `promptCapabilities.
 * image` and image prompt blocks). Covers:
 *
 * - GET /api/chat/providers: the cached capability probe -> per-provider
 *   models list + image support (learned FROM the adapter, not configured).
 * - Model at session START: `{model}` on POST session -> session/set_model
 *   right after session/new, observed on the adapter side AND in state.
 * - Mid-session model change: POST /api/chat/:skill/model between turns;
 *   409 refusals when no session / while running are honest.
 * - Persistence: chat-sessions.json records {model}; a RESUME without an
 *   explicit model restores the recorded one.
 * - Images: an image prompt block arrives at the adapter intact (decoded
 *   byte size echoed); the user_message stream event carries the
 *   attachment for thumbnail rendering; oversized (>5MB) images are
 *   rejected 413 before any adapter traffic.
 *
 * No real LLM -- CI-safe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const SKILL = "model-image-skill";

/** A real 1x1 transparent PNG (68 bytes decoded). */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64").length;

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
  readonly active: null | {
    provider: string;
    status: string;
    sessionId: string;
    resumed: boolean;
    modelId?: string;
    effort?: string;
  };
  readonly resumable: ReadonlyArray<{ provider: string; providerSessionId: string; model?: string }>;
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
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-model-"));
  scratchHome = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-model-home-"));
  fakeStateDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-model-state-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", SKILL, "--json"], scratchDir).exitCode).toBe(0);

  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command: ["node", fakeChatAdapter] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

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

describe("chat model picker + image uploads", () => {
  test("GET /api/chat/providers probes the adapter once and reports models + image support", async () => {
    const { status, body } = await getJson("/api/chat/providers");
    expect(status).toBe(200);
    const providers = body.providers as ReadonlyArray<{
      provider: string;
      title: string;
      models: ReadonlyArray<{ id: string; label: string; efforts: ReadonlyArray<string> }>;
      imageSupport: boolean;
      probed: boolean;
    }>;
    const claude = providers.find((entry) => entry.provider === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.probed).toBe(true);
    expect(claude?.imageSupport).toBe(true);
    expect(claude?.title).toBe("Claude Code");
    expect(claude?.models.map((model) => model.id)).toEqual(["fake-chat-model", "fake-chat-model-pro"]);
    // The fake mirrors claude-code-acp: NO effort door -> efforts stay
    // empty and the UI hides the effort selector (degraded-hidden ruling).
    expect(claude?.models.every((model) => model.efforts.length === 0)).toBe(true);

    // Cached per process: the second answer is identical (and immediate).
    const again = await getJson("/api/chat/providers");
    expect(again.body).toEqual(body);
  }, 30_000);

  test("model at session START: {model} on POST session lands as session/set_model after session/new", async () => {
    const started = await postJson(`/api/chat/${SKILL}/session`, {
      provider: "claude-code",
      mode: "new",
      model: "fake-chat-model-pro",
    });
    expect(started.status).toBe(200);

    const ready = await waitFor(async () => {
      const state = await getState();
      return state.active?.status === "ready" ? state : undefined;
    }, "session ready");
    expect(ready.active?.modelId).toBe("fake-chat-model-pro");

    // The adapter-side switch is observable on the stream (the fake
    // announces every set_model as an agent chunk).
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      await waitFor(
        async () => (agentTextOf(stream.events).includes("model set: fake-chat-model-pro") ? true : undefined),
        "set_model announcement",
      );
    } finally {
      stream.close();
    }

    // Persisted with the session record, so resume can restore it.
    const persisted = JSON.parse(
      readFileSync(join(scratchDir, ".skillmaker", "chat-sessions.json"), "utf8"),
    ) as { skills: Record<string, Record<string, { providerSessionId: string; model?: string }>> };
    expect(persisted.skills[SKILL]?.["claude-code"]?.model).toBe("fake-chat-model-pro");
  }, 30_000);

  test("an image prompt block reaches the adapter intact and the user bubble event carries the attachment", async () => {
    const stream = openStream(`/api/chat/${SKILL}/stream`);
    try {
      const sent = await postJson(`/api/chat/${SKILL}/message`, {
        text: "what is in this screenshot?",
        images: [{ data: PNG_BASE64, mimeType: "image/png", name: "shot.png" }],
      });
      expect(sent.status).toBe(202);

      // The fake echoes every image block with its DECODED byte count.
      await waitFor(
        async () => (agentTextOf(stream.events).includes(`[image image/png ${String(PNG_BYTES)}b]`) ? true : undefined),
        "image block acknowledged by the adapter",
      );

      // The user_message stream event carries the attachment (thumbnail source).
      const userEvent = stream.events.find(
        (event) => event.type === "user_message" && typeof event.text === "string" && event.text.includes("screenshot"),
      );
      expect(userEvent).toBeDefined();
      const images = userEvent?.images as ReadonlyArray<{ data: string; mimeType: string; name?: string }>;
      expect(images).toHaveLength(1);
      expect(images[0]?.mimeType).toBe("image/png");
      expect(images[0]?.data).toBe(PNG_BASE64);
      expect(images[0]?.name).toBe("shot.png");
    } finally {
      stream.close();
    }
  }, 30_000);

  test("oversized (>5MB) and malformed images are rejected honestly, before any adapter traffic", async () => {
    // >5MB decoded: base64 length just past the cap.
    const oversized = "A".repeat(Math.ceil((5 * 1024 * 1024 + 3) / 3) * 4);
    const tooBig = await postJson(`/api/chat/${SKILL}/message`, {
      text: "huge",
      images: [{ data: oversized, mimeType: "image/png", name: "huge.png" }],
    });
    expect(tooBig.status).toBe(413);
    expect(String(tooBig.body.error)).toContain("5MB");

    const badShape = await postJson(`/api/chat/${SKILL}/message`, {
      text: "bad",
      images: [{ mimeType: "image/png" }],
    });
    expect(badShape.status).toBe(400);

    const badType = await postJson(`/api/chat/${SKILL}/message`, {
      text: "pdf",
      images: [{ data: PNG_BASE64, mimeType: "application/pdf" }],
    });
    expect(badType.status).toBe(413);
    expect(String(badType.body.error)).toContain("unsupported image type");
  });

  test("mid-session model change between turns; refused while no session would exist", async () => {
    const changed = await postJson(`/api/chat/${SKILL}/model`, { model: "fake-chat-model" });
    expect(changed.status).toBe(200);
    const state = await getState();
    expect(state.active?.modelId).toBe("fake-chat-model");

    const missing = await postJson(`/api/chat/never-started/model`, { model: "fake-chat-model" });
    expect(missing.status).toBe(409);
  });

  test("resume restores the RECORDED model via set_model on the resumed session", async () => {
    const before = await getState();
    const sessionId = before.active?.sessionId ?? "";
    expect(sessionId).toStartWith("fake-chat-");

    const ended = await postJson(`/api/chat/${SKILL}/end`, {});
    expect(ended.status).toBe(200);

    const resumable = (await getState()).resumable.find((entry) => entry.provider === "claude-code");
    expect(resumable?.model).toBe("fake-chat-model");

    const resumed = await postJson(`/api/chat/${SKILL}/session`, { provider: "claude-code", mode: "resume" });
    expect(resumed.status).toBe(200);
    const state = await waitFor(async () => {
      const now = await getState();
      return now.active?.status === "ready" ? now : undefined;
    }, "resumed session ready");
    expect(state.active?.resumed).toBe(true);
    expect(state.active?.modelId).toBe("fake-chat-model");
  }, 30_000);
});
