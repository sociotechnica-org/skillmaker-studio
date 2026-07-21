import { describe, expect, test } from "bun:test";
import { latestReviewOutcome, pendingReview } from "./reviewPanel.ts";
import { EventView, ActorView } from "./schemas.ts";

const actor = ActorView.make({ kind: "user", name: "jess" });

let counter = 0;
const event = (type: string, payload: unknown, at = "2026-07-21T12:00:00.000Z"): EventView =>
  EventView.make({ id: `ev-${counter++}`, type, at, actor, payload });

// Bundle-detail `events` arrive newest-first (Server.ts reverses); these
// fixtures are written in that order -- index 0 is the latest event.

describe("pendingReview", () => {
  test("returns undefined when there are no review events", () => {
    expect(pendingReview([event("bundle.created", { bundle: "demo" })], "drafting")).toBeUndefined();
  });

  test("finds the unresolved request and titles it by the REQUESTING state (#18)", () => {
    const events = [
      event("station.started", { bundle: "demo", state: "drafting" }),
      event("review.requested", {
        bundle: "demo",
        state: "drafting",
        question: "Is the trigger phrasing right?",
        artifacts: ["output/SKILL.md"],
      }),
    ];
    const pending = pendingReview(events, "drafting");
    expect(pending).toBeDefined();
    expect(pending?.requestedState).toBe("drafting");
    expect(pending?.title).toBe("Review the Draft-stage work");
    expect(pending?.staleNote).toBeUndefined();
    expect(pending?.question).toBe("Is the trigger phrasing right?");
    expect(pending?.artifacts).toEqual(["output/SKILL.md"]);
  });

  test("a stage advance does not relabel the review: the title keeps the requesting state and a stale note names the gap (#18)", () => {
    const events = [
      event("bundle.stage_changed", { bundle: "demo", from: "drafting", to: "evaluating" }),
      event("review.requested", { bundle: "demo", state: "drafting" }),
    ];
    const pending = pendingReview(events, "evaluating");
    expect(pending?.title).toBe("Review the Draft-stage work");
    expect(pending?.staleNote).toBe(
      "This review was requested by the Draft station; this skill has since moved to Evals. No Evals-stage work exists to approve yet.",
    );
  });

  test("a resolved request is not pending: review.resolved on top of the request means nothing is awaiting", () => {
    const events = [
      event("review.resolved", { bundle: "demo", state: "drafting", decision: "approve" }),
      event("review.requested", { bundle: "demo", state: "drafting" }),
    ];
    expect(pendingReview(events, "drafting")).toBeUndefined();
  });

  test("a NEW request after an old resolution is pending again", () => {
    const events = [
      event("review.requested", { bundle: "demo", state: "drafting" }),
      event("review.resolved", { bundle: "demo", state: "drafting", decision: "revise", notes: "tighten it" }),
      event("review.requested", { bundle: "demo", state: "drafting" }),
    ];
    expect(pendingReview(events, "drafting")?.title).toBe("Review the Draft-stage work");
  });

  test("an unreadable request payload still yields a generic title, never a current-stage label", () => {
    const events = [event("review.requested", "garbage")];
    const pending = pendingReview(events, "evaluating");
    expect(pending?.title).toBe("Review the submitted work");
    expect(pending?.requestedState).toBeUndefined();
  });
});

describe("latestReviewOutcome", () => {
  test("returns undefined when no review was ever resolved", () => {
    const events = [event("review.requested", { bundle: "demo", state: "drafting" })];
    expect(latestReviewOutcome(events, "drafting")).toBeUndefined();
  });

  test("a send-back surfaces decision, timestamp, notes, and the notes' destination (#13)", () => {
    const events = [
      event(
        "review.resolved",
        { bundle: "demo", state: "drafting", decision: "revise", notes: "Name the exact trigger phrase." },
        "2026-07-21T15:30:00.000Z",
      ),
      event("review.requested", { bundle: "demo", state: "drafting" }),
    ];
    const outcome = latestReviewOutcome(events, "drafting");
    expect(outcome?.decision).toBe("revise");
    expect(outcome?.headline).toBe("Sent back");
    expect(outcome?.at).toBe("2026-07-21T15:30:00.000Z");
    expect(outcome?.notes).toBe("Name the exact trigger phrase.");
    expect(outcome?.nextStep).toBe("Notes were recorded and will be given to the agent on the next station run.");
  });

  test("approve-with-notes keeps the notes visible but never promises them to the agent (#15)", () => {
    const events = [
      event("review.resolved", { bundle: "demo", state: "evaluating", decision: "approve", notes: "LGTM with nits." }),
    ];
    const outcome = latestReviewOutcome(events, "evaluating");
    expect(outcome?.decision).toBe("approve");
    expect(outcome?.headline).toBe("Approved");
    expect(outcome?.notes).toBe("LGTM with nits.");
    expect(outcome?.nextStep).toBe("Approval recorded; the notes are kept in the journal for the record.");
  });

  test("a plain approve reads as approval with the forward step said out loud", () => {
    const events = [event("review.resolved", { bundle: "demo", state: "evaluating", decision: "approve" })];
    expect(latestReviewOutcome(events, "evaluating")?.nextStep).toBe(
      "Approval recorded — this stage can move forward.",
    );
  });

  test("only the newest resolution wins, and outcomes for OTHER stages' work are not misfiled under the current stage", () => {
    const events = [
      event("review.resolved", { bundle: "demo", state: "drafting", decision: "revise", notes: "old stage" }),
      event("review.resolved", { bundle: "demo", state: "evaluating", decision: "revise", notes: "second round" }),
      event("review.resolved", { bundle: "demo", state: "evaluating", decision: "revise", notes: "first round" }),
    ];
    expect(latestReviewOutcome(events, "evaluating")?.notes).toBe("second round");
    expect(latestReviewOutcome(events, "drafting")?.notes).toBe("old stage");
    expect(latestReviewOutcome(events, "researching")).toBeUndefined();
  });
});
