/**
 * `skillmaker case plan` -- the design conversation's case door (design-skill
 * authors claims through CLI doors): appends a PLANNED case entry to
 * skill.json's `evals.cases[]` (prose setup/expectedBehavior, NO materials
 * dir) and wires the hypothesis->case pointers. Refuses dangling claim ids
 * and legacy bundles; re-planning an already-listed name is idempotent.
 */
import { BunServices } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Workspace, WorkspaceLayer } from "@skillmaker/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCasePlan } from "../src/commands/CasePlan.ts";
import { runClaimsAdd } from "../src/commands/ClaimsAdd.ts";

const TestServices = BunServices.layer;

const provide = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(WorkspaceLayer), Effect.provide(TestServices)));

const withTempDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-cli-case-plan-test-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Inits a workspace and births one skill.json bundle (new bundles are born migrated). */
const setUpBundle = async (dir: string, slug = "example-skill"): Promise<void> => {
  await provide(
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      yield* workspace.init(dir);
      yield* workspace.createBundle(dir, { slug });
    }),
  );
};

const readSkillJson = (dir: string, slug: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, "skills", slug, "skill.json"), "utf8")) as Record<
    string,
    unknown
  >;

describe("skillmaker case plan", () => {
  test("plans a case: skill.json entry with prose setup/expectedBehavior, pointers wired, NO materials dir", async () => {
    await withTempDir(async (dir) => {
      await setUpBundle(dir);
      const claim = await provide(
        runClaimsAdd(dir, "example-skill", {
          json: false,
          id: "OUT-3",
          failure: "Pads suggestions to meet a quota",
        }),
      );
      expect(claim.exitCode).toBe(0);

      const result = await provide(
        runCasePlan(dir, "example-skill", {
          json: true,
          name: "nothing-worth-writing",
          klass: "empty",
          setup: "Provide transcripts with no distinctive insight.",
          expectedBehavior: "The skill explicitly returns no suggestions.",
          risks: "OUT-3",
        }),
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        status: "planned",
        bundle: "example-skill",
        case: "nothing-worth-writing",
        class: "empty",
        risks: ["OUT-3"],
      });

      const skillJson = readSkillJson(dir, "example-skill");
      const evals = skillJson.evals as { cases: Array<Record<string, unknown>> };
      expect(evals.cases).toEqual([
        {
          name: "nothing-worth-writing",
          class: "empty",
          setup: "Provide transcripts with no distinctive insight.",
          expectedBehavior: "The skill explicitly returns no suggestions.",
        },
      ]);
      const design = skillJson.design as { failureHypotheses: Array<Record<string, unknown>> };
      expect(design.failureHypotheses[0]?.cases).toEqual(["nothing-worth-writing"]);
      // Planned means NO materials directory for the case (the empty
      // evals/cases/ parent is scaffolded at bundle birth).
      expect(
        existsSync(
          join(dir, "skills", "example-skill", "evals", "cases", "nothing-worth-writing"),
        ),
      ).toBe(false);
    });
  });

  test("refuses dangling claim ids before writing anything", async () => {
    await withTempDir(async (dir) => {
      await setUpBundle(dir);
      const before = readSkillJson(dir, "example-skill");

      const result = await provide(
        runCasePlan(dir, "example-skill", {
          json: false,
          name: "orphan-case",
          risks: "RE-9",
        }),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown claim id(s) RE-9");
      expect(readSkillJson(dir, "example-skill")).toEqual(before);
    });
  });

  test("refuses a legacy (bundle.json) bundle", async () => {
    await withTempDir(async (dir) => {
      await provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace;
          yield* workspace.init(dir);
        }),
      );
      const legacyDir = join(dir, "skills", "legacy-skill");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(
        join(legacyDir, "bundle.json"),
        JSON.stringify({
          schemaVersion: 1,
          slug: "legacy-skill",
          name: "Legacy",
          oneLiner: "",
          tags: [],
          created: "2026-01-01",
          targets: [],
        }),
      );

      const result = await provide(
        runCasePlan(dir, "legacy-skill", { json: false, name: "some-case" }),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("legacy (bundle.json) bundle");
      expect(existsSync(join(legacyDir, "skill.json"))).toBe(false);
    });
  });

  test("re-planning an already-listed name is idempotent (entry kept, pointers updated)", async () => {
    await withTempDir(async (dir) => {
      await setUpBundle(dir);
      await provide(
        runClaimsAdd(dir, "example-skill", { json: false, id: "IN-1", failure: "f1" }),
      );
      await provide(
        runClaimsAdd(dir, "example-skill", { json: false, id: "RE-2", failure: "f2" }),
      );

      const first = await provide(
        runCasePlan(dir, "example-skill", {
          json: false,
          name: "shared-case",
          setup: "original prose",
          risks: "IN-1",
        }),
      );
      expect(first.exitCode).toBe(0);
      expect(first.stdout).toContain('planned case "shared-case"');

      // Re-plan pointing a second hypothesis at the same case.
      const second = await provide(
        runCasePlan(dir, "example-skill", {
          json: false,
          name: "shared-case",
          setup: "different prose that must NOT overwrite",
          risks: "RE-2",
        }),
      );
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("already listed");

      const skillJson = readSkillJson(dir, "example-skill");
      const evals = skillJson.evals as { cases: Array<Record<string, unknown>> };
      expect(evals.cases.length).toBe(1);
      expect(evals.cases[0]?.setup).toBe("original prose");
      const design = skillJson.design as { failureHypotheses: Array<Record<string, unknown>> };
      expect(design.failureHypotheses.map((h) => h.cases)).toEqual([
        ["shared-case"],
        ["shared-case"],
      ]);
    });
  });

  test("usage errors: missing --name; invalid --class; unknown risk family", async () => {
    await withTempDir(async (dir) => {
      await setUpBundle(dir);

      const noName = await provide(runCasePlan(dir, "example-skill", { json: false }));
      expect(noName.exitCode).toBe(2);
      expect(noName.stderr).toContain("missing --name <case>");

      const badClass = await provide(
        runCasePlan(dir, "example-skill", { json: false, name: "x", klass: "weird" }),
      );
      expect(badClass.exitCode).toBe(2);
      expect(badClass.stderr).toContain('invalid --class "weird"');

      const badRisk = await provide(
        runCasePlan(dir, "example-skill", { json: false, name: "x", risks: "ZZ-1" }),
      );
      expect(badRisk.exitCode).toBe(2);
      expect(badRisk.stderr).toContain('risk id "ZZ-1"');
    });
  });
});
