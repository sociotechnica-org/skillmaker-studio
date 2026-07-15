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
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } };
    const events: ReadonlyArray<JournalEvent> = [created];
    const states = foldBundleStates(events);
    expect(states.get("demo")).toEqual({
      slug: "demo",
      stage: "idea",
      substate: "working",
      archived: false,
      stageChangedAt: created.at,
    });
  });

  test("stageChangedAt (issue #82): bundle.created stamps it when no move has happened yet", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } };
    const states = foldBundleStates([created]);
    expect(states.get("demo")?.stageChangedAt).toBe(created.at);
  });

  test("stageChangedAt: bundle.stage_changed re-stamps it to the move's own `at`", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } };
    const moved = {
      ...envelope("bundle.stage_changed"),
      payload: { bundle: "demo", from: "idea", to: "researching" },
    } as JournalEvent;
    const states = foldBundleStates([created, moved]);
    expect(states.get("demo")?.stageChangedAt).toBe(moved.at);
    expect(states.get("demo")?.stageChangedAt).not.toBe(created.at);
  });

  test("stageChangedAt: a backward move (re-conception) re-stamps like any other move -- no special case", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } };
    const toPublished = {
      ...envelope("bundle.stage_changed"),
      payload: { bundle: "demo", from: "evaluating", to: "published" },
    } as JournalEvent;
    const backward = {
      ...envelope("bundle.stage_changed"),
      payload: { bundle: "demo", from: "published", to: "drafting", reason: "re-conception" },
    } as JournalEvent;
    const states = foldBundleStates([created, toPublished, backward]);
    expect(states.get("demo")?.stage).toBe("drafting");
    expect(states.get("demo")?.stageChangedAt).toBe(backward.at);
  });

  test("stageChangedAt: absent for a bundle implicitly created by the tolerant fold", () => {
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("bundle.archived"), payload: { bundle: "never-created" } },
    ];
    const states = foldBundleStates(events);
    expect(states.get("never-created")?.stageChangedAt).toBeUndefined();
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

  test("unrelated event types (bundle.gate_decided, todo.*, run.*, station.started, skill.field_report) do not affect state", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } };
    const events: ReadonlyArray<JournalEvent> = [
      created,
      {
        ...envelope("bundle.gate_decided"),
        payload: { bundle: "demo", gate: "publish", decision: "approved", basis: "evals pass" },
      },
      {
        ...envelope("station.started"),
        payload: { bundle: "demo", state: "researching" },
      },
      {
        ...envelope("skill.field_report"),
        payload: { bundle: "demo", outcome: "failed", report: "Broke on an edge case." },
      },
    ];
    const states = foldBundleStates(events);
    expect(states.get("demo")).toEqual({
      slug: "demo",
      stage: "idea",
      substate: "working",
      archived: false,
      stageChangedAt: created.at,
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

  test("extracts the bundle field from skill.field_report (issue #67)", () => {
    const event = {
      ...envelope("skill.field_report"),
      payload: { bundle: "demo", outcome: "worked", report: "Worked great." },
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
