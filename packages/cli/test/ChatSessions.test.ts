import { defaultConfig } from "@skillmaker/core";
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionManager } from "../src/server/ChatSessions.ts";
import { HEARTBEAT_MS } from "../src/server/Sse.ts";

const readFrame = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const { value, done } = await reader.read();
  expect(done).toBeFalse();
  return new TextDecoder().decode(value);
};

describe("ChatSessionManager.streamResponse", () => {
  test("keeps no-session streams alive without adding chat events and cleans up every response timer", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-chat-stream-test-"));
    const intervals: Array<{
      readonly callback: () => void;
      readonly delay: number | undefined;
      readonly handle: ReturnType<typeof setInterval>;
    }> = [];
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");
    setIntervalSpy.mockImplementation(
      ((callback: () => void, delay?: number) => {
        const handle = { callback, delay } as unknown as ReturnType<typeof setInterval>;
        intervals.push({ callback, delay, handle });
        return handle;
      }) as typeof setInterval,
    );
    clearIntervalSpy.mockImplementation((() => undefined) as typeof clearInterval);

    const manager = new ChatSessionManager({ root, config: defaultConfig("chat-stream-test") });
    try {
      const readers = Array.from({ length: 3 }, () => manager.streamResponse("no-session").body?.getReader());
      expect(readers.every((reader) => reader !== undefined)).toBe(true);

      for (const reader of readers) {
        expect(await readFrame(reader as ReadableStreamDefaultReader<Uint8Array>)).toBe(": connected\n\n");
        const stateFrame = await readFrame(reader as ReadableStreamDefaultReader<Uint8Array>);
        expect(stateFrame).toStartWith("data: ");
        expect(JSON.parse(stateFrame.slice("data: ".length))).toMatchObject({
          type: "state",
          state: { skill: "no-session", active: null },
        });
      }

      const heartbeats = intervals.filter((interval) => interval.delay === HEARTBEAT_MS);
      expect(heartbeats).toHaveLength(3);
      heartbeats[0]?.callback();
      expect(await readFrame(readers[0] as ReadableStreamDefaultReader<Uint8Array>)).toBe(": keepalive\n\n");

      await Promise.all(readers.map((reader) => (reader as ReadableStreamDefaultReader<Uint8Array>).cancel()));
      expect(clearIntervalSpy.mock.calls.map(([handle]) => handle)).toEqual(expect.arrayContaining(heartbeats.map(({ handle }) => handle)));
      expect(clearIntervalSpy.mock.calls).toHaveLength(3);
    } finally {
      manager.stop();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
