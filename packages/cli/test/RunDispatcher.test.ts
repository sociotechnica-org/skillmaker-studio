/**
 * Unit tests for the server's fixture-run dispatcher (RunDispatch.ts):
 * the (slug, fixture) duplicate guard, the concurrency cap (2) with FIFO
 * queueing, slot release on settle (success AND failure), and the
 * staleness-timeout orphan backstop. Pure bookkeeping -- `start` thunks are
 * hand-made deferred promises, no engine, no server.
 */
import { describe, expect, test } from "bun:test";
import { RunDispatcher } from "../src/server/RunDispatch.ts";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
  started: boolean;
}

const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  let reject: (cause: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const d: Deferred = { promise, resolve, reject, started: false };
  return d;
};

const startOf = (d: Deferred) => () => {
  d.started = true;
  return d.promise;
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("RunDispatcher", () => {
  test("runs immediately up to the cap; the third dispatch queues FIFO", async () => {
    const dispatcher = new RunDispatcher({ maxConcurrent: 2 });
    const [a, b, c] = [deferred(), deferred(), deferred()];

    const da = dispatcher.dispatch({ runId: "a", slug: "s", fixture: "f-a", start: startOf(a) });
    const db = dispatcher.dispatch({ runId: "b", slug: "s", fixture: "f-b", start: startOf(b) });
    const dc = dispatcher.dispatch({ runId: "c", slug: "s", fixture: "f-c", start: startOf(c) });
    if (!da.ok || !db.ok || !dc.ok) throw new Error("all three dispatches should be accepted");

    expect(da.queued).toBe(false);
    expect(db.queued).toBe(false);
    expect(dc.queued).toBe(true);
    expect(a.started).toBe(true);
    expect(b.started).toBe(true);
    expect(c.started).toBe(false);

    const states = dispatcher.listActive("s").map((entry) => [entry.fixture, entry.state]);
    expect(states).toEqual([
      ["f-a", "running"],
      ["f-b", "running"],
      ["f-c", "queued"],
    ]);

    // Completing one running entry promotes the queued one.
    a.resolve();
    await da.done;
    await tick();
    expect(c.started).toBe(true);
    expect(dispatcher.listActive("s")).toHaveLength(2);

    b.resolve();
    c.resolve();
    await db.done;
    await dc.done;
    expect(dispatcher.listActive("s")).toHaveLength(0);
  });

  test("duplicate (slug, fixture) is rejected while running AND while queued; other slugs unaffected", async () => {
    const dispatcher = new RunDispatcher({ maxConcurrent: 1 });
    const [a, b] = [deferred(), deferred()];

    const da = dispatcher.dispatch({ runId: "a", slug: "s", fixture: "same", start: startOf(a) });
    const db = dispatcher.dispatch({ runId: "b", slug: "s", fixture: "queued", start: startOf(b) });
    if (!da.ok || !db.ok) throw new Error("both should be accepted");

    // Duplicate of the RUNNING entry.
    expect(dispatcher.dispatch({ runId: "x", slug: "s", fixture: "same", start: startOf(deferred()) })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // Duplicate of the QUEUED entry.
    expect(dispatcher.dispatch({ runId: "y", slug: "s", fixture: "queued", start: startOf(deferred()) })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // Same fixture name in a DIFFERENT bundle is not a duplicate.
    const other = deferred();
    const dOther = dispatcher.dispatch({ runId: "z", slug: "other", fixture: "same", start: startOf(other) });
    expect(dOther.ok).toBe(true);

    // Freed after completion: the same (slug, fixture) can run again.
    a.resolve();
    await da.done;
    expect(dispatcher.isActive("s", "same")).toBe(false);
    const again = dispatcher.dispatch({ runId: "a2", slug: "s", fixture: "same", start: startOf(deferred()) });
    expect(again.ok).toBe(true);
  });

  test("a rejecting start still frees the slot and resolves done", async () => {
    const dispatcher = new RunDispatcher({ maxConcurrent: 1 });
    const failing = deferred();
    const next = deferred();

    const df = dispatcher.dispatch({ runId: "f", slug: "s", fixture: "boom", start: startOf(failing) });
    const dn = dispatcher.dispatch({ runId: "n", slug: "s", fixture: "next", start: startOf(next) });
    if (!df.ok || !dn.ok) throw new Error("both should be accepted");

    failing.reject(new Error("engine exploded"));
    await df.done;
    await tick();
    expect(dispatcher.isActive("s", "boom")).toBe(false);
    expect(next.started).toBe(true);
  });

  test("staleness timeout evicts a never-settling run so the guard cannot wedge", async () => {
    const dispatcher = new RunDispatcher({ maxConcurrent: 1, staleMs: 25 });
    const stuck = deferred(); // never settled
    const waiting = deferred();

    const ds = dispatcher.dispatch({ runId: "stuck", slug: "s", fixture: "hang", start: startOf(stuck) });
    const dw = dispatcher.dispatch({ runId: "w", slug: "s", fixture: "after", start: startOf(waiting) });
    if (!ds.ok || !dw.ok) throw new Error("both should be accepted");
    expect(waiting.started).toBe(false);

    await sleep(60);
    // Evicted: guard freed, done resolved, queued entry promoted.
    await ds.done;
    expect(dispatcher.isActive("s", "hang")).toBe(false);
    expect(waiting.started).toBe(true);

    // A late settle of the evicted run must not corrupt the accounting.
    stuck.resolve();
    await tick();
    waiting.resolve();
    await dw.done;
    expect(dispatcher.listActive()).toHaveLength(0);
  });

  test("listActive filters by slug and reports the runs-active wire fields", () => {
    const dispatcher = new RunDispatcher({ maxConcurrent: 2 });
    dispatcher.dispatch({ runId: "a", slug: "s1", fixture: "f1", start: startOf(deferred()) });
    dispatcher.dispatch({ runId: "b", slug: "s2", fixture: "f2", start: startOf(deferred()) });

    const s1 = dispatcher.listActive("s1");
    expect(s1).toHaveLength(1);
    const entry = s1[0];
    if (entry === undefined) throw new Error("expected one entry");
    expect(entry.runId).toBe("a");
    expect(entry.fixture).toBe("f1");
    expect(typeof entry.startedAt).toBe("string");
    expect(entry.state).toBe("running");
    expect(dispatcher.listActive()).toHaveLength(2);
  });
});
