import { describe, expect, spyOn, test } from "bun:test";
import { WorkspaceConfig } from "../../core/src/Workspace.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSessionManager } from "../src/server/ChatSessions.ts";
import { HEARTBEAT_MS } from "../src/server/Sse.ts";

interface ScheduledInterval {
  readonly callback: TimerHandler;
  readonly delay: number;
  nextAt: number;
}

/** A deterministic interval clock: Bun 1.3's test mock has no fake-timer API. */
class IntervalClock {
  private now = 0;
  private nextId = 1;
  private readonly intervals = new Map<number, ScheduledInterval>();

  setInterval(callback: TimerHandler, delay = 0): ReturnType<typeof setInterval> {
    const id = this.nextId++;
    this.intervals.set(id, { callback, delay, nextAt: this.now + delay });
    return id as unknown as ReturnType<typeof setInterval>;
  }

  clearInterval(id: ReturnType<typeof setInterval>): void {
    this.intervals.delete(id as unknown as number);
  }

  get size(): number {
    return this.intervals.size;
  }

  get delays(): ReadonlyArray<number> {
    return [...this.intervals.values()].map((interval) => interval.delay);
  }

  advanceBy(ms: number): void {
    const target = this.now + ms;
    while (true) {
      const next = [...this.intervals.entries()]
        .filter(([, interval]) => interval.nextAt <= target)
        .sort(([, a], [, b]) => a.nextAt - b.nextAt)[0];
      if (next === undefined) break;
      const [id, interval] = next;
      this.now = interval.nextAt;
      interval.nextAt += interval.delay;
      interval.callback();
      // A callback is allowed to clear itself.
      if (!this.intervals.has(id)) continue;
    }
    this.now = target;
  }
}

const config = new WorkspaceConfig({
  schemaVersion: 1,
  name: "keepalive-test",
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

describe("chat SSE keepalive", () => {
  test("keeps a pre-session stream byte-active for 120 virtual seconds without data events", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-chat-sse-"));
    const clock = new IntervalClock();
    const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(clock.setInterval.bind(clock));
    const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(clock.clearInterval.bind(clock));
    const manager = new ChatSessionManager({ root, config });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const baselineTimers = clock.size;
      const response = manager.streamResponse("no-live-session");
      reader = (response.body as ReadableStream<Uint8Array>).getReader();

      expect(await readFrame(reader)).toBe(": connected\n\n");
      const initialState = await readFrame(reader);
      expect(initialState).toStartWith("data: ");
      expect(clock.delays).toContain(HEARTBEAT_MS);
      expect(clock.size).toBe(baselineTimers + 1);

      clock.advanceBy(8 * HEARTBEAT_MS);
      const frames = await Promise.all(Array.from({ length: 8 }, () => readFrame(reader)));
      expect(frames).toEqual(Array.from({ length: 8 }, () => ": keepalive\n\n"));

      // Comments never reach EventSource's message handler, so the initial
      // state data frame is the complete client-visible payload after idle.
      expect([initialState, ...frames].filter((frame) => frame.startsWith("data: "))).toEqual([initialState]);
      expect(clock.size).toBe(baselineTimers + 1);

      await reader.cancel();
      reader = undefined;
      expect(clock.size).toBe(baselineTimers);
      await manager.stop();
      expect(clock.size).toBe(0);
    } finally {
      await reader?.cancel();
      await manager.stop();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("clears one keepalive interval for every disconnected chat stream", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-chat-sse-"));
    const clock = new IntervalClock();
    const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(clock.setInterval.bind(clock));
    const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(clock.clearInterval.bind(clock));
    const manager = new ChatSessionManager({ root, config });
    const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = [];

    try {
      const baselineTimers = clock.size;
      for (const skill of ["one", "two", "three"]) {
        readers.push((manager.streamResponse(skill).body as ReadableStream<Uint8Array>).getReader());
      }
      expect(clock.size).toBe(baselineTimers + readers.length);

      await Promise.all(readers.map((reader) => reader.cancel()));
      expect(clock.size).toBe(baselineTimers);
      await manager.stop();
      expect(clock.size).toBe(0);
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
      await manager.stop();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
