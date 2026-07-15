import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import { bundleForEvent, foldBundleStates } from "../src/Fold.ts";
import type { JournalEvent } from "../src/Journal.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let counter = 0;
const envelope = <T extends string>(type: T) => {
  counter += 1;
  return {
    schemaVersion: 1 as const,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    at: new Date(2026, 6, 10, 0, 0, counter).toISOString(),
    actor,
    type,
  };
};

describe("foldBundleStates", () => {
  test("bundle.created sets stage idea, substate working, archived false", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
    ];
    const states = foldBundleStates(events);
    expect(states.get("demo")).toEqual({
      slug: "demo",
      stage: "idea",
      substate: "working",
      archived: false,
    });
  });

  test("review.requested moves substate to awaiting-review; review.resolved moves it back", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
      {
        ...envelope("review.requested"),
        payload: { bundle: "demo", state: "idea" },
      },
    ];
    const afterRequest = foldBundleStates(events);
    expect(afterRequest.get("demo")?.substate).toBe("awaiting-review");

    const resolved: ReadonlyArray<JournalEvent> = [
      ...events,
      {
        ...envelope("review.resolved"),
        payload: { bundle: "demo", state: "idea", decision: "approve" },
      },
    ];
    const afterResolve = foldBundleStates(resolved);
    expect(afterResolve.get("demo")?.substate).toBe("working");
  });

  test("bundle.stage_changed applies the transition verbatim (no guard enforcement)", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
      {
        ...envelope("bundle.stage_changed"),
        payload: { bundle: "demo", from: "idea", to: "published" },
      },
    ];
    const states = foldBundleStates(events);
    expect(states.get("demo")?.stage).toBe("published");
  });

  test("bundle.archived / bundle.restored round-trip the archived flag", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
      { ...envelope("bundle.archived"), payload: { bundle: "demo" } },
    ];
    const archived = foldBundleStates(events);
    expect(archived.get("demo")?.archived).toBe(true);

    const restored = foldBundleStates([
      ...events,
      { ...envelope("bundle.restored"), payload: { bundle: "demo" } },
    ]);
    expect(restored.get("demo")?.archived).toBe(false);
  });

  test("a bundle referenced without bundle.created is implicitly created (tolerant fold)", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.archived"), payload: { bundle: "never-created" } },
    ];
    const states = foldBundleStates(events);
    expect(states.get("never-created")).toEqual({
      slug: "never-created",
      stage: "idea",
      substate: "working",
      archived: true,
    });
  });

  test("ordering matters: later events win", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
      {
        ...envelope("bundle.stage_changed"),
        payload: { bundle: "demo", from: "idea", to: "researching" },
      },
      {
        ...envelope("bundle.stage_changed"),
        payload: { bundle: "demo", from: "researching", to: "drafting" },
      },
      {
        ...envelope("bundle.stage_changed"),
        payload: { bundle: "demo", from: "drafting", to: "idea", reason: "regression" },
      },
    ];
    const states = foldBundleStates(events);
    expect(states.get("demo")?.stage).toBe("idea");
  });

  test("unrelated event types (bundle.gate_decided, todo.*, run.*, station.started) do not affect state", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "demo" } },
      {
        ...envelope("bundle.gate_decided"),
        payload: { bundle: "demo", gate: "publish", decision: "approved", basis: "evals pass" },
      },
      {
        ...envelope("station.started"),
        payload: { bundle: "demo", state: "researching" },
      },
    ];
    const states = foldBundleStates(events);
    expect(states.get("demo")).toEqual({
      slug: "demo",
      stage: "idea",
      substate: "working",
      archived: false,
    });
  });

  test("independent bundles fold independently", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.created"), payload: { bundle: "a" } },
      { ...envelope("bundle.created"), payload: { bundle: "b" } },
      {
        ...envelope("bundle.stage_changed"),
        payload: { bundle: "a", from: "idea", to: "researching" },
      },
    ];
    const states = foldBundleStates(events);
    expect(states.get("a")?.stage).toBe("researching");
    expect(states.get("b")?.stage).toBe("idea");
  });
});

describe("bundleForEvent", () => {
  test("extracts the direct bundle field", () => {
    const event = { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent;
    expect(bundleForEvent(event)).toBe("demo");
  });

  test("extracts the bundle field from skill.shipped (issue #66)", () => {
    const event = {
      ...envelope("skill.shipped"),
      payload: {
        bundle: "demo",
        versionHash: "sha256:aaa",
        destination: "acme-agent-fleet",
        purpose: "eval harness",
        receipts: [],
      },
    } as JournalEvent;
    expect(bundleForEvent(event)).toBe("demo");
  });

  test("returns undefined for event types with no bundle association", () => {
    const event = {
      ...envelope("run.completed"),
      payload: { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", status: "completed", endedAt: new Date().toISOString() },
    } as JournalEvent;
    expect(bundleForEvent(event)).toBeUndefined();
  });
});
