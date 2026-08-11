import { describe, expect, test } from "bun:test";
import {
  fixtureBodyText,
  fixtureHasLiveRun,
  fixturePurpose,
  buildGapTodoPayload,
  bundleModels,
  claimFixtureCases,
  claimStatusInScope,
  GAP_TITLE_SENTENCE_MAX,
  groupClaimsByFamily,
  modelChipsForClaim,
  promptSummary,
  READ_ONLY_ORIENTATION,
  readOnlyProofCaseEntries,
  readOnlyProofCaseLabels,
  RUNNING_STALE_MS,
  readOnlyStatusLabel,
  RESPONSE_SETTLE_MS,
  runAllButtonLabel,
  runsForFixture,
  shouldSettleMissingResponse,
  unclaimedFixtureCases,
} from "./evals.ts";
import type { Claim, EvalMeasurement, EvalRun } from "./types.ts";

const fixture = (caseName: string, risks: ReadonlyArray<string>) => ({ caseName, risks });

const cell = (overrides: Partial<EvalMeasurement>): EvalMeasurement => ({
  fixtureCase: "case-a",
  versionHash: "sha256:v2",
  model: "Opus 4.6",
  n: 3,
  passes: 3,
  ...overrides,
});

const run = (overrides: Partial<EvalRun> & { id: string }): EvalRun => ({
  fixtureCase: "case-a",
  versionHash: "sha256:v2",
  provider: "claude",
  model: "Opus 4.6",
  startedAt: "2026-07-20T10:00:00Z",
  status: "completed",
  verdict: null,
  ...overrides,
});

describe("claimFixtureCases", () => {
  test("case.json.risks is the join", () => {
    const fixtures = [fixture("a", ["IN-1"]), fixture("b", ["IN-1", "RE-1"]), fixture("c", ["RE-2"])];
    expect(claimFixtureCases("IN-1", fixtures, undefined)).toEqual(["a", "b"]);
  });

  test("the risk-map's authored fixtureCase column is honored as a fallback, without duplication", () => {
    const fixtures = [fixture("a", ["IN-1"])];
    expect(claimFixtureCases("IN-1", fixtures, "a")).toEqual(["a"]);
    expect(claimFixtureCases("IN-1", fixtures, "orphan")).toEqual(["a", "orphan"]);
  });
});

describe("unclaimedFixtureCases", () => {
  test("a fixture naming no known claim is evidence without a claim", () => {
    const fixtures = [fixture("a", ["IN-1"]), fixture("b", []), fixture("c", ["ZZ-9"])];
    expect(unclaimedFixtureCases(fixtures, ["IN-1", "RE-1"])).toEqual(["b", "c"]);
  });
});

describe("bundleModels", () => {
  test("union of measured models, sorted", () => {
    expect(bundleModels([cell({ model: "Sonnet 4.5" }), cell({ model: "Opus 4.6" }), cell({ model: "Opus 4.6" })])).toEqual([
      "Opus 4.6",
      "Sonnet 4.5",
    ]);
  });
});

describe("modelChipsForClaim", () => {
  const measurements = [
    // Opus: passing at v2 (the latest).
    cell({ model: "Opus 4.6", versionHash: "sha256:v2", passes: 2, n: 3 }),
    // Sonnet: measured-failing at v2.
    cell({ model: "Sonnet 4.5", versionHash: "sha256:v2", passes: 0, n: 2 }),
    // Haiku: only an old-version measurement -- stale under the pin.
    cell({ model: "Haiku 4", versionHash: "sha256:v1", passes: 1, n: 1 }),
    // A cell on another fixture must not leak into this claim.
    cell({ model: "GPT-6", fixtureCase: "other", versionHash: "sha256:v2", passes: 5, n: 5 }),
  ];
  const models = ["GPT-6", "Haiku 4", "Opus 4.6", "Sonnet 4.5"];

  test("latest pin: proven / failing / stale / unmeasured", () => {
    const chips = modelChipsForClaim({
      measurements,
      fixtureCases: ["case-a"],
      scope: "latest",
      latestVersionHash: "sha256:v2",
      models,
    });
    expect(chips).toEqual([
      { model: "GPT-6", status: "unmeasured" },
      { model: "Haiku 4", status: "stale" },
      { model: "Opus 4.6", status: "proven" },
      { model: "Sonnet 4.5", status: "failing" },
    ]);
  });

  test("all-versions pivot: stale collapses into proven/failing", () => {
    const chips = modelChipsForClaim({
      measurements,
      fixtureCases: ["case-a"],
      scope: "all",
      latestVersionHash: "sha256:v2",
      models,
    });
    expect(chips.find((c) => c.model === "Haiku 4")?.status).toBe("proven");
  });

  test("no version recorded under the latest pin: measured cells degrade to stale, never proven", () => {
    const chips = modelChipsForClaim({
      measurements,
      fixtureCases: ["case-a"],
      scope: "latest",
      latestVersionHash: null,
      models: ["Opus 4.6"],
    });
    expect(chips).toEqual([{ model: "Opus 4.6", status: "stale" }]);
  });
});

