import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import {
  claimRowsFromSkillJson,
  identityFromSkillJson,
  parseSkillJson,
  readBundleStructuredState,
} from "../src/SkillJson.ts";
import { withTempDir } from "./support/TestLayer.ts";

const writeFile = (dir: string, relPath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const full = path.join(dir, relPath);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, content);
    return full;
  });

/** A complete, contract-shaped skill.json (THE MERGE example, abridged). */
const MERGED_EXAMPLE = {
  schemaVersion: 2,
  skill: {
    slug: "read-transcripts",
    name: "Read Transcripts",
    oneLiner: "Mine transcripts for insights.",
    tags: ["meta"],
    created: "2026-08-07",
    harnesses: ["claude-code"],
    stage: "evaluating",
  },
  design: {
    failureHypotheses: [
      {
        id: "OUT-3",
        failure: "Returns invented suggestions to meet a quota.",
        probability: "Medium",
        impact: "Medium",
        mustNever: "The skill must never invent or pad suggestions.",
        cases: ["nothing-worth-writing"],
      },
    ],
  },
  evals: {
    cases: [
      {
        name: "nothing-worth-writing",
        class: "empty",
        setup: "Provide transcripts with no distinctive insight.",
        expectedBehavior: "Explicitly returns no suggestions.",
        checks: ["says no suggestions"],
        source: { kind: "field-report", eventId: "ev-1" },
      },
    ],
    configs: [{ id: "cc-default", provider: "claude-code", model: "claude-sonnet-5" }],
  },
  publish: { targets: ["user"] },
};

describe("parseSkillJson", () => {
  test("missing file -> absent, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const result = yield* parseSkillJson(path.join(dir, "skill.json"));
        expect(result.status).toBe("absent");
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("not JSON -> unusable + warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(dir, "skill.json", "{ nope");
        const result = yield* parseSkillJson(file);
        expect(result.status).toBe("unusable");
        expect(result.warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
      }),
    );
  });

  test("the contract example parses warning-free, every section intact", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(dir, "skill.json", JSON.stringify(MERGED_EXAMPLE, null, 2));
        const result = yield* parseSkillJson(file);
        expect(result.status).toBe("parsed");
        expect(result.warnings).toEqual([]);
        expect(result.skill?.slug).toBe("read-transcripts");
        expect(result.skill?.harnesses).toEqual(["claude-code"]);
        expect(result.skill?.stage).toBe("evaluating");
        expect(result.hypotheses).toEqual([
          {
            id: "OUT-3",
            failure: "Returns invented suggestions to meet a quota.",
            probability: "Medium",
            impact: "Medium",
            mustNever: "The skill must never invent or pad suggestions.",
            cases: ["nothing-worth-writing"],
          },
        ]);
        expect(result.cases).toEqual([
          {
            name: "nothing-worth-writing",
            class: "empty",
            setup: "Provide transcripts with no distinctive insight.",
            expectedBehavior: "Explicitly returns no suggestions.",
            checks: ["says no suggestions"],
            source: { kind: "field-report", eventId: "ev-1" },
          },
        ]);
        expect(result.configs).toEqual([{ id: "cc-default", provider: "claude-code", model: "claude-sonnet-5" }]);
        expect(result.publishTargets).toEqual(["user"]);
      }),
    );
  });

  test("malformed hypotheses degrade per-item: no id skipped, duplicate skipped, unknown family + missing failure warned, legacy proofSpecs warned", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({
            schemaVersion: 2,
            skill: { slug: "s" },
            design: {
              failureHypotheses: [
                "not-an-object",
                { failure: "no id" },
                { id: "IN-1", failure: "first", cases: ["a"] },
                { id: "IN-1", failure: "duplicate", cases: ["b"] },
                { id: "ZZ-9", cases: [] },
                { id: "RE-1", failure: "legacy", proofSpecs: [{ name: "x" }], cases: ["c"] },
              ],
            },
          }),
        );
        const result = yield* parseSkillJson(file);
        expect(result.status).toBe("parsed");
        expect(result.hypotheses.map((h) => h.id)).toEqual(["IN-1", "ZZ-9", "RE-1"]);
        expect(result.hypotheses[0]?.cases).toEqual(["a"]);
        expect(result.warnings).toContain("skill.json: non-object failure hypothesis skipped");
        expect(result.warnings).toContain("skill.json: failure hypothesis without a string id skipped");
        expect(result.warnings).toContain('skill.json: duplicate failure hypothesis id "IN-1"; later entry skipped');
        expect(result.warnings.some((w) => w.includes('"ZZ-9" does not band into a known family'))).toBe(true);
        expect(result.warnings.some((w) => w.includes('"ZZ-9" has no failure description'))).toBe(true);
        expect(result.warnings.some((w) => w.includes('"RE-1" carries a legacy "proofSpecs" field'))).toBe(true);
      }),
    );
  });

  test("legacy risks[] on a case is warned and ignored; old setup object is captured into setupFiles", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({
            schemaVersion: 2,
            skill: { slug: "s" },
            evals: {
              cases: [
                { name: "with-risks", class: "golden", risks: ["IN-1"] },
                { name: "old-setup", class: "golden", setup: { files: "files/", env: { A: "1" } } },
              ],
            },
          }),
        );
        const result = yield* parseSkillJson(file);
        expect(result.warnings.some((w) => w.includes('"with-risks" carries a legacy "risks" field'))).toBe(true);
        const oldSetup = result.cases.find((c) => c.name === "old-setup");
        expect(oldSetup?.setup).toBeUndefined();
        expect(oldSetup?.setupFiles).toEqual({ files: "files/", env: { A: "1" } });
      }),
    );
  });

  test("a stations section is warned and ignored (the production line is code)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({ schemaVersion: 2, skill: { slug: "s" }, stations: { template: "default" } }),
        );
        const result = yield* parseSkillJson(file);
        expect(result.status).toBe("parsed");
        expect(result.warnings.some((w) => w.includes('"stations" section'))).toBe(true);
      }),
    );
  });

  test("identityFromSkillJson maps harnesses->targets and publish audiences->publishTargets", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeFile(dir, "skill.json", JSON.stringify(MERGED_EXAMPLE));
        const result = yield* parseSkillJson(file);
        const identity = identityFromSkillJson(result);
        expect(identity?.slug).toBe("read-transcripts");
        expect(identity?.targets).toEqual(["claude-code"]);
        expect(identity?.publishTargets).toEqual(["user"]);
      }),
    );
  });
});

