/**
 * The THROWAWAY migration script's pure transform (director ruling
 * 2026-08-11: a standalone script, not a CLI command — these tests cover the
 * transform + a filesystem round-trip through the unified reader, not any
 * CLI wiring).
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillJsonDocument } from "../src/SkillJsonMigration.ts";
import { readBundleStructuredState } from "../src/SkillJson.ts";
import { TestServices } from "./support/TestLayer.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("buildSkillJsonDocument (pure transform)", () => {
  test("the rich evals.json shape: probability/impact/mustNever preserved, proofSpecs become case pointers, prose moves onto cases", () => {
    const { doc, notes } = buildSkillJsonDocument({
      bundleJson: {
        schemaVersion: 1,
        slug: "read-transcripts",
        name: "Read Transcripts",
        oneLiner: "Mine transcripts.",
        tags: ["meta"],
        created: "2026-08-07",
        targets: ["claude-code"],
        publishTargets: ["user"],
      },
      evalsHypotheses: [
        {
          id: "OUT-3",
          failure: "Invents suggestions to meet a quota.",
          probability: "Medium",
          impact: "Medium",
          mustNever: "The skill must never invent or pad suggestions.",
          proofSpecs: [
            {
              name: "nothing-worth-writing",
              setup: "Provide transcripts with no distinctive insight.",
              expectedBehavior: "Explicitly returns no suggestions.",
            },
          ],
        },
      ],
      caseJsons: new Map<string, unknown>([
        [
          "nothing-worth-writing",
          {
            schemaVersion: 1,
            case: "nothing-worth-writing",
            class: "empty",
            risks: ["OUT-3"],
            setup: { files: "files/", env: { A: "1" } },
            grading: { answerKey: "expected/answer-key.md", checks: ["says no suggestions"] },
            source: { kind: "field-report", eventId: "ev-1" },
          },
        ],
      ]),
      stage: "evaluating",
    });

    expect(doc.schemaVersion).toBe(2);
    expect(doc.skill).toEqual({
      slug: "read-transcripts",
      name: "Read Transcripts",
      oneLiner: "Mine transcripts.",
      tags: ["meta"],
      created: "2026-08-07",
      harnesses: ["claude-code"],
      stage: "evaluating",
    });
    expect(doc.design).toEqual({
      failureHypotheses: [
        {
          id: "OUT-3",
          failure: "Invents suggestions to meet a quota.",
          probability: "Medium",
          impact: "Medium",
          mustNever: "The skill must never invent or pad suggestions.",
          cases: ["nothing-worth-writing"],
        },
      ],
    });
    expect(doc.evals).toEqual({
      cases: [
        {
          name: "nothing-worth-writing",
          setup: "Provide transcripts with no distinctive insight.",
          expectedBehavior: "Explicitly returns no suggestions.",
          class: "empty",
          sandbox: { files: "files/", env: { A: "1" } },
          checks: ["says no suggestions"],
          // answerKey was the conventional expected/answer-key.md -> becomes
          // the v2 default (expected.md, moved on disk), so no field.
          source: { kind: "field-report", eventId: "ev-1" },
        },
      ],
      configs: [],
    });
    expect(doc.publish).toEqual({ targets: ["user"] });
    expect(notes).toEqual([]);
  });

  test("the william-draft-skill-md shape (no evals.json): claims absorbed from risk-map.md, case risks[] reversed onto hypotheses", () => {
    const { doc, notes } = buildSkillJsonDocument({
      bundleJson: {
        schemaVersion: 1,
        slug: "william-draft-skill-md",
        name: "William Draft Skill Md",
        oneLiner: "Drafts output/SKILL.md.",
        tags: ["meta", "stations"],
        created: "2026-07-11",
        targets: ["claude-code"],
      },
      riskMapRows: [
        { riskId: "IN-1", description: "Empty design.md", fixtureCase: "golden-basic" },
        { riskId: "RE-1", description: "Ignores revise notes" },
        { riskId: "ADV-1", description: "Drops a constraint", fixtureCase: "golden-basic" },
      ],
      caseJsons: new Map<string, unknown>([
        ["golden-basic", { schemaVersion: 1, case: "golden-basic", class: "golden", risks: ["IN-1", "ADV-1"] }],
        ["refusal-empty-design", { schemaVersion: 1, case: "refusal-empty-design", class: "refusal", risks: ["IN-1"] }],
        ["trigger-basic", { schemaVersion: 1, case: "trigger-basic", class: "trigger", risks: ["IN-2"] }],
      ]),
      stage: "published",
    });

    const design = doc.design;
    if (!isRecord(design) || !Array.isArray(design.failureHypotheses)) throw new Error("no design section");
    const byId = new Map<unknown, Record<string, unknown>>(
      design.failureHypotheses.filter(isRecord).map((h) => [h.id, h] as const),
    );
    // Risk-map rows became hypotheses; case risks[] reversed onto them.
    expect(byId.get("IN-1")).toEqual({
      id: "IN-1",
      failure: "Empty design.md",
      cases: ["golden-basic", "refusal-empty-design"],
    });
    expect(byId.get("RE-1")).toEqual({ id: "RE-1", failure: "Ignores revise notes", cases: [] });
    expect(byId.get("ADV-1")?.cases).toEqual(["golden-basic"]);
    // trigger-basic pointed at IN-2, which no claims source described:
    // a stub hypothesis keeps the edge, with a note to fill it in.
    expect(byId.get("IN-2")).toEqual({ id: "IN-2", failure: "", cases: ["trigger-basic"] });
    expect(notes.some((n) => n.includes('risk "IN-2"'))).toBe(true);
    expect(notes.some((n) => n.includes("absorbed from evals/risk-map.md"))).toBe(true);

    const evals = doc.evals;
    if (!isRecord(evals) || !Array.isArray(evals.cases)) throw new Error("no evals section");
    expect(evals.cases.map((c: { name: string }) => c.name).sort()).toEqual([
      "golden-basic",
      "refusal-empty-design",
      "trigger-basic",
    ]);
    // No publishTargets on the input -> no publish section.
    expect(doc.publish).toBeUndefined();
  });

  test("a non-conventional answerKey path is preserved verbatim as `expected`", () => {
    const { doc } = buildSkillJsonDocument({
      bundleJson: { slug: "s" },
      caseJsons: new Map<string, unknown>([
        ["c", { case: "c", class: "golden", risks: [], grading: { answerKey: "expected/rubric.md" } }],
      ]),
    });
    const evals = doc.evals;
    if (!isRecord(evals) || !Array.isArray(evals.cases)) throw new Error("no evals section");
    expect(evals.cases[0]).toMatchObject({ name: "c", expected: "expected/rubric.md" });
  });
});

describe("migration round-trip on disk", () => {
  const scaffoldLegacyBundle = (dir: string): void => {
    writeFileSync(
      join(dir, "bundle.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          slug: "william-shaped",
          name: "William Shaped",
          oneLiner: "A replica of william-draft-skill-md's real shape.",
          tags: ["meta"],
          created: "2026-07-11",
          targets: ["claude-code"],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "stations.json"),
      JSON.stringify({ schemaVersion: 1, template: "default", stations: {} }),
    );
    mkdirSync(join(dir, "evals"), { recursive: true });
    writeFileSync(
      join(dir, "evals", "risk-map.md"),
      `---
bundle: william-shaped
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty design.md | ● covered | golden-basic |
| RE-1 | Ignores revise notes | ○ gap | — |
`,
    );
    const caseDir = join(dir, "evals", "fixtures", "golden-basic");
    mkdirSync(join(caseDir, "files"), { recursive: true });
    mkdirSync(join(caseDir, "expected"), { recursive: true });
    writeFileSync(
      join(caseDir, "case.json"),
      JSON.stringify({ schemaVersion: 1, case: "golden-basic", class: "golden", risks: ["IN-1"] }),
    );
    writeFileSync(join(caseDir, "prompt.md"), "Draft the skill.\n");
    writeFileSync(join(caseDir, "expected", "answer-key.md"), "# Answer key\n");
  };

  /** The script stays outside core's tsc program, so the round-trip drives it as a subprocess — which also exercises the real entry point. */
  const runScript = (dir: string): { stdout: string; status: number | null } => {
    const scriptPath = join(import.meta.dir, "..", "..", "..", "scripts", "migrate-skill-json.ts");
    const result = spawnSync(process.execPath, [scriptPath, dir], { encoding: "utf8" });
    return { stdout: `${result.stdout}${result.stderr}`, status: result.status };
  };

  test("migrate -> files restructured, legacy files deleted, unified reader serves the same claims/cases; second run is a no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skillmaker-migrate-test-"));
    try {
      scaffoldLegacyBundle(dir);

      const first = runScript(dir);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("migrated.");

      // Files restructured.
      expect(existsSync(join(dir, "skill.json"))).toBe(true);
      expect(existsSync(join(dir, "bundle.json"))).toBe(false);
      expect(existsSync(join(dir, "stations.json"))).toBe(false);
      expect(existsSync(join(dir, "evals", "risk-map.md"))).toBe(false);
      expect(existsSync(join(dir, "evals", "fixtures"))).toBe(false);
      expect(existsSync(join(dir, "evals", "cases", "golden-basic", "prompt.md"))).toBe(true);
      expect(existsSync(join(dir, "evals", "cases", "golden-basic", "case.json"))).toBe(false);
      expect(existsSync(join(dir, "evals", "cases", "golden-basic", "expected.md"))).toBe(true);
      expect(existsSync(join(dir, "evals", "cases", "golden-basic", "expected", "answer-key.md"))).toBe(false);

      const written: unknown = JSON.parse(readFileSync(join(dir, "skill.json"), "utf8"));
      expect(isRecord(written) && written.schemaVersion).toBe(2);

      // The unified reader serves the migrated bundle.
      const state = await Effect.runPromise(readBundleStructuredState(dir).pipe(Effect.provide(TestServices)));
      expect(state.hasSkillJson).toBe(true);
      expect(state.claimsSource).toBe("skill.json");
      expect(state.claims.map((c) => [c.riskId, c.coverage])).toEqual([
        ["IN-1", "covered"],
        ["RE-1", "gap"],
      ]);
      expect(state.cases).toEqual([{ caseName: "golden-basic", class: "golden", risks: [], hasPromptMd: true }]);
      expect(state.warnings).toEqual([]);

      // Idempotent: running again is a no-op with a message, not a rewrite.
      const before = readFileSync(join(dir, "skill.json"), "utf8");
      const again = runScript(dir);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("already migrated");
      expect(readFileSync(join(dir, "skill.json"), "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
