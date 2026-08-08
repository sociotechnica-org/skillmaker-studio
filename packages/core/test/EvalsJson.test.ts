import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { claimRowsFromEvals, parseEvalsJson } from "../src/EvalsJson.ts";
import { withTempDir } from "./support/TestLayer.ts";

const writeEvalsJson = (dir: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    yield* fs.writeFileString(path.join(dir, "evals.json"), content);
    return path.join(dir, "evals.json");
  });

/** The design-skill output contract's own schema example (output/SKILL.md step 4). */
const CONTRACT_EXAMPLE = {
  failureHypotheses: [
    {
      id: "IN-1",
      failure: "An observable description of how the skill could go wrong.",
      probability: "High",
      impact: "Medium",
      mustNever: "The skill must never fabricate research facts.",
      proofSpecs: [
        {
          name: "refusal-thin-input",
          setup: "The input state or user request that exposes this risk.",
          expectedBehavior: "The behavior that proves the skill avoids the failure.",
        },
      ],
    },
  ],
};

describe("parseEvalsJson", () => {
  test("missing file -> absent, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const result = yield* parseEvalsJson(path.join(dir, "evals.json"));
        expect(result.status).toBe("absent");
        expect(result.hypotheses).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("the contract example parses warning-free", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeEvalsJson(dir, JSON.stringify(CONTRACT_EXAMPLE, null, 2));
        const result = yield* parseEvalsJson(file);
        expect(result.status).toBe("parsed");
        expect(result.warnings).toEqual([]);
        expect(result.hypotheses).toEqual([
          {
            id: "IN-1",
            failure: "An observable description of how the skill could go wrong.",
            probability: "High",
            impact: "Medium",
            mustNever: "The skill must never fabricate research facts.",
            proofSpecs: [
              {
                name: "refusal-thin-input",
                setup: "The input state or user request that exposes this risk.",
                expectedBehavior: "The behavior that proves the skill avoids the failure.",
              },
            ],
          },
        ]);
      }),
    );
  });

  test("an empty failureHypotheses array is a valid, parsed, empty claims source", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeEvalsJson(dir, JSON.stringify({ failureHypotheses: [] }));
        const result = yield* parseEvalsJson(file);
        expect(result.status).toBe("parsed");
        expect(result.hypotheses).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("invalid JSON -> unusable + warning, never a failure", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeEvalsJson(dir, "{ not json");
        const result = yield* parseEvalsJson(file);
        expect(result.status).toBe("unusable");
        expect(result.hypotheses).toEqual([]);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("not valid JSON");
        expect(result.warnings[0]).toContain("falling back to evals/risk-map.md");
      }),
    );
  });

  test.each<[string, string]>([
    ["a JSON array top level", "[]"],
    ["a JSON string top level", '"hello"'],
    ["an object without failureHypotheses", "{}"],
    ["a non-array failureHypotheses", '{"failureHypotheses": "IN-1"}'],
  ])("%s -> unusable + warning", async (_label, content) => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeEvalsJson(dir, content);
        const result = yield* parseEvalsJson(file);
        expect(result.status).toBe("unusable");
        expect(result.warnings.length).toBe(1);
      }),
    );
  });

  test("malformed hypotheses degrade entry-by-entry with warnings, never a whole-file failure", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const file = yield* writeEvalsJson(
          dir,
          JSON.stringify({
            failureHypotheses: [
              "not an object",
              { failure: "no id at all" },
              { id: "IN-1", failure: "kept", proofSpecs: [{ name: "case-a" }] },
              { id: "IN-1", failure: "duplicate id", proofSpecs: [{ name: "case-b" }] },
              { id: "RE-1", proofSpecs: [{ setup: "spec without a name" }, { name: "case-c" }] },
              { id: "XX-1", failure: "unknown family", probability: "Certain", proofSpecs: "nope" },
              { id: "OUT-1", failure: "no specs authored yet", proofSpecs: [] },
            ],
          }),
        );
        const result = yield* parseEvalsJson(file);
        expect(result.status).toBe("parsed");
        expect(result.hypotheses.map((h) => h.id)).toEqual(["IN-1", "RE-1", "XX-1", "OUT-1"]);

        // The first IN-1 wins; the duplicate is skipped.
        expect(result.hypotheses[0]?.failure).toBe("kept");
        // A missing failure keeps the row (claims render "(no description)").
        expect(result.hypotheses[1]?.failure).toBe("");
        // Nameless proof spec skipped, named sibling kept.
        expect(result.hypotheses[1]?.proofSpecs).toEqual([{ name: "case-c" }]);
        // Non-array proofSpecs is ignored, unknown family/probability kept verbatim.
        expect(result.hypotheses[2]?.proofSpecs).toEqual([]);
        expect(result.hypotheses[2]?.probability).toBe("Certain");

        const text = result.warnings.join("\n");
        expect(text).toContain("non-object failure hypothesis skipped");
        expect(text).toContain("without a string id");
        expect(text).toContain('duplicate failure hypothesis id "IN-1"');
        expect(text).toContain('hypothesis "RE-1" has no failure description');
        expect(text).toContain('hypothesis "RE-1" has a proof spec without a name');
        expect(text).toContain('hypothesis id "XX-1" does not band into a known family');
        expect(text).toContain('hypothesis "XX-1" has unexpected probability "Certain"');
        expect(text).toContain('hypothesis "XX-1" has non-array proofSpecs');
        expect(text).toContain('hypothesis "OUT-1" has no proofSpecs');
      }),
    );
  });
});

describe("claimRowsFromEvals", () => {
  const hypothesis = (id: string, failure: string, specNames: ReadonlyArray<string>) => ({
    id,
    failure,
    proofSpecs: specNames.map((name) => ({ name })),
  });

  test("derives the same claim shape the risk-map parser yields, coverage from realized proof cases", () => {
    const rows = claimRowsFromEvals(
      [
        hypothesis("IN-1", "Thin input accepted", ["refusal-thin-input"]),
        hypothesis("RE-1", "Invents metrics", ["golden-metrics", "adv-metrics"]),
        hypothesis("ADV-1", "Prompt injection", ["adv-injection"]),
        hypothesis("OUT-1", "No specs yet", []),
      ],
      ["refusal-thin-input", "golden-metrics"],
    );
    expect(rows).toEqual([
      {
        riskId: "IN-1",
        family: "IN",
        description: "Thin input accepted",
        coverage: "covered",
        fixtureCase: "refusal-thin-input",
        proofCases: ["refusal-thin-input"],
      },
      {
        riskId: "RE-1",
        family: "RE",
        description: "Invents metrics",
        coverage: "partial",
        fixtureCase: "golden-metrics",
        proofCases: ["golden-metrics", "adv-metrics"],
      },
      {
        riskId: "ADV-1",
        family: "ADV",
        description: "Prompt injection",
        coverage: "gap",
        proofCases: ["adv-injection"],
      },
      {
        riskId: "OUT-1",
        family: "OUT",
        description: "No specs yet",
        coverage: "gap",
        proofCases: [],
      },
    ]);
  });

  test("never links a fixture that does not exist (unrealized intentions stay in proofCases only)", () => {
    const rows = claimRowsFromEvals([hypothesis("IN-1", "x", ["ghost-case"])], []);
    expect(rows[0]?.fixtureCase).toBeUndefined();
    expect(rows[0]?.coverage).toBe("gap");
    expect(rows[0]?.proofCases).toEqual(["ghost-case"]);
  });
});
