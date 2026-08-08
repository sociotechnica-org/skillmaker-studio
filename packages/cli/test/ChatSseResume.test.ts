import { describe, expect, test } from "bun:test";
import { WorkspaceConfig } from "../../core/src/Workspace.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionManager } from "../src/server/ChatSessions.ts";

const config = new WorkspaceConfig({
  schemaVersion: 1,
  name: "resume-test",
  skillsDir: "skills",
  viewer: { port: 4323 },
  trackRuns: true,
  providers: {},
  publishTargets: [],
});

const readFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const { done, value } = await reader.read();
  if (done || value === undefined) throw new Error("expected an open SSE stream");
  return new TextDecoder().decode(value);
};

describe("chat SSE resume framing", () => {
  test("a fresh manager resets stale or malformed Last-Event-ID values without fabricating history", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-chat-sse-resume-"));
    const manager = new ChatSessionManager({ root, config });
    try {
      for (const lastEventId of [undefined, "", "-1", "+1", "1.5", "1e3", " 1", "9007199254740992"]) {
        const headers = lastEventId === undefined ? undefined : { "last-event-id": lastEventId };
        const response = manager.streamResponse("restarted-session", new Request("http://localhost/stream", { headers }));
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        expect(await readFrame(reader)).toBe(": connected\n\n");
        expect(await readFrame(reader)).toStartWith('data: {"type":"state",');
        expect(await readFrame(reader)).toBe('data: {"type":"replay_reset"}\n\n');
        await reader.cancel();
      }
    } finally {
      await manager.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
