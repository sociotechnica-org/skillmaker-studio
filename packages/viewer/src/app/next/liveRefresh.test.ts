import { describe, expect, test } from "bun:test";
import { BACKOFF_CAP_MS, backoffMs, createTrailingDebounce } from "./liveRefresh.ts";
import type { DebounceTimers } from "./liveRefresh.ts";

/**
 * Manual clock: timers fire only when `advance` crosses their deadline,
 * so debounce behavior is asserted without real time.
 */
const fakeClock = (): DebounceTimers & { readonly advance: (ms: number) => void; readonly pending: () => number } => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { readonly at: number; readonly fn: () => void }>();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    advance: (ms) => {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
};

describe("createTrailingDebounce", () => {
  test("a single signal emits once after the quiet period", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    debounced.signal();
    clock.advance(399);
    expect(emits).toBe(0);
    clock.advance(1);
    expect(emits).toBe(1);
  });

  test("a burst coalesces into one emit, timed from the last signal", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    for (let i = 0; i < 5; i++) {
      debounced.signal();
      clock.advance(100); // each event inside the 400ms window
    }
    expect(emits).toBe(0);
    clock.advance(300); // 400ms after the last signal
    expect(emits).toBe(1);
    expect(clock.pending()).toBe(0); // max-wait timer cleaned up too
  });

  test("a sustained stream still emits by max-wait, then keeps cadence", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    // Events every 300ms forever: trailing alone would never fire.
    for (let i = 0; i < 10; i++) {
      debounced.signal();
      clock.advance(300);
    }
    // 3000ms elapsed: one max-wait emit at 2000ms, next burst window open.
    expect(emits).toBe(1);
    clock.advance(400); // quiet: trailing fires for the post-emit signals
    expect(emits).toBe(2);
  });

  test("emits are per burst: quiet gap, then a new signal emits again", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    debounced.signal();
    clock.advance(400);
    debounced.signal();
    clock.advance(400);
    expect(emits).toBe(2);
  });

  test("cancel drops the pending emit and clears all timers", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    debounced.signal();
    debounced.cancel();
    clock.advance(5000);
    expect(emits).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  test("signalling again after an emit does not reuse the stale max-wait", () => {
    const clock = fakeClock();
    let emits = 0;
    const debounced = createTrailingDebounce(() => emits++, { debounceMs: 400, maxWaitMs: 2000 }, clock);
    debounced.signal();
    clock.advance(400); // emit #1; both timers cleared
    debounced.signal();
    clock.advance(1999); // well past the ORIGINAL max-wait deadline
    expect(emits).toBe(2); // trailing fired at +400, not early via stale max-wait
    expect(clock.pending()).toBe(0);
  });
});

describe("backoffMs", () => {
  test("doubles from 1s and caps at 30s", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(4)).toBe(16_000);
    expect(backoffMs(5)).toBe(30_000);
    expect(backoffMs(100)).toBe(BACKOFF_CAP_MS);
  });

  test("tolerates nonsense attempts without exploding", () => {
    expect(backoffMs(-3)).toBe(1000);
    expect(backoffMs(Number.MAX_SAFE_INTEGER)).toBe(BACKOFF_CAP_MS);
  });
});
