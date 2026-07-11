import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { isKnownRiskFamily, riskFamily, scanFixtures } from "../src/Fixtures.ts";
import { withTempDir } from "./support/TestLayer.ts";

const writeCase = (
  bundleDir: string,
  caseName: string,
  json: unknown,
  options?: { readonly withPrompt?: boolean },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const caseDir = path.join(bundleDir, "evals", "fixtures", caseName);
    yield* fs.makeDirectory(caseDir, { recursive: true });
    yield* fs.writeFileString(path.join(caseDir, "case.json"), JSON.stringify(json, null, 2));
    if (options?.withPrompt !== false) {
      yield* fs.writeFileString(path.join(caseDir, "prompt.md"), "Do the thing.\n");
    }
  });

describe("riskFamily / isKnownRiskFamily", () => {
  test("splits on the first dash", () => {
    expect(riskFamily("IN-2")).toBe("IN");
    expect(riskFamily("ADV-10")).toBe("ADV");
    expect(riskFamily("noDash")).toBe("noDash");
  });

  test("only IN/RE/OUT/ADV/CHN are known", () => {
    expect(isKnownRiskFamily("IN")).toBe(true);
    expect(isKnownRiskFamily("RE")).toBe(true);
    expect(isKnownRiskFamily("OUT")).toBe(true);
    expect(isKnownRiskFamily("ADV")).toBe(true);
    expect(isKnownRiskFamily("CHN")).toBe(true);
    expect(isKnownRiskFamily("XX")).toBe(false);
  });
});

describe("scanFixtures", () => {
  test("missing evals/fixtures dir -> empty, no warnings", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const result = yield* scanFixtures(dir);
        expect(result.cases).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("happy path: a well-formed golden case with prompt.md", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "golden-1", {
          schemaVersion: 1,
          case: "golden-1",
          class: "golden",
          risks: ["IN-1", "RE-2"],
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
        expect(result.cases).toEqual([
          { caseName: "golden-1", class: "golden", risks: ["IN-1", "RE-2"], hasPromptMd: true },
        ]);
      }),
    );
  });

  test("happy path: a well-formed trigger case (Phase 12 fold-in -- the prompt must not name the skill)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "trigger-1", {
          schemaVersion: 1,
          case: "trigger-1",
          class: "trigger",
          risks: [],
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
        expect(result.cases).toEqual([
          { caseName: "trigger-1", class: "trigger", risks: [], hasPromptMd: true },
        ]);
      }),
    );
  });

  test("malformed JSON -> warning, case skipped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const caseDir = path.join(dir, "evals", "fixtures", "broken");
        yield* fs.makeDirectory(caseDir, { recursive: true });
        yield* fs.writeFileString(path.join(caseDir, "case.json"), "{ not json");

        const result = yield* scanFixtures(dir);
        expect(result.cases).toEqual([]);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("malformed JSON");
      }),
    );
  });

  test("directory name != case field -> warning, still scanned", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "dir-name", {
          schemaVersion: 1,
          case: "different-name",
          class: "golden",
          risks: [],
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes("does not match its directory name"))).toBe(true);
        expect(result.cases[0]?.caseName).toBe("different-name");
      }),
    );
  });

  test("missing prompt.md -> warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(
          dir,
          "no-prompt",
          { schemaVersion: 1, case: "no-prompt", class: "golden", risks: [] },
          { withPrompt: false },
        );

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes("prompt.md is missing"))).toBe(true);
      }),
    );
  });

  test("legacy prompt field -> warning suggesting prompt.md", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "legacy", {
          schemaVersion: 1,
          case: "legacy",
          class: "golden",
          risks: [],
          prompt: "Old style prompt.",
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes("legacy") && w.includes("prompt.md"))).toBe(true);
      }),
    );
  });

  test("answerKey referenced but missing -> warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "graded", {
          schemaVersion: 1,
          case: "graded",
          class: "golden",
          risks: [],
          grading: { answerKey: "expected/answer-key.md" },
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes('grading.answerKey "expected/answer-key.md"'))).toBe(
          true,
        );
      }),
    );
  });

  test("answerKey referenced and present -> no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* writeCase(dir, "graded-ok", {
          schemaVersion: 1,
          case: "graded-ok",
          class: "golden",
          risks: [],
          grading: { answerKey: "expected/answer-key.md" },
        });
        yield* fs.makeDirectory(path.join(dir, "evals", "fixtures", "graded-ok", "expected"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(dir, "evals", "fixtures", "graded-ok", "expected", "answer-key.md"),
          "# Answer\n",
        );

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("unknown class -> warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "weird-class", {
          schemaVersion: 1,
          case: "weird-class",
          class: "not-a-real-class",
          risks: [],
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes('unknown class "not-a-real-class"'))).toBe(true);
      }),
    );
  });

  test("risk id not banding to a known family -> warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "bad-risk", {
          schemaVersion: 1,
          case: "bad-risk",
          class: "golden",
          risks: ["ZZ-1"],
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes('risk id "ZZ-1" does not band'))).toBe(true);
      }),
    );
  });

  test("missing case.json -> warning, case skipped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* fs.makeDirectory(path.join(dir, "evals", "fixtures", "empty-dir"), { recursive: true });

        const result = yield* scanFixtures(dir);
        expect(result.cases).toEqual([]);
        expect(result.warnings.some((w) => w.includes("case.json is missing"))).toBe(true);
      }),
    );
  });

  test("case.json missing required 'case' field -> warning, skipped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "no-case-field", { schemaVersion: 1, class: "golden", risks: [] });

        const result = yield* scanFixtures(dir);
        expect(result.cases).toEqual([]);
        expect(result.warnings.some((w) => w.includes('missing required field "case"'))).toBe(true);
      }),
    );
  });

  test("case.json that is not a JSON object -> warning, skipped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const caseDir = path.join(dir, "evals", "fixtures", "array-case");
        yield* fs.makeDirectory(caseDir, { recursive: true });
        yield* fs.writeFileString(path.join(caseDir, "case.json"), "[1,2,3]");

        const result = yield* scanFixtures(dir);
        expect(result.cases).toEqual([]);
        expect(result.warnings.some((w) => w.includes("must be a JSON object"))).toBe(true);
      }),
    );
  });
});
