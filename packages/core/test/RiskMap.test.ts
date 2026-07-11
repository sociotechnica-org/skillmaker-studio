import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { checkCoverage, parseCoverageCell, parseRiskMap } from "../src/RiskMap.ts";
import type { CoverageValue } from "../src/RiskMap.ts";
import { withTempDir } from "./support/TestLayer.ts";

const writeRiskMap = (dir: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    yield* fs.makeDirectory(path.join(dir, "evals"), { recursive: true });
    yield* fs.writeFileString(path.join(dir, "evals", "risk-map.md"), content);
    return path.join(dir, "evals", "risk-map.md");
  });

describe("parseCoverageCell", () => {
  test.each<[string, CoverageValue | undefined]>([
    ["● covered", "covered"],
    ["◐ partial", "partial"],
    ["○ gap", "gap"],
    ["n/a", "n/a"],
    ["covered", "covered"],
    ["partial", "partial"],
    ["gap", "gap"],
    ["●", "covered"],
    ["◐", "partial"],
    ["○", "gap"],
    ["???", undefined],
    ["", undefined],
  ])("%s -> %s", (cell, expected) => {
    expect(parseCoverageCell(cell)).toBe(expected);
  });
});

describe("parseRiskMap", () => {
  test("missing file -> empty rows, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const result = yield* parseRiskMap(path.join(dir, "evals", "risk-map.md"));
        expect(result.rows).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("happy path: frontmatter + glyph rows band into families", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(
          dir,
          `---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | refusal-thin-input |
| RE-1 | Invents metrics | ◐ partial | golden |
| ADV-1 | Prompt injection via pasted doc | ○ gap | — |
`,
        );

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.warnings).toEqual([]);
        expect(result.rows).toEqual([
          {
            riskId: "IN-1",
            family: "IN",
            description: "Empty/thin input",
            coverage: "covered",
            fixtureCase: "refusal-thin-input",
          },
          {
            riskId: "RE-1",
            family: "RE",
            description: "Invents metrics",
            coverage: "partial",
            fixtureCase: "golden",
          },
          { riskId: "ADV-1", family: "ADV", description: "Prompt injection via pasted doc", coverage: "gap" },
        ]);
      }),
    );
  });

  test("word-form coverage cells parse the same as glyphs", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(
          dir,
          `| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| CHN-1 | Chain drops context | covered | golden |
`,
        );

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.warnings).toEqual([]);
        expect(result.rows[0]?.coverage).toBe("covered");
        expect(result.rows[0]?.family).toBe("CHN");
      }),
    );
  });

  test("risk id not banding into a known family -> warning, row still parsed", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(
          dir,
          `| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| ZZ-1 | Mystery risk | ○ gap | — |
`,
        );

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.warnings.some((w) => w.includes('risk id "ZZ-1" does not band'))).toBe(true);
        expect(result.rows[0]?.riskId).toBe("ZZ-1");
      }),
    );
  });

  test("malformed table (no separator row) -> warning, no rows", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(dir, "| Risk | Description | Coverage | Fixture |\nnot a table\n");

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.rows).toEqual([]);
        expect(result.warnings.length).toBe(1);
      }),
    );
  });

  test("unparseable coverage cell -> warning, row dropped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(
          dir,
          `| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty input | ??? | — |
`,
        );

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.rows).toEqual([]);
        expect(result.warnings.some((w) => w.includes("could not parse coverage cell"))).toBe(true);
      }),
    );
  });

  test("no table present -> empty rows, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const riskMapPath = yield* writeRiskMap(
          dir,
          `---
bundle: frame-the-problem
---
Nothing authored yet.
`,
        );

        const result = yield* parseRiskMap(riskMapPath);
        expect(result.rows).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });
});

describe("checkCoverage", () => {
  test("fixture referenced but no such case -> warning", () => {
    const warnings = checkCoverage(
      [{ riskId: "IN-1", family: "IN", description: "d", coverage: "covered", fixtureCase: "missing-case" }],
      [{ caseName: "golden-1" }],
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("missing-case");
  });

  test("fixture referenced and present -> no warning", () => {
    const warnings = checkCoverage(
      [{ riskId: "IN-1", family: "IN", description: "d", coverage: "covered", fixtureCase: "golden-1" }],
      [{ caseName: "golden-1" }],
    );
    expect(warnings).toEqual([]);
  });

  test("row with no fixture (a gap) -> no warning", () => {
    const warnings = checkCoverage(
      [{ riskId: "ADV-1", family: "ADV", description: "d", coverage: "gap" }],
      [{ caseName: "golden-1" }],
    );
    expect(warnings).toEqual([]);
  });
});