describe("claimRowsFromSkillJson (coverage derivation)", () => {
  const hypotheses = [
    { id: "IN-1", failure: "all realized", cases: ["a", "b"] },
    { id: "RE-1", failure: "some realized", cases: ["a", "missing"] },
    { id: "OUT-1", failure: "none realized", cases: ["missing"] },
    { id: "ADV-1", failure: "points at nothing", cases: [] },
  ];

  test("covered / partial / gap follow realization; fixtureCase links the first realized case", () => {
    const rows = claimRowsFromSkillJson(hypotheses, new Set(["a", "b"]));
    expect(rows.map((r) => [r.riskId, r.coverage, r.fixtureCase])).toEqual([
      ["IN-1", "covered", "a"],
      ["RE-1", "partial", "a"],
      ["OUT-1", "gap", undefined],
      ["ADV-1", "gap", undefined],
    ]);
    expect(rows[0]?.family).toBe("IN");
    expect(rows[1]?.proofCases).toEqual(["a", "missing"]);
  });
});

describe("readBundleStructuredState", () => {
  test("skill.json wins: cases from evals.cases, coverage derived from evals/cases/ realization, legacy sources never read", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(dir, "skill.json", JSON.stringify(MERGED_EXAMPLE, null, 2));
        yield* writeFile(dir, "evals/cases/nothing-worth-writing/prompt.md", "Find something to write.\n");
        // A legacy risk-map that must NOT leak through.
        yield* writeFile(dir, "evals/risk-map.md", "| Risk | D | Coverage | Fixture |\n|---|---|---|---|\n| OUT-9 | leak | ● covered | x |\n");
        const state = yield* readBundleStructuredState(dir);
        expect(state.hasSkillJson).toBe(true);
        expect(state.claimsSource).toBe("skill.json");
        expect(state.claims).toEqual([
          {
            riskId: "OUT-3",
            family: "OUT",
            description: "Returns invented suggestions to meet a quota.",
            coverage: "covered",
            fixtureCase: "nothing-worth-writing",
            proofCases: ["nothing-worth-writing"],
          },
        ]);
        expect(state.cases).toEqual([
          {
            caseName: "nothing-worth-writing",
            class: "empty",
            risks: [],
            hasPromptMd: true,
            source: { kind: "field-report", eventId: "ev-1" },
          },
        ]);
        expect(state.warnings).toEqual([]);
      }),
    );
  });

  test("a planned case (no materials dir) is listed but unrealized: hypothesis coverage stays gap, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({
            schemaVersion: 2,
            skill: { slug: "s" },
            design: { failureHypotheses: [{ id: "IN-1", failure: "f", cases: ["planned-case"] }] },
            evals: { cases: [{ name: "planned-case", class: "golden" }] },
          }),
        );
        const state = yield* readBundleStructuredState(dir);
        expect(state.cases).toEqual([{ caseName: "planned-case", class: "golden", risks: [], hasPromptMd: false }]);
        expect(state.claims[0]?.coverage).toBe("gap");
        expect(state.warnings).toEqual([]);
      }),
    );
  });

  test("dir-name mismatch: a materials dir no case entry names is warned (name==dir, tolerantly enforced)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({ schemaVersion: 2, skill: { slug: "s" }, evals: { cases: [{ name: "listed", class: "golden" }] } }),
        );
        yield* writeFile(dir, "evals/cases/listed/prompt.md", "p\n");
        yield* writeFile(dir, "evals/cases/unlisted/prompt.md", "p\n");
        const state = yield* readBundleStructuredState(dir);
        expect(state.cases.map((c) => c.caseName)).toEqual(["listed"]);
        expect(
          state.warnings.some(
            (w) => w.source === "skill.json" && w.message.includes("evals/cases/unlisted/ has no matching case entry"),
          ),
        ).toBe(true);
      }),
    );
  });

  test("dangling case pointer: a hypothesis naming a case with no evals.cases entry is warned", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(
          dir,
          "skill.json",
          JSON.stringify({
            schemaVersion: 2,
            skill: { slug: "s" },
            design: { failureHypotheses: [{ id: "IN-1", failure: "f", cases: ["ghost"] }] },
            evals: { cases: [] },
          }),
        );
        const state = yield* readBundleStructuredState(dir);
        expect(
          state.warnings.some(
            (w) => w.source === "skill.json" && w.message.includes('hypothesis "IN-1" points at case "ghost"'),
          ),
        ).toBe(true);
        // The pointer still counts for the claim row (unrealized -> gap).
        expect(state.claims[0]?.coverage).toBe("gap");
      }),
    );
  });

  test("no skill.json: the legacy chain answers (evals.json wins over risk-map, case.json scan supplies cases)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(
          dir,
          "evals.json",
          JSON.stringify({
            failureHypotheses: [
              { id: "IN-1", failure: "legacy claim", proofSpecs: [{ name: "golden-basic" }] },
            ],
          }),
        );
        yield* writeFile(
          dir,
          "evals/fixtures/golden-basic/case.json",
          JSON.stringify({ schemaVersion: 1, case: "golden-basic", class: "golden", risks: ["IN-1"] }),
        );
        yield* writeFile(dir, "evals/fixtures/golden-basic/prompt.md", "p\n");
        const state = yield* readBundleStructuredState(dir);
        expect(state.hasSkillJson).toBe(false);
        expect(state.claimsSource).toBe("evals.json");
        expect(state.claims[0]?.coverage).toBe("covered");
        expect(state.cases[0]?.caseName).toBe("golden-basic");
        expect(state.cases[0]?.risks).toEqual(["IN-1"]);
      }),
    );
  });

  test("an unusable skill.json falls back to the legacy chain with a warning, never a hard failure", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeFile(dir, "skill.json", "[]");
        yield* writeFile(
          dir,
          "evals/risk-map.md",
          "---\nbundle: s\n---\n| Risk | Description | Coverage | Fixture |\n|---|---|---|---|\n| IN-1 | fallback row | ○ gap | — |\n",
        );
        const state = yield* readBundleStructuredState(dir);
        expect(state.hasSkillJson).toBe(false);
        expect(state.claimsSource).toBe("risk-map");
        expect(state.claims[0]?.riskId).toBe("IN-1");
        expect(state.warnings.some((w) => w.source === "skill.json" && w.message.includes("top level is not an object"))).toBe(
          true,
        );
      }),
    );
  });
});
