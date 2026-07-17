import { describe, expect, test } from "bun:test";
import {
  coverageTally,
  formatCI,
  formatPassRate,
  nextChips,
  provenOnProviders,
  providerModelId,
  SMOKE_K,
} from "./cardGlance.ts";
import type { FixtureRecord, MeasurementRecord, RiskCoverageRecord } from "./schemas.ts";

const cell = (overrides: Partial<MeasurementRecord>): MeasurementRecord => ({
  bundle: "demo",
  fixtureCase: "happy-path",
  versionHash: "sha256:aa",
  provider: "claude-code",
  model: "gpt-5.6-sol[xhigh]",
  n: 5,
  passes: 5,
  partial: 0,
  fail: 0,
  passRate: 1,
  ci: [0.6, 1],
  ...overrides,
});

const fixture = (caseName: string): FixtureRecord => ({
  bundle: "demo",
  caseName,
  class: "happy",
  risks: [],
  hasPromptMd: true,
});

const risk = (riskId: string, coverage: RiskCoverageRecord["coverage"]): RiskCoverageRecord => ({
  bundle: "demo",
  riskId,
  family: "IN",
  coverage,
});

describe("formatPassRate / formatCI (one display policy, chips and table alike)", () => {
  test("one decimal place on rates", () => {
    expect(formatPassRate(1)).toBe("100.0%");
    expect(formatPassRate(5 / 6)).toBe("83.3%");
    expect(formatPassRate(0)).toBe("0.0%");
  });

  test("CIs share the rate precision; a null interval is an em dash", () => {
    expect(formatCI([0.438, 1])).toBe("[43.8%, 100.0%]");
    expect(formatCI(null)).toBe("—");
  });
});

describe("providerModelId", () => {
  test("provider/model when a model id is recorded; provider alone otherwise -- always the exact recorded strings", () => {
    expect(providerModelId({ provider: "claude-code", model: "gpt-5.6-sol[xhigh]" })).toBe(
      "claude-code/gpt-5.6-sol[xhigh]",
    );
    expect(providerModelId({ provider: "claude-code", model: "" })).toBe("claude-code");
    expect(providerModelId({ provider: "claude-code", model: "claude-code" })).toBe("claude-code");
  });
});

describe("provenOnProviders", () => {
  test("no recorded version -> honest empty list, whatever was measured before", () => {
    expect(provenOnProviders([cell({})], undefined)).toEqual([]);
  });

  test("only cells at the latest version with >=1 pass count; deduped and sorted", () => {
    const cells = [
      cell({ provider: "b-provider", model: "" }),
      cell({ provider: "b-provider", model: "", fixtureCase: "other" }),
      cell({ provider: "a-provider", model: "m1" }),
      cell({ provider: "stale", model: "", versionHash: "sha256:old" }),
      cell({ provider: "all-fail", model: "", passes: 0, fail: 5, passRate: 0 }),
    ];
    expect(provenOnProviders(cells, "sha256:aa")).toEqual(["a-provider/m1", "b-provider"]);
  });
});

describe("coverageTally", () => {
  test("counts authored judgments; n/a rows are neither gaps nor total", () => {
    const rows = [risk("IN-1", "covered"), risk("IN-2", "partial"), risk("IN-3", "gap"), risk("IN-4", "n/a")];
    expect(coverageTally(rows)).toEqual({ covered: 1, partial: 1, gap: 1, total: 3 });
  });
});

describe("nextChips", () => {
  test("gap risks always chip; partial/covered never do", () => {
    const chips = nextChips({
      riskCoverage: [risk("IN-1", "gap"), risk("IN-2", "covered"), risk("IN-3", "partial")],
      fixtures: [],
      measurements: [],
      latestHash: "sha256:aa",
      providers: [],
    });
    expect(chips.map((chip) => chip.key)).toEqual(["risk-IN-1"]);
  });

  test("no recorded version: one record-a-version chip (when fixtures exist), no per-fixture noise", () => {
    const chips = nextChips({
      riskCoverage: [],
      fixtures: [fixture("happy-path"), fixture("edge")],
      measurements: [],
      latestHash: undefined,
      providers: ["claude-code"],
    });
    expect(chips.map((chip) => chip.key)).toEqual(["no-version"]);
  });

  test("unmeasured and below-smoke fixtures chip; a fixture at smoke n does not", () => {
    const chips = nextChips({
      riskCoverage: [],
      fixtures: [fixture("unmeasured"), fixture("thin"), fixture("smoked")],
      measurements: [
        cell({ fixtureCase: "thin", n: 2, passes: 2 }),
        cell({ fixtureCase: "smoked", n: SMOKE_K, passes: SMOKE_K }),
      ],
      latestHash: "sha256:aa",
      providers: [],
    });
    expect(chips.map((chip) => chip.key)).toEqual(["fixture-unmeasured", "fixture-thin"]);
    expect(chips[1]?.label).toContain("n=2");
  });

  test("configured providers with no cell at the latest version chip; measured ones do not", () => {
    const chips = nextChips({
      riskCoverage: [],
      fixtures: [],
      measurements: [cell({ provider: "claude-code" })],
      latestHash: "sha256:aa",
      providers: ["claude-code", "gemini-cli"],
    });
    expect(chips.map((chip) => chip.key)).toEqual(["provider-gemini-cli"]);
  });
});
