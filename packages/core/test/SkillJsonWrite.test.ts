import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addCaseToSkillJson,
  addClaimToSkillJson,
  newSkillJsonDocument,
  scaffoldCaseForBundle,
  writeSkillJsonStageSync,
} from "../src/SkillJsonWrite.ts";
import { parseSkillJsonSync } from "../src/SkillJson.ts";
import { withTempDir } from "./support/TestLayer.ts";

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const writeNewSkillJson = (bundleDir: string): void => {
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, "skill.json"),
    `${JSON.stringify(
      newSkillJsonDocument({ slug: "demo", name: "Demo", oneLiner: "x", created: "2026-08-11" }),
      null,
      2,
    )}\n`,
  );
};

describe("newSkillJsonDocument", () => {
  test("births a schemaVersion-2 document the tolerant reader parses cleanly", async () => {
    await withTempDir((dir) =>
      Effect.sync(() => {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        const parsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(parsed.status).toBe("parsed");
        expect(parsed.warnings).toEqual([]);
        expect(parsed.skill?.stage).toBe("idea");
        expect(parsed.hypotheses).toEqual([]);
        expect(parsed.cases).toEqual([]);
      }),
    );
  });
});

describe("writeSkillJsonStageSync", () => {
  test("writes skill.stage losslessly (unknown fields survive verbatim)", async () => {
    await withTempDir((dir) =>
      Effect.sync(() => {
        const bundleDir = join(dir, "b");
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(
          join(bundleDir, "skill.json"),
          JSON.stringify({
            schemaVersion: 2,
            skill: { slug: "demo", stage: "idea", handWritten: "keep-me" },
            somethingCustom: { alsoKept: true },
          }),
        );
        expect(writeSkillJsonStageSync(bundleDir, "researching")).toBe("written");
        const after = readJson(join(bundleDir, "skill.json"));
        const skill = after.skill as Record<string, unknown>;
        expect(skill.stage).toBe("researching");
        expect(skill.handWritten).toBe("keep-me");
        expect(after.somethingCustom).toEqual({ alsoKept: true });
      }),
    );
  });

  test("legacy bundle (no skill.json) -> 'no-skill-json'; broken JSON -> 'unusable'", async () => {
    await withTempDir((dir) =>
      Effect.sync(() => {
        const bundleDir = join(dir, "b");
        mkdirSync(bundleDir, { recursive: true });
        expect(writeSkillJsonStageSync(bundleDir, "drafting")).toBe("no-skill-json");
        writeFileSync(join(bundleDir, "skill.json"), "{ nope");
        expect(writeSkillJsonStageSync(bundleDir, "drafting")).toBe("unusable");
        expect(readFileSync(join(bundleDir, "skill.json"), "utf8")).toBe("{ nope");
      }),
    );
  });
});

describe("addClaimToSkillJson / addCaseToSkillJson — the write doors", () => {
  test("claims add appends a hypothesis with empty cases[]; duplicate id refuses", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);

        const added = yield* addClaimToSkillJson(bundleDir, {
          id: "IN-1",
          failure: "Ignores the requested format",
          mustNever: "Must honor the requested format",
          probability: "Medium",
          impact: "High",
        });
        expect(added.kind).toBe("added");

        const dup = yield* addClaimToSkillJson(bundleDir, { id: "IN-1", failure: "again" });
        expect(dup.kind).toBe("exists");

        const parsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(parsed.hypotheses).toEqual([
          {
            id: "IN-1",
            failure: "Ignores the requested format",
            probability: "Medium",
            impact: "High",
            mustNever: "Must honor the requested format",
            cases: [],
          },
        ]);
      }),
    );
  });

  test("case add refuses dangling risk ids BEFORE writing anything", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        const before = readFileSync(join(bundleDir, "skill.json"), "utf8");

        const outcome = yield* addCaseToSkillJson(bundleDir, {
          caseName: "golden-basic",
          klass: "golden",
          risks: ["RE-9"],
        });
        expect(outcome).toEqual({ kind: "dangling-risks", missing: ["RE-9"] });
        expect(readFileSync(join(bundleDir, "skill.json"), "utf8")).toBe(before);
      }),
    );
  });

  test("a planned case (case plan's door): prose setup/expectedBehavior persist, no materials dir involved", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        yield* addClaimToSkillJson(bundleDir, { id: "OUT-3", failure: "pads suggestions" });

        const outcome = yield* addCaseToSkillJson(bundleDir, {
          caseName: "nothing-worth-writing",
          klass: "empty",
          risks: ["OUT-3"],
          setup: "Provide transcripts with no distinctive and safe public insight.",
          expectedBehavior: "The skill explicitly returns no suggestions.",
        });
        expect(outcome.kind).toBe("added");

        const parsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(parsed.cases[0]).toMatchObject({
          name: "nothing-worth-writing",
          class: "empty",
          setup: "Provide transcripts with no distinctive and safe public insight.",
          expectedBehavior: "The skill explicitly returns no suggestions.",
        });
        expect(parsed.hypotheses[0]?.cases).toEqual(["nothing-worth-writing"]);
        // Planned = no evals/cases/<name>/ dir; this door never scaffolds one.
        expect(existsSync(join(bundleDir, "evals", "cases", "nothing-worth-writing"))).toBe(false);

        // Re-planning is idempotent: entry kept untouched, edges deduped.
        const again = yield* addCaseToSkillJson(bundleDir, {
          caseName: "nothing-worth-writing",
          klass: "empty",
          risks: ["OUT-3"],
          setup: "different prose that must NOT overwrite",
        });
        expect(again.kind).toBe("realized");
        const reparsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(reparsed.cases.length).toBe(1);
        expect(reparsed.cases[0]?.setup).toBe(
          "Provide transcripts with no distinctive and safe public insight.",
        );
        expect(reparsed.hypotheses[0]?.cases).toEqual(["nothing-worth-writing"]);
      }),
    );
  });

  test("case add appends the entry and wires the hypothesis->case edge (deduped)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        yield* addClaimToSkillJson(bundleDir, { id: "IN-1", failure: "f" });

        const outcome = yield* addCaseToSkillJson(bundleDir, {
          caseName: "golden-basic",
          klass: "golden",
          risks: ["IN-1"],
        });
        expect(outcome.kind).toBe("added");

        const parsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(parsed.hypotheses[0]?.cases).toEqual(["golden-basic"]);
        expect(parsed.cases.map((c) => c.name)).toEqual(["golden-basic"]);
        expect(parsed.cases[0]?.class).toBe("golden");

        // Realizing the already-listed case again only adds missing edges.
        const again = yield* addCaseToSkillJson(bundleDir, {
          caseName: "golden-basic",
          klass: "golden",
          risks: ["IN-1"],
        });
        expect(again.kind).toBe("realized");
        const reparsed = parseSkillJsonSync(join(bundleDir, "skill.json"));
        expect(reparsed.hypotheses[0]?.cases).toEqual(["golden-basic"]);
        expect(reparsed.cases.length).toBe(1);
      }),
    );
  });
});

