import { describe, expect, test } from "bun:test";
import {
  detectNonDiscriminatingChecks,
  formatSelfCritiqueWarning,
  MIN_GRADED_RUNS_FOR_SELF_CRITIQUE,
  type GradedRunChecks,
} from "../src/GraderSelfCritique.ts";

describe("detectNonDiscriminatingChecks", () => {
  test("flags a check that passed on every graded run (n >= threshold)", () => {
    const runs: GradedRunChecks[] = [
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: true }] },
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: true }] },
    ];
    const flags = detectNonDiscriminatingChecks(runs);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({
      bundle: "example-skill",
      fixtureCase: "golden-basic",
      checkText: "has frontmatter",
      n: 2,
      outcome: "always-pass",
    });
  });

  test("flags a check that failed on every graded run", () => {
    const runs: GradedRunChecks[] = [
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "handles edge case", pass: false }] },
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "handles edge case", pass: false }] },
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "handles edge case", pass: false }] },
    ];
    const flags = detectNonDiscriminatingChecks(runs);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.outcome).toBe("always-fail");
    expect(flags[0]?.n).toBe(3);
  });

  test("does not flag a check with mixed pass/fail results -- it discriminates", () => {
    const runs: GradedRunChecks[] = [
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "handles edge case", pass: true }] },
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "handles edge case", pass: false }] },
    ];
    expect(detectNonDiscriminatingChecks(runs)).toEqual([]);
  });

  test("does not flag a check below the minimum graded-run threshold", () => {
    expect(MIN_GRADED_RUNS_FOR_SELF_CRITIQUE).toBe(2);
    const runs: GradedRunChecks[] = [
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: true }] },
    ];
    expect(detectNonDiscriminatingChecks(runs)).toEqual([]);
  });

  test("groups independently by (bundle, fixtureCase, check text) -- same text in a different bundle/case is a separate group", () => {
    const runs: GradedRunChecks[] = [
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: true }] },
      { bundle: "example-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: true }] },
      { bundle: "other-skill", fixtureCase: "golden-basic", checks: [{ text: "has frontmatter", pass: false }] },
      { bundle: "example-skill", fixtureCase: "refusal-empty", checks: [{ text: "has frontmatter", pass: false }] },
    ];
    // Only the (example-skill, golden-basic, "has frontmatter") group has n >= 2 and agrees.
    const flags = detectNonDiscriminatingChecks(runs);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      bundle: "example-skill",
      fixtureCase: "golden-basic",
      checkText: "has frontmatter",
      outcome: "always-pass",
    });
  });

  test("multiple checks in a single graded run are grouped independently", () => {
    const runs: GradedRunChecks[] = [
      {
        bundle: "example-skill",
        fixtureCase: "golden-basic",
        checks: [
          { text: "has frontmatter", pass: true },
          { text: "handles edge case", pass: true },
        ],
      },
      {
        bundle: "example-skill",
        fixtureCase: "golden-basic",
        checks: [
          { text: "has frontmatter", pass: true },
          { text: "handles edge case", pass: false },
        ],
      },
    ];
    const flags = detectNonDiscriminatingChecks(runs);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.checkText).toBe("has frontmatter");
  });

  test("returns flags sorted by bundle, then fixtureCase, then check text", () => {
    const runs: GradedRunChecks[] = [
      { bundle: "z-skill", fixtureCase: "case-a", checks: [{ text: "z check", pass: true }] },
      { bundle: "z-skill", fixtureCase: "case-a", checks: [{ text: "z check", pass: true }] },
      { bundle: "a-skill", fixtureCase: "case-b", checks: [{ text: "b check", pass: true }] },
      { bundle: "a-skill", fixtureCase: "case-b", checks: [{ text: "b check", pass: true }] },
      { bundle: "a-skill", fixtureCase: "case-a", checks: [{ text: "a check", pass: true }] },
      { bundle: "a-skill", fixtureCase: "case-a", checks: [{ text: "a check", pass: true }] },
    ];
    const flags = detectNonDiscriminatingChecks(runs);
    expect(flags.map((f) => `${f.bundle}/${f.fixtureCase}/${f.checkText}`)).toEqual([
      "a-skill/case-a/a check",
      "a-skill/case-b/b check",
      "z-skill/case-a/z check",
    ]);
  });

  test("empty input yields no flags", () => {
    expect(detectNonDiscriminatingChecks([])).toEqual([]);
  });
});

describe("formatSelfCritiqueWarning", () => {
  test("formats an always-pass flag", () => {
    const message = formatSelfCritiqueWarning({
      bundle: "example-skill",
      fixtureCase: "golden-basic",
      checkText: "has frontmatter",
      n: 3,
      outcome: "always-pass",
    });
    expect(message).toBe(
      'check "has frontmatter" (fixture "golden-basic") passed on all 3 graded run(s) -- it may be non-discriminating',
    );
  });

  test("formats an always-fail flag", () => {
    const message = formatSelfCritiqueWarning({
      bundle: "example-skill",
      fixtureCase: "golden-basic",
      checkText: "handles edge case",
      n: 2,
      outcome: "always-fail",
    });
    expect(message).toBe(
      'check "handles edge case" (fixture "golden-basic") failed on all 2 graded run(s) -- it may be non-discriminating',
    );
  });
});
