import { describe, expect, test } from "bun:test";
import { nextAction, nextStageOf } from "./nextAction.ts";

const guard = (approvedForForward: boolean, gateApproved = false) => ({ approvedForForward, gateApproved });

describe("nextStageOf", () => {
  test("walks the pipeline and ends at published", () => {
    expect(nextStageOf("idea")).toBe("researching");
    expect(nextStageOf("researching")).toBe("drafting");
    expect(nextStageOf("drafting")).toBe("evaluating");
    expect(nextStageOf("evaluating")).toBe("published");
    expect(nextStageOf("published")).toBeUndefined();
  });
});

describe("nextAction", () => {
  test("published is terminal", () => {
    expect(nextAction("published", "working", guard(true, true))).toEqual({ kind: "terminal" });
  });

  test("evaluating routes to the publish gate regardless of guard or substate", () => {
    // The gate branch itself renders the approve affordance for each substate,
    // so evaluating never strands even while awaiting-review / unapproved.
    expect(nextAction("evaluating", "working", guard(false))).toEqual({ kind: "gate" });
    expect(nextAction("evaluating", "working", guard(true))).toEqual({ kind: "gate" });
    expect(nextAction("evaluating", "awaiting-review", guard(false))).toEqual({ kind: "gate" });
  });

  test("a pending review yields the review step (approve & advance / send back)", () => {
    expect(nextAction("researching", "awaiting-review", guard(false))).toEqual({
      kind: "review",
      nextStage: "drafting",
    });
  });

  test("already approved but not moved yields a plain advance", () => {
    expect(nextAction("idea", "working", guard(true))).toEqual({ kind: "advance", nextStage: "researching" });
  });

  test("human-authored working state collapses to one-click approve & advance", () => {
    expect(nextAction("idea", "working", guard(false))).toEqual({ kind: "approve-advance", nextStage: "researching" });
    expect(nextAction("drafting", "working", guard(false))).toEqual({
      kind: "approve-advance",
      nextStage: "evaluating",
    });
  });

  test("awaiting-review takes precedence over an approved guard", () => {
    // Defensive: if both somehow hold, the pending review is what the human sees.
    expect(nextAction("researching", "awaiting-review", guard(true)).kind).toBe("review");
  });
});