describe("scaffoldCaseForBundle — one door, two generations", () => {
  test("skill.json bundle: entry in skill.json + evals/cases/<name>/ materials (prompt.md, files/, expected.md; NO case.json)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        yield* addClaimToSkillJson(bundleDir, { id: "IN-1", failure: "f" });

        const outcome = yield* scaffoldCaseForBundle(bundleDir, {
          caseName: "golden-basic",
          klass: "golden",
          risks: ["IN-1"],
        });
        expect(outcome).toEqual({
          kind: "created",
          generation: "skill-json",
          caseDirRel: join("evals", "cases", "golden-basic"),
        });

        const caseDir = join(bundleDir, "evals", "cases", "golden-basic");
        expect(existsSync(join(caseDir, "prompt.md"))).toBe(true);
        expect(existsSync(join(caseDir, "files", ".gitkeep"))).toBe(true);
        expect(existsSync(join(caseDir, "expected.md"))).toBe(true);
        expect(existsSync(join(caseDir, "case.json"))).toBe(false);
        expect(existsSync(join(caseDir, "expected", "answer-key.md"))).toBe(false);
      }),
    );
  });

  test("legacy bundle: exactly today's evals/fixtures/<name>/ shape with case.json", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        mkdirSync(bundleDir, { recursive: true });
        writeFileSync(
          join(bundleDir, "bundle.json"),
          JSON.stringify({ schemaVersion: 1, slug: "legacy", name: "L", oneLiner: "", tags: [], created: "2026-01-01", targets: [] }),
        );

        const outcome = yield* scaffoldCaseForBundle(bundleDir, {
          caseName: "golden-basic",
          klass: "golden",
          risks: ["IN-1"], // unvalidated on legacy bundles, exactly as before
        });
        expect(outcome).toEqual({
          kind: "created",
          generation: "legacy",
          caseDirRel: join("evals", "fixtures", "golden-basic"),
        });

        const caseDir = join(bundleDir, "evals", "fixtures", "golden-basic");
        const caseJson = readJson(join(caseDir, "case.json"));
        expect(caseJson).toMatchObject({ case: "golden-basic", class: "golden", risks: ["IN-1"] });
        expect(existsSync(join(caseDir, "prompt.md"))).toBe(true);
        expect(existsSync(join(caseDir, "expected", "answer-key.md"))).toBe(true);
      }),
    );
  });

  test("an existing case directory refuses on both generations", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "b");
        writeNewSkillJson(bundleDir);
        mkdirSync(join(bundleDir, "evals", "cases", "taken"), { recursive: true });
        const outcome = yield* scaffoldCaseForBundle(bundleDir, {
          caseName: "taken",
          klass: "golden",
          risks: [],
        });
        expect(outcome).toEqual({
          kind: "case-dir-exists",
          caseDirRel: join("evals", "cases", "taken"),
        });
      }),
    );
  });
});
