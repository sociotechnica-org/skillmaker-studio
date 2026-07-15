import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { FixtureCase, isKnownRiskFamily, riskFamily, scanFixtures, writeFixtureScaffold } from "../src/Fixtures.ts";
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

  // Issue #68 (`fixture harvest`): `source` is optional provenance --
  // absent on every case predating harvest, present only on a harvested one.
  test("a well-formed source field -> captured, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "harvested-1", {
          schemaVersion: 1,
          case: "harvested-1",
          class: "hard-case",
          risks: [],
          source: { kind: "field-report", eventId: "11111111-1111-1111-1111-111111111111" },
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
        expect(result.cases).toEqual([
          {
            caseName: "harvested-1",
            class: "hard-case",
            risks: [],
            hasPromptMd: true,
            source: { kind: "field-report", eventId: "11111111-1111-1111-1111-111111111111" },
          },
        ]);
      }),
    );
  });

  test("a source field with a destination -> captured verbatim", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "harvested-2", {
          schemaVersion: 1,
          case: "harvested-2",
          class: "hard-case",
          risks: [],
          source: {
            kind: "field-report",
            eventId: "22222222-2222-2222-2222-222222222222",
            destination: "acme-agent-fleet",
          },
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
        expect(result.cases[0]?.source).toEqual({
          kind: "field-report",
          eventId: "22222222-2222-2222-2222-222222222222",
          destination: "acme-agent-fleet",
        });
      }),
    );
  });

  test("no source field -> absent, no warning (every pre-harvest case.json)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "no-source", { schemaVersion: 1, case: "no-source", class: "golden", risks: [] });

        const result = yield* scanFixtures(dir);
        expect(result.warnings).toEqual([]);
        expect(result.cases[0]?.source).toBeUndefined();
      }),
    );
  });

  test("a malformed source field -> warning, case still scanned", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeCase(dir, "bad-source", {
          schemaVersion: 1,
          case: "bad-source",
          class: "hard-case",
          risks: [],
          source: { kind: "manual" },
        });

        const result = yield* scanFixtures(dir);
        expect(result.warnings.some((w) => w.includes('malformed "source" field'))).toBe(true);
        expect(result.cases[0]?.source).toBeUndefined();
      }),
    );
  });
});

describe("FixtureCase schema round-trip", () => {
  const decode = Schema.decodeUnknownEffect(FixtureCase);

  test("decodes without a source field (every fixture predating harvest)", async () => {
    const decoded = await Effect.runPromise(
      decode({ schemaVersion: 1, case: "golden-1", class: "golden", risks: ["IN-1"] }),
    );
    expect(decoded.source).toBeUndefined();
  });

  test("decodes with a source field (a harvested fixture, issue #68)", async () => {
    const decoded = await Effect.runPromise(
      decode({
        schemaVersion: 1,
        case: "hard-case-1",
        class: "hard-case",
        risks: [],
        source: { kind: "field-report", eventId: "11111111-1111-1111-1111-111111111111" },
      }),
    );
    expect(decoded.source?.kind).toBe("field-report");
    expect(decoded.source?.eventId).toBe("11111111-1111-1111-1111-111111111111");
    expect(decoded.source?.destination).toBeUndefined();
  });
});

describe("writeFixtureScaffold", () => {
  test("writes case.json/prompt.md/files/expected the same way for a plain scaffold", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const caseDir = path.join(dir, "evals", "fixtures", "golden-1");

        yield* writeFixtureScaffold({ caseDir, caseName: "golden-1", class: "golden", risks: ["IN-1"] });

        const caseJson = JSON.parse(yield* fs.readFileString(path.join(caseDir, "case.json"))) as unknown;
        expect(caseJson).toEqual({ schemaVersion: 1, case: "golden-1", class: "golden", risks: ["IN-1"] });
        const prompt = yield* fs.readFileString(path.join(caseDir, "prompt.md"));
        expect(prompt).toContain("golden-1");
        expect(yield* fs.exists(path.join(caseDir, "files", ".gitkeep"))).toBe(true);
        expect(yield* fs.exists(path.join(caseDir, "expected", "answer-key.md"))).toBe(true);
      }),
    );
  });

  test("seeds prompt.md from promptText and stamps source, when given (fixture harvest's use)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const caseDir = path.join(dir, "evals", "fixtures", "hard-case-1");

        yield* writeFixtureScaffold({
          caseDir,
          caseName: "hard-case-1",
          class: "hard-case",
          risks: [],
          promptText: "Broke on a repo with no package.json.\n",
          source: { kind: "field-report", eventId: "33333333-3333-3333-3333-333333333333" },
        });

        const prompt = yield* fs.readFileString(path.join(caseDir, "prompt.md"));
        expect(prompt).toBe("Broke on a repo with no package.json.\n");
        const caseJson = JSON.parse(yield* fs.readFileString(path.join(caseDir, "case.json"))) as {
          readonly source: unknown;
        };
        expect(caseJson.source).toEqual({
          kind: "field-report",
          eventId: "33333333-3333-3333-3333-333333333333",
        });
      }),
    );
  });
});