describe("claimStatusInScope", () => {
  test("authored gap and partial judgments stand regardless of measurements", () => {
    const proven = [{ model: "Opus 4.6", status: "proven" as const }];
    expect(claimStatusInScope("gap", proven)).toBe("gap");
    expect(claimStatusInScope("partial", proven)).toBe("partial");
  });

  test("covered claims are proven only when a chip is, else unmeasured", () => {
    expect(claimStatusInScope("proven", [{ model: "m", status: "proven" }])).toBe("proven");
    expect(claimStatusInScope("proven", [{ model: "m", status: "stale" }])).toBe("unmeasured");
    expect(claimStatusInScope("unmeasured", [{ model: "m", status: "failing" }])).toBe("unmeasured");
  });
});

describe("runsForFixture", () => {
  test("filters by fixture case, newest first", () => {
    const runs = [
      run({ id: "old", startedAt: "2026-07-18T09:00:00Z" }),
      run({ id: "elsewhere", fixtureCase: "other" }),
      run({ id: "new", startedAt: "2026-07-21T09:00:00Z" }),
      run({ id: "unattached", fixtureCase: null }),
    ];
    expect(runsForFixture(runs, "case-a").map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("buildGapTodoPayload", () => {
  test("matches the todo.opened wire shape: eval kind, priority 15, viewer source, no origin", () => {
    const payload = buildGapTodoPayload({
      riskId: "RE-2",
      sentence: "The DAG is valid: no cycles, no dangling references",
      bundle: "to-tickets",
      id: "td-123",
      created: "2026-07-23",
    });
    expect(payload).toEqual({
      todo: {
        id: "td-123",
        kind: "eval",
        status: "open",
        title: "Cover RE-2: The DAG is valid: no cycles, no dangling references",
        detail: "Coverage gap: no fixture covers RE-2.",
        priority: 15,
        bundle: "to-tickets",
        created: "2026-07-23",
        source: { kind: "user", name: "viewer" },
      },
    });
    expect("origin" in payload.todo).toBe(false);
  });

  test("a long sentence is trimmed into the title with an ellipsis", () => {
    const sentence = "x".repeat(GAP_TITLE_SENTENCE_MAX + 20);
    const payload = buildGapTodoPayload({
      riskId: "IN-1",
      sentence,
      bundle: "b",
      id: "td-1",
      created: "2026-07-23",
    });
    expect(payload.todo.title.startsWith("Cover IN-1: ")).toBe(true);
    expect(payload.todo.title.endsWith("…")).toBe(true);
    expect(payload.todo.title.length).toBeLessThanOrEqual("Cover IN-1: ".length + GAP_TITLE_SENTENCE_MAX);
  });
});

describe("promptSummary", () => {
  test("first non-heading line of prompt.md, trimmed", () => {
    expect(promptSummary({ promptMd: "# Title\n\nDo the thing.\nMore.", legacyPrompt: null, context: null })).toBe(
      "Do the thing.",
    );
  });

  test("falls back to legacy prompt; null when nothing is authored", () => {
    expect(promptSummary({ promptMd: null, legacyPrompt: "Legacy ask." })).toBe("Legacy ask.");
    expect(promptSummary({ promptMd: null, legacyPrompt: null })).toBeNull();
  });

  test("long lines are capped at 160 characters with an ellipsis", () => {
    const summary = promptSummary({ promptMd: "y".repeat(300), legacyPrompt: null });
    expect(summary?.length).toBe(160);
    expect(summary?.endsWith("…")).toBe(true);
  });

  test("authoring comments never leak into the summary — the task prose shows", () => {
    const promptMd = "<!-- trigger-basic: does NOT name the skill by slug.\n     Covers risk IN-2. -->\n\nI've got a design.md file sitting here.";
    expect(promptSummary({ promptMd, legacyPrompt: null })).toBe("I've got a design.md file sitting here.");
  });
});

describe("fixturePurpose", () => {
  test("the leading authoring comment becomes the purpose line, whitespace collapsed", () => {
    const promptMd = "<!-- trigger-basic: does NOT name the skill by slug\n     (Fixtures.ts's trigger convention).\n     Covers risk IN-2. -->\n\nTask prose.";
    expect(fixturePurpose(promptMd)).toBe(
      "trigger-basic: does NOT name the skill by slug (Fixtures.ts's trigger convention). Covers risk IN-2.",
    );
  });

  test("no leading comment, empty comment, or no prompt: null", () => {
    expect(fixturePurpose("Just prose.")).toBeNull();
    expect(fixturePurpose("<!--   -->\nProse.")).toBeNull();
    expect(fixturePurpose(null)).toBeNull();
  });

  test("long purposes are capped at 240 characters with an ellipsis", () => {
    const purpose = fixturePurpose(`<!-- ${"z".repeat(400)} -->`);
    expect(purpose?.length).toBe(240);
    expect(purpose?.endsWith("…")).toBe(true);
  });
});

describe("fixtureBodyText", () => {
  test("the full prompt body, with only the LEADING purpose comment stripped (the purpose line shows it)", () => {
    const promptMd = "<!-- trigger-basic: covers IN-2. -->\n\n# Task\n\nDo the thing.\n<!-- a mid-body comment stays -->\nMore.";
    expect(fixtureBodyText({ promptMd, legacyPrompt: null })).toBe(
      "# Task\n\nDo the thing.\n<!-- a mid-body comment stays -->\nMore.",
    );
  });

  test("falls back to the legacy case.json prompt; null when nothing (or only a comment) is authored", () => {
    expect(fixtureBodyText({ promptMd: null, legacyPrompt: "Legacy ask." })).toBe("Legacy ask.");
    expect(fixtureBodyText({ promptMd: null, legacyPrompt: null })).toBeNull();
    expect(fixtureBodyText({ promptMd: "<!-- only a purpose -->\n  ", legacyPrompt: null })).toBeNull();
  });
});

describe("fixtureHasLiveRun", () => {
  const now = Date.parse("2026-08-11T12:00:00Z");
  const startedAgo = (ms: number): string => new Date(now - ms).toISOString();

  test("a recent running run lights the indicator; other fixtures' runs don't", () => {
    const runs = [run({ id: "r1", status: "running", startedAt: startedAgo(30_000) })];
    expect(fixtureHasLiveRun(runs, "case-a", now)).toBe(true);
    expect(fixtureHasLiveRun(runs, "other", now)).toBe(false);
  });

  test("terminal runs never light it", () => {
    const runs = [run({ id: "r1", status: "completed", startedAt: startedAgo(1000) })];
    expect(fixtureHasLiveRun(runs, "case-a", now)).toBe(false);
  });

  test("an orphaned 'running' record past the staleness window stops counting", () => {
    const runs = [run({ id: "r1", status: "running", startedAt: startedAgo(RUNNING_STALE_MS + 1) })];
    expect(fixtureHasLiveRun(runs, "case-a", now)).toBe(false);
    expect(fixtureHasLiveRun([run({ id: "r2", status: "running", startedAt: startedAgo(RUNNING_STALE_MS) })], "case-a", now)).toBe(true);
  });

  test("an unparseable startedAt never counts -- nothing honest to age it by", () => {
    const runs = [run({ id: "r1", status: "running", startedAt: "not-a-date" })];
    expect(fixtureHasLiveRun(runs, "case-a", now)).toBe(false);
  });
});

describe("groupClaimsByFamily", () => {
  test("groups in first-appearance order", () => {
    const claim = (id: string, family: string): Claim => ({
      id,
      family,
      sentence: id,
      status: "unmeasured",
      fixtures: 0,
      fixtureCases: [],
    });
    const groups = groupClaimsByFamily([claim("IN-1", "Input"), claim("RE-1", "Reasoning"), claim("IN-2", "Input")]);
    expect(groups.map((g) => g.family)).toEqual(["Input", "Reasoning"]);
    expect(groups[0]?.claims.map((c) => c.id)).toEqual(["IN-1", "IN-2"]);
  });
});

describe("runAllButtonLabel", () => {
  test("idle: the plain call to action", () => {
    expect(runAllButtonLabel(null, 0)).toBe("Run all fixtures");
  });

  test("run-all sweep: N is the fixture currently running, capped at the total", () => {
    expect(runAllButtonLabel({ completed: 0, total: 3 }, 1)).toBe("running 1 of 3…");
    expect(runAllButtonLabel({ completed: 2, total: 3 }, 1)).toBe("running 3 of 3…");
    // The last completion may briefly linger before the sweep clears: never "4 of 3".
    expect(runAllButtonLabel({ completed: 3, total: 3 }, 0)).toBe("running 3 of 3…");
  });

  test("single runs active without a sweep: a quiet running state", () => {
    expect(runAllButtonLabel(null, 2)).toBe("running…");
  });
});

describe("shouldSettleMissingResponse", () => {
  const now = Date.parse("2026-08-03T12:00:00Z");
  const startedAgo = (ms: number): string => new Date(now - ms).toISOString();

  test("a still-running run NEVER settles -- the recorder may be racing the fetch", () => {
    expect(shouldSettleMissingResponse({ status: "running", startedAt: startedAgo(RESPONSE_SETTLE_MS * 10) }, now)).toBe(false);
  });

  test("a just-completed run stays retryable inside the settle window", () => {
    expect(shouldSettleMissingResponse({ status: "completed", startedAt: startedAgo(1000) }, now)).toBe(false);
    expect(shouldSettleMissingResponse({ status: "completed", startedAt: startedAgo(RESPONSE_SETTLE_MS) }, now)).toBe(false);
  });

  test("an old terminal run settles into the permanent 'no response'", () => {
    expect(shouldSettleMissingResponse({ status: "completed", startedAt: startedAgo(RESPONSE_SETTLE_MS + 1) }, now)).toBe(true);
    expect(shouldSettleMissingResponse({ status: "failed", startedAt: startedAgo(RESPONSE_SETTLE_MS + 1) }, now)).toBe(true);
    expect(shouldSettleMissingResponse({ status: "infra-error", startedAt: startedAgo(RESPONSE_SETTLE_MS + 1) }, now)).toBe(true);
  });

  test("unknown/future statuses never settle (honest default: keep looking)", () => {
    expect(shouldSettleMissingResponse({ status: "queued", startedAt: startedAgo(RESPONSE_SETTLE_MS * 10) }, now)).toBe(false);
  });

  test("a terminal run with an unparseable startedAt settles -- nothing to wait on", () => {
    expect(shouldSettleMissingResponse({ status: "completed", startedAt: "not-a-date" }, now)).toBe(true);
    expect(shouldSettleMissingResponse({ status: "running", startedAt: "not-a-date" }, now)).toBe(false);
  });
});

// The read-only Eval tab (director ruling 2026-08-08): Method-stage evals
// render as a reading surface -- claims + proof-case intentions, honest
// status words, no run/grade/mint affordances.
describe("readOnlyStatusLabel", () => {
  test("gap reads as planned; everything else keeps its name", () => {
    expect(readOnlyStatusLabel("gap")).toBe("planned");
    expect(readOnlyStatusLabel("partial")).toBe("partial");
    expect(readOnlyStatusLabel("unmeasured")).toBe("unmeasured");
    expect(readOnlyStatusLabel("proven")).toBe("proven");
  });
});

describe("readOnlyProofCaseEntries", () => {
  test("realized cases are inspectable (planned: false); unrealized intentions are planned", () => {
    expect(
      readOnlyProofCaseEntries({ fixtureCases: ["refusal-thin-input"], proofCases: ["refusal-thin-input", "adv-injection"] }),
    ).toEqual([
      { name: "refusal-thin-input", planned: false },
      { name: "adv-injection", planned: true },
    ]);
  });

  test("a risk-map-sourced claim (no proofCases) falls back to its fixture join, all realized", () => {
    expect(readOnlyProofCaseEntries({ fixtureCases: ["golden-basic"] })).toEqual([{ name: "golden-basic", planned: false }]);
  });
});

describe("readOnlyProofCaseLabels", () => {
  test("proof-case intentions render, unrealized ones marked (planned)", () => {
    expect(
      readOnlyProofCaseLabels({ fixtureCases: ["refusal-thin-input"], proofCases: ["refusal-thin-input", "adv-injection"] }),
    ).toEqual(["refusal-thin-input", "adv-injection (planned)"]);
  });

  test("a risk-map-sourced claim (no proofCases) falls back to its fixture join", () => {
    expect(readOnlyProofCaseLabels({ fixtureCases: ["golden-basic"] })).toEqual(["golden-basic"]);
  });

  test("nothing authored -> empty (the row says so instead)", () => {
    expect(readOnlyProofCaseLabels({ fixtureCases: [], proofCases: [] })).toEqual([]);
  });

  test("the orientation line exists and stays quiet prose", () => {
    expect(READ_ONLY_ORIENTATION).toBe("Authored during design — runnable once a draft exists.");
  });
});
