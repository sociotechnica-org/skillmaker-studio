import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import { checkTransition, guardStatus, STAGES } from "../src/Machine.ts";
import type { JournalEvent } from "../src/Journal.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });
const agent = Actor.make({ kind: "agent", name: "william", provider: "claude-code" });

let counter = 0;
const envelope = <T extends string>(type: T, who: Actor = actor) => {
  counter += 1;
  return {
    schemaVersion: 1 as const,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    at: new Date(2026, 6, 10, 0, 0, counter).toISOString(),
    actor: who,
    type,
  };
};

const created = (bundle: string): JournalEvent =>
  ({ ...envelope("bundle.created"), payload: { bundle } }) as JournalEvent;

const staged = (bundle: string, from: string, to: string, reason?: string): JournalEvent =>
  ({
    ...envelope("bundle.stage_changed"),
    payload: { bundle, from, to, ...(reason !== undefined ? { reason } : {}) },
  }) as JournalEvent;

const reviewRequested = (bundle: string, state: string): JournalEvent =>
  ({ ...envelope("review.requested", agent), payload: { bundle, state } }) as JournalEvent;

const reviewResolved = (
  bundle: string,
  state: string,
  decision: "approve" | "revise",
): JournalEvent => ({ ...envelope("review.resolved"), payload: { bundle, state, decision } }) as JournalEvent;

const gateDecided = (bundle: string, decision: "approved" | "declined", basis = "evidence"): JournalEvent =>
  ({
    ...envelope("bundle.gate_decided"),
    payload: { bundle, gate: "publish", decision, basis },
  }) as JournalEvent;

describe("STAGES", () => {
  test("is the ruled ladder in order", () => {
    expect(STAGES).toEqual(["idea", "researching", "drafting", "evaluating", "published"]);
  });
});

