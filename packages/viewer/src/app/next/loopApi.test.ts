/**
 * Payload-builder tests for the loop client helpers (loopApi.ts) -- the
 * review-honesty rules (#130) and the legal-backward mechanic are enforced
 * here, at the builder level, so no future UI can weaken them.
 */
import { describe, expect, test } from "bun:test";
import {
  AdoptReport,
  adoptEmptyReason,
  buildAdvance,
  buildMoveBack,
  buildReviewResolution,
  nextStage,
} from "./loopApi.ts";

describe("buildReviewResolution", () => {
  test("approve without notes: payload carries no notes key", () => {
    const built = buildReviewResolution("my-skill", "drafting", "approve", undefined);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.type).toBe("review.resolved");
    expect(built.input.payload).toEqual({ bundle: "my-skill", state: "drafting", decision: "approve" });
  });

  test("approve with notes: notes ride along, trimmed (#130 'LGTM with nits')", () => {
    const built = buildReviewResolution("my-skill", "drafting", "approve", "  nice, tighten §2  ");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.payload).toEqual({
      bundle: "my-skill",
      state: "drafting",
      decision: "approve",
      notes: "nice, tighten §2",
    });
  });

  test("approve with blank notes: treated as no notes, not an empty string", () => {
    const built = buildReviewResolution("my-skill", "researching", "approve", "   ");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect("notes" in (built.input.payload as Record<string, unknown>)).toBe(false);
  });

  test("send-back requires notes (#130): empty and whitespace-only are refused", () => {
    for (const notes of [undefined, "", "   \n  "]) {
      const built = buildReviewResolution("my-skill", "drafting", "revise", notes);
      expect(built.ok).toBe(false);
      if (built.ok) continue;
      expect(built.error).toContain("requires notes");
    }
  });

  test("send-back with notes: builds the revise payload, state is the requesting station's", () => {
    const built = buildReviewResolution("my-skill", "researching", "revise", "cite the source for claim 3");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.payload).toEqual({
      bundle: "my-skill",
      state: "researching",
      decision: "revise",
      notes: "cite the source for claim 3",
    });
  });
});

describe("nextStage", () => {
  test("walks the ladder one rung at a time and ends at published", () => {
    expect(nextStage("idea")).toBe("researching");
    expect(nextStage("researching")).toBe("drafting");
    expect(nextStage("drafting")).toBe("evaluating");
    expect(nextStage("evaluating")).toBe("published");
    expect(nextStage("published")).toBeUndefined();
  });
});

describe("buildAdvance", () => {
  test("computes `to` from the ladder -- exactly one stage forward", () => {
    const built = buildAdvance("my-skill", "drafting");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.type).toBe("bundle.stage_changed");
    expect(built.input.payload).toEqual({ bundle: "my-skill", from: "drafting", to: "evaluating" });
  });

  test("never carries a reason or override -- forward moves are guard-checked, not excused", () => {
    const built = buildAdvance("my-skill", "idea");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const payload = built.input.payload as Record<string, unknown>;
    expect("reason" in payload).toBe(false);
    expect("override" in payload).toBe(false);
  });

  test("refuses to advance past the last stage", () => {
    const built = buildAdvance("my-skill", "published");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error).toContain("last stage");
  });
});

describe("buildMoveBack", () => {
  test("backward with a reason: builds the payload with the trimmed reason", () => {
    const built = buildMoveBack("my-skill", "evaluating", "drafting", "  fixture coverage exposed a design gap  ");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.payload).toEqual({
      bundle: "my-skill",
      from: "evaluating",
      to: "drafting",
      reason: "fixture coverage exposed a design gap",
    });
  });

  test("backward without a reason is refused (regression is a modeled fact -- it must be journaled)", () => {
    for (const reason of ["", "   "]) {
      const built = buildMoveBack("my-skill", "evaluating", "drafting", reason);
      expect(built.ok).toBe(false);
      if (built.ok) continue;
      expect(built.error).toContain("requires a reason");
    }
  });

  test("`to` must actually be earlier: same stage and forward stages are refused", () => {
    for (const to of ["drafting", "evaluating"] as const) {
      const built = buildMoveBack("my-skill", "drafting", to, "a perfectly good reason");
      expect(built.ok).toBe(false);
      if (built.ok) continue;
      expect(built.error).toContain("not earlier");
    }
  });
});

describe("adoptEmptyReason", () => {
  const report = (overrides: Partial<AdoptReport>): AdoptReport =>
    AdoptReport.make({
      found: 0,
      adopted: [],
      skipped: [],
      challenged: [],
      warnings: [],
      ...overrides,
    });

  test("nothing found: says so", () => {
    expect(adoptEmptyReason(report({}))).toBe("No SKILL.md found at that path.");
  });

  test("already adopted: says so", () => {
    expect(adoptEmptyReason(report({ found: 1, skipped: [{ relativePath: "skills/x" }] }))).toBe(
      "That skill is already adopted.",
    );
  });

  test("challenged arrival: points at the receiving dock, never silently stamps", () => {
    expect(adoptEmptyReason(report({ found: 1, challenged: [{ path: "skills/x" }] }))).toContain(
      "skillmaker receive",
    );
  });
});
