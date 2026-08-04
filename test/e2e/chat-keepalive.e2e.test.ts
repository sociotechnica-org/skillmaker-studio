import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer, type StartedE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let server: StartedE2eRegistryServer;
let projectUrl: string;

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-chat-keepalive-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  const initialized = Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  expect(initialized.exitCode).toBe(0);
  server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  projectUrl = server.projectUrls[0] as string;
}, 60_000);

afterAll(async () => {
  server?.process.kill("SIGTERM");
  await server?.process.exited;
  if (scratchDir !== undefined) rmSync(scratchDir, { recursive: true, force: true });
});

describe("chat stream keepalive (#194)", () => {
  test("keeps a no-session stream open beyond Bun's idle timeout without changing its data frames", async () => {
    const controller = new AbortController();
    const response = await fetch(`${projectUrl}/chat/no-session/stream`, { signal: controller.signal });
    expect(response.ok).toBe(true);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const frames: Array<{ readonly text: string; readonly receivedAt: number }> = [];
    let buffer = "";
    let done = false;
    const connectedAt = Date.now();
    const heartbeatDeadline = connectedAt + 30_500;
    try {
      while (frames.filter((frame) => frame.text === ": keepalive\n\n").length < 2) {
        const remaining = heartbeatDeadline - Date.now();
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("keepalives did not arrive on time")), remaining)),
        ]);
        if (next.done) {
          done = true;
          break;
        }
        buffer += decoder.decode(next.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) frames.push({ text: `${part}\n\n`, receivedAt: Date.now() });
      }

      expect(done).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, connectedAt + 31_000 - Date.now())));
      const postTimeoutRead = await Promise.race([
        reader.read().then((next) => (next.done ? "closed" : "unexpected frame")),
        new Promise<"open">((resolve) => setTimeout(() => resolve("open"), 100)),
      ]);
      expect(postTimeoutRead).toBe("open");
      expect(frames.filter((frame) => frame.text === ": connected\n\n")).toHaveLength(1);
      const dataFrames = frames.filter((frame) => frame.text.startsWith("data: "));
      expect(dataFrames).toHaveLength(1);
      expect(JSON.parse(dataFrames[0]?.text.slice("data: ".length) ?? "")).toMatchObject({
        type: "state",
        state: { skill: "no-session", active: null },
      });
      const keepalives = frames.filter((frame) => frame.text === ": keepalive\n\n");
      expect(keepalives.length).toBeGreaterThanOrEqual(2);
      expect(keepalives[1]?.receivedAt - (keepalives[0]?.receivedAt ?? 0)).toBeGreaterThan(10_000);
      expect(keepalives[1]?.receivedAt - (keepalives[0]?.receivedAt ?? 0)).toBeLessThan(22_000);
    } finally {
      await reader.cancel();
      controller.abort();
    }
  }, 40_000);
});