describe("checkTransition", () => {
  test("stale from is rejected", () => {
    const events = [created("demo")];
    const verdict = checkTransition(events, { bundle: "demo", from: "researching", to: "drafting" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/stale "from"/);
  });

  test("forward one stage without an approved review is rejected", () => {
    const events = [created("demo")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/approved review/);
  });

  test("forward one stage with an approved review is allowed", () => {
    const events = [created("demo"), reviewRequested("demo", "idea"), reviewResolved("demo", "idea", "approve")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict).toEqual({ allowed: true });
  });

  test("forward one stage with only a 'revise' decision is rejected", () => {
    const events = [created("demo"), reviewRequested("demo", "idea"), reviewResolved("demo", "idea", "revise")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict.allowed).toBe(false);
  });

  test("double-forward (skip a stage) is rejected even with approval", () => {
    const events = [created("demo"), reviewResolved("demo", "idea", "approve")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "drafting" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/one stage at a time/);
  });

  test("to equals from is rejected", () => {
    const events = [created("demo")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "idea" });
    expect(verdict.allowed).toBe(false);
  });

  test("backward move without a reason is rejected", () => {
    const events = [created("demo"), staged("demo", "idea", "researching")];
    const verdict = checkTransition(events, { bundle: "demo", from: "researching", to: "idea" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/require a non-empty reason/);
  });

  test("backward move with a whitespace-only reason is rejected", () => {
    const events = [created("demo"), staged("demo", "idea", "researching")];
    const verdict = checkTransition(events, {
      bundle: "demo",
      from: "researching",
      to: "idea",
      reason: "   ",
    });
    expect(verdict.allowed).toBe(false);
  });

  test("backward move with a reason is allowed, regardless of review state", () => {
    const events = [created("demo"), staged("demo", "idea", "researching")];
    const verdict = checkTransition(events, {
      bundle: "demo",
      from: "researching",
      to: "idea",
      reason: "the research turned out thin",
    });
    expect(verdict).toEqual({ allowed: true });
  });

  test("backward move across multiple stages is allowed with a reason", () => {
    const events = [
      created("demo"),
      staged("demo", "idea", "researching"),
      staged("demo", "researching", "drafting"),
      staged("demo", "drafting", "evaluating"),
    ];
    const verdict = checkTransition(events, {
      bundle: "demo",
      from: "evaluating",
      to: "idea",
      reason: "start over",
    });
    expect(verdict).toEqual({ allowed: true });
  });

  test("override is always allowed, even with a stale from and no reason", () => {
    const events = [created("demo")];
    const verdict = checkTransition(events, {
      bundle: "demo",
      from: "evaluating",
      to: "published",
      override: true,
    });
    expect(verdict).toEqual({ allowed: true });
  });

  test("override is always allowed for a backward move with no reason", () => {
    const events = [created("demo"), staged("demo", "idea", "researching")];
    const verdict = checkTransition(events, {
      bundle: "demo",
      from: "researching",
      to: "idea",
      override: true,
    });
    expect(verdict).toEqual({ allowed: true });
  });

  test("evaluating -> published requires both an approved review and an approved gate", () => {
    const events = [
      created("demo"),
      staged("demo", "idea", "researching"),
      reviewResolved("demo", "researching", "approve"),
      staged("demo", "researching", "drafting"),
      reviewResolved("demo", "drafting", "approve"),
      staged("demo", "drafting", "evaluating"),
    ];

    // Neither review nor gate yet.
    const noneVerdict = checkTransition(events, { bundle: "demo", from: "evaluating", to: "published" });
    expect(noneVerdict.allowed).toBe(false);

    // Review approved, no gate.
    const reviewOnly = [...events, reviewResolved("demo", "evaluating", "approve")];
    const reviewOnlyVerdict = checkTransition(reviewOnly, { bundle: "demo", from: "evaluating", to: "published" });
    expect(reviewOnlyVerdict.allowed).toBe(false);
    expect(reviewOnlyVerdict.allowed === false && reviewOnlyVerdict.reason).toMatch(/publish gate/);

    // Gate approved, no review.
    const gateOnly = [...events, gateDecided("demo", "approved")];
    const gateOnlyVerdict = checkTransition(gateOnly, { bundle: "demo", from: "evaluating", to: "published" });
    expect(gateOnlyVerdict.allowed).toBe(false);

    // Both.
    const both = [...events, reviewResolved("demo", "evaluating", "approve"), gateDecided("demo", "approved")];
    const bothVerdict = checkTransition(both, { bundle: "demo", from: "evaluating", to: "published" });
    expect(bothVerdict).toEqual({ allowed: true });
  });

  test("a declined gate decision does not satisfy the publish gate", () => {
    const events = [
      created("demo"),
      staged("demo", "idea", "researching"),
      staged("demo", "researching", "drafting"),
      staged("demo", "drafting", "evaluating"),
      reviewResolved("demo", "evaluating", "approve"),
      gateDecided("demo", "declined", "not ready"),
    ];
    const verdict = checkTransition(events, { bundle: "demo", from: "evaluating", to: "published" });
    expect(verdict.allowed).toBe(false);
  });

  test("an approval that predates the last stage change is stale and does not count", () => {
    const events = [
      created("demo"),
      reviewResolved("demo", "idea", "approve"),
      staged("demo", "idea", "researching"),
      // Regress back to idea -- the old idea approval is now stale.
      staged("demo", "researching", "idea", "regression"),
    ];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict.allowed).toBe(false);
  });

  test("a fresh approval recorded after the regression satisfies the forward guard again", () => {
    const events = [
      created("demo"),
      reviewResolved("demo", "idea", "approve"),
      staged("demo", "idea", "researching"),
      staged("demo", "researching", "idea", "regression"),
      reviewResolved("demo", "idea", "approve"),
    ];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict).toEqual({ allowed: true });
  });

  test("an approval for a different bundle does not satisfy the guard", () => {
    const events = [created("demo"), created("other"), reviewResolved("other", "idea", "approve")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict.allowed).toBe(false);
  });

  test("an approval for a different state does not satisfy the guard", () => {
    const events = [created("demo"), reviewResolved("demo", "researching", "approve")];
    const verdict = checkTransition(events, { bundle: "demo", from: "idea", to: "researching" });
    expect(verdict.allowed).toBe(false);
  });
});

describe("guardStatus", () => {
  test("a fresh bundle at idea is not approved for forward and gate is not approved", () => {
    const events = [created("demo")];
    expect(guardStatus(events, "demo")).toEqual({
      stage: "idea",
      approvedForForward: false,
      gateApproved: false,
    });
  });

  test("reflects an approved review at the current stage", () => {
    const events = [created("demo"), reviewResolved("demo", "idea", "approve")];
    expect(guardStatus(events, "demo")).toEqual({
      stage: "idea",
      approvedForForward: true,
      gateApproved: false,
    });
  });

  test("reflects gate approval independent of review approval", () => {
    const events = [
      created("demo"),
      staged("demo", "idea", "researching"),
      staged("demo", "researching", "drafting"),
      staged("demo", "drafting", "evaluating"),
      gateDecided("demo", "approved"),
    ];
    expect(guardStatus(events, "demo")).toEqual({
      stage: "evaluating",
      approvedForForward: false,
      gateApproved: true,
    });
  });

  test("resets to false after a stage change", () => {
    const events = [
      created("demo"),
      reviewResolved("demo", "idea", "approve"),
      staged("demo", "idea", "researching"),
    ];
    expect(guardStatus(events, "demo")).toEqual({
      stage: "researching",
      approvedForForward: false,
      gateApproved: false,
    });
  });

  test("an unknown bundle defaults to idea, unapproved", () => {
    expect(guardStatus([], "never-created")).toEqual({
      stage: "idea",
      approvedForForward: false,
      gateApproved: false,
    });
  });
});
