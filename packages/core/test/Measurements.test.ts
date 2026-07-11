/**
 * Unit tests for Measurements.ts: CI math against known values, and the
 * "never pooled" grouping law (data-model.md §2.11, §1.1 laws 5-6).
 */
import { describe, expect, test } from "bun:test";
import {
  computeMeasurements,
  confidenceInterval,
  guidanceForN,
  ruleOfThreeCi,
  SMOKE_K,
  ESTIMATE_K,
  SHIP_GATE_K,
  wilsonCi,
} from "../src/Measurements.ts";
import type { RunIndexRecord } from "../src/IndexService.ts";

const run = (overrides: Partial<RunIndexRecord> & { id: string }): RunIndexRecord => ({
  bundle: "example-skill",
  fixtureCase: "golden-basic",
  versionHash: "sha256:v1",
  provider: "claude-code",
  model: "fake-model-1",
  startedAt: "2026-07-10T00:00:00.000Z",
  status: "completed",
  verdict: "pass",
  ...overrides,
});

describe("ruleOfThreeCi", () => {
  test("n=5, 0 failures -> [1 - 3/5, 1] = [0.4, 1]", () => {
    const [lo, hi] = ruleOfThreeCi(5);
    expect(lo).toBeCloseTo(0.4, 10);
    expect(hi).toBe(1);
  });

  test("n=30, 0 failures -> [1 - 0.1, 1] = [0.9, 1]", () => {
    const [lo, hi] = ruleOfThreeCi(30);
    expect(lo).toBeCloseTo(0.9, 10);
    expect(hi).toBe(1);
  });

  test("n=3 clamps lo at 0, not negative", () => {
    const [lo, hi] = ruleOfThreeCi(3);
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });

  test("n=0 -> [0, 1]", () => {
    expect(ruleOfThreeCi(0)).toEqual([0, 1]);
  });
});

describe("wilsonCi", () => {
  // Known reference values for the 95% Wilson interval.
  test("10/10 passes (no failures path not used here, but exercise the formula directly)", () => {
    const [lo, hi] = wilsonCi(10, 10);
    expect(lo).toBeGreaterThan(0.6);
    expect(hi).toBeCloseTo(1, 10);
  });

  test("5/10 -> symmetric-ish interval around 0.5", () => {
    const [lo, hi] = wilsonCi(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
  });

  test("0/10 -> lower bound 0", () => {
    const [lo, hi] = wilsonCi(0, 10);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(0.4);
  });

  test("27/30 known Wilson value (hand-derived: z=1.959963984540054, p=0.9)", () => {
    const [lo, hi] = wilsonCi(27, 30);
    expect(lo).toBeCloseTo(0.7438, 3);
    expect(hi).toBeCloseTo(0.9654, 3);
  });
});

describe("confidenceInterval", () => {
  test("0 failures dispatches to rule-of-three", () => {
    expect(confidenceInterval(5, 5)).toEqual(ruleOfThreeCi(5));
  });

  test("any failure dispatches to Wilson", () => {
    expect(confidenceInterval(4, 5)).toEqual(wilsonCi(4, 5));
  });

  test("n=0 -> null", () => {
    expect(confidenceInterval(0, 0)).toBeNull();
  });
});

describe("guidanceForN", () => {
  test("below smoke threshold -> undefined", () => {
    expect(guidanceForN(0)).toBeUndefined();
    expect(guidanceForN(SMOKE_K - 1)).toBeUndefined();
  });

  test("meets smoke but not estimate", () => {
    expect(guidanceForN(SMOKE_K)).toBe("smoke");
    expect(guidanceForN(ESTIMATE_K - 1)).toBe("smoke");
  });

  test("meets estimate but not ship-gate", () => {
    expect(guidanceForN(ESTIMATE_K)).toBe("estimate");
    expect(guidanceForN(SHIP_GATE_K - 1)).toBe("estimate");
  });

  test("meets ship-gate", () => {
    expect(guidanceForN(SHIP_GATE_K)).toBe("ship-gate");
    expect(guidanceForN(SHIP_GATE_K + 500)).toBe("ship-gate");
  });
});

describe("computeMeasurements: never pooled", () => {
  test("groups strictly by bundle/fixtureCase/versionHash/provider/model", () => {
    const runs: ReadonlyArray<RunIndexRecord> = [
      run({ id: "r1" }),
      run({ id: "r2" }),
      // different fixture case -> separate cell
      run({ id: "r3", fixtureCase: "golden-other" }),
      // different version hash -> separate cell (new version resets)
      run({ id: "r4", versionHash: "sha256:v2" }),
      // different provider -> separate cell
      run({ id: "r5", provider: "codex" }),
      // different model -> separate cell
      run({ id: "r6", model: "fake-model-2" }),
    ];
    const measurements = computeMeasurements(runs);
    // 5 distinct keys: {v1,claude-code,fake-model-1,golden-basic}(x2 runs),
    // {v1,claude-code,fake-model-1,golden-other}, {v2,...}, {codex,...}, {model-2,...}
    expect(measurements).toHaveLength(5);
    const base = measurements.find(
      (m) => m.fixtureCase === "golden-basic" && m.versionHash === "sha256:v1" && m.provider === "claude-code" && m.model === "fake-model-1",
    );
    expect(base?.n).toBe(2);
    expect(base?.passes).toBe(2);
    for (const m of measurements) {
      if (m !== base) expect(m.n).toBe(1);
    }
  });

  test("ignores running/failed/infra-error runs and ungraded runs", () => {
    const runs: ReadonlyArray<RunIndexRecord> = [
      run({ id: "r1", status: "running", verdict: undefined }),
      run({ id: "r2", status: "infra-error", verdict: undefined }),
      run({ id: "r3", status: "completed", verdict: undefined }), // completed but not yet graded
      run({ id: "r4", status: "completed", verdict: "pass" }),
    ];
    const measurements = computeMeasurements(runs);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.n).toBe(1);
  });

  test("partial does not count as a pass", () => {
    const runs: ReadonlyArray<RunIndexRecord> = [
      run({ id: "r1", verdict: "pass" }),
      run({ id: "r2", verdict: "partial" }),
      run({ id: "r3", verdict: "fail" }),
    ];
    const [measurement] = computeMeasurements(runs);
    expect(measurement?.n).toBe(3);
    expect(measurement?.passes).toBe(1);
    expect(measurement?.passRate).toBeCloseTo(1 / 3, 10);
  });

  test("all-pass cell uses rule-of-three CI, mixed cell uses Wilson", () => {
    const allPass: ReadonlyArray<RunIndexRecord> = [
      run({ id: "r1", verdict: "pass" }),
      run({ id: "r2", verdict: "pass" }),
      run({ id: "r3", verdict: "pass" }),
    ];
    const [allPassMeasurement] = computeMeasurements(allPass);
    expect(allPassMeasurement?.ci).toEqual(ruleOfThreeCi(3));

    const mixed: ReadonlyArray<RunIndexRecord> = [
      run({ id: "r1", verdict: "pass" }),
      run({ id: "r2", verdict: "fail" }),
      run({ id: "r3", verdict: "pass" }),
    ];
    const [mixedMeasurement] = computeMeasurements(mixed);
    expect(mixedMeasurement?.ci).toEqual(wilsonCi(2, 3));
  });
});
