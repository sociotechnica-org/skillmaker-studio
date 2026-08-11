import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JournalEvent } from "../src/Journal.ts";
import {
  checkStageGateSync,
  nextStageReadinessSync,
  PUBLISHING_UNMEASURED_WARNING,
} from "../src/StageGates.ts";

const withBundleDir = (run: (bundleDir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-stage-gates-"));
  try {
    run(join(dir, "bundle"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const writeSkillJson = (
  bundleDir: string,
  skill: { name: string; oneLiner: string },
): void => {
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, "skill.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      skill: { slug: "demo", ...skill, tags: [], created: "2026-08-11", harnesses: [], stage: "idea" },
      design: { failureHypotheses: [] },
      evals: { cases: [], configs: [] },
    })}\n`,
  );
};

const noEvents: ReadonlyArray<JournalEvent> = [];

describe("checkStageGateSync — the ruled gate table", () => {
  test("idea -> researching HARD-refuses without birth intent (empty oneLiner)", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "" });
      const verdict = checkStageGateSync(bundleDir, "researching", noEvents);
      expect(verdict.allowed).toBe(false);
      expect(verdict.allowed === false && verdict.reason).toContain("birth intent");
    });
  });

  test("idea -> researching allows once name AND oneLiner are non-empty", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "Does a demo thing." });
      expect(checkStageGateSync(bundleDir, "researching", noEvents)).toEqual({
        allowed: true,
        warnings: [],
      });
    });
  });

  test("researching -> drafting HARD-refuses when design.md is missing or empty", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      expect(checkStageGateSync(bundleDir, "drafting", noEvents).allowed).toBe(false);
      writeFileSync(join(bundleDir, "design.md"), "   \n");
      expect(checkStageGateSync(bundleDir, "drafting", noEvents).allowed).toBe(false);
      writeFileSync(join(bundleDir, "design.md"), "# Design\n\nReal content.\n");
      expect(checkStageGateSync(bundleDir, "drafting", noEvents).allowed).toBe(true);
    });
  });

  test("drafting -> evaluating HARD-refuses without output/SKILL.md", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      expect(checkStageGateSync(bundleDir, "evaluating", noEvents).allowed).toBe(false);
      mkdirSync(join(bundleDir, "output"), { recursive: true });
      writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Demo\n");
      expect(checkStageGateSync(bundleDir, "evaluating", noEvents).allowed).toBe(true);
    });
  });

  test("evaluating -> published is SOFT: warns 'publishing unmeasured' without a graded realized run, NEVER blocks", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      const verdict = checkStageGateSync(bundleDir, "published", noEvents);
      expect(verdict).toEqual({ allowed: true, warnings: [PUBLISHING_UNMEASURED_WARNING] });
    });
  });

  test("the soft gate goes quiet once a realized case has a graded (grade-file) completed run", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      mkdirSync(join(bundleDir, "evals", "cases", "golden-basic"), { recursive: true });
      const runDir = join(bundleDir, "runs", "run-1");
      mkdirSync(join(runDir, "grades", "human"), { recursive: true });
      writeFileSync(
        join(runDir, "run.json"),
        JSON.stringify({ id: "run-1", fixtureCase: "golden-basic", status: "completed" }),
      );
      writeFileSync(
        join(runDir, "grades", "human", "grade.json"),
        JSON.stringify({ schemaVersion: 1, runId: "run-1", grader: "human", verdict: "pass" }),
      );
      expect(checkStageGateSync(bundleDir, "published", noEvents)).toEqual({
        allowed: true,
        warnings: [],
      });
    });
  });

  test("a journal-only grade (pre-grade-file run) also satisfies the soft gate; ungraded or infra-error runs do not", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      mkdirSync(join(bundleDir, "evals", "cases", "golden-basic"), { recursive: true });
      const runDir = join(bundleDir, "runs", "run-2");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, "run.json"),
        JSON.stringify({ id: "run-2", fixtureCase: "golden-basic", status: "completed" }),
      );

      // Ungraded: still warns.
      expect(checkStageGateSync(bundleDir, "published", noEvents)).toEqual({
        allowed: true,
        warnings: [PUBLISHING_UNMEASURED_WARNING],
      });

      const graded = [
        {
          schemaVersion: 1,
          id: "e-1",
          at: "2026-08-11T00:00:00.000Z",
          actor: { kind: "user", name: "t" },
          type: "run.graded",
          payload: { id: "run-2", verdict: "pass" },
        },
      ] as unknown as ReadonlyArray<JournalEvent>;
      expect(checkStageGateSync(bundleDir, "published", graded)).toEqual({
        allowed: true,
        warnings: [],
      });
    });
  });

  test("legacy bundles gate too: identity from bundle.json, cases under evals/fixtures/", () => {
    withBundleDir((bundleDir) => {
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(
        join(bundleDir, "bundle.json"),
        JSON.stringify({
          schemaVersion: 1,
          slug: "legacy",
          name: "Legacy",
          oneLiner: "",
          tags: [],
          created: "2026-01-01",
          targets: [],
        }),
      );
      const verdict = checkStageGateSync(bundleDir, "researching", noEvents);
      expect(verdict.allowed).toBe(false);
    });
  });
});

describe("nextStageReadinessSync — the same checks, answered continuously", () => {
  test("reports the next stage's hard gate as not-ready with its reason", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "" });
      const readiness = nextStageReadinessSync(bundleDir, "idea", noEvents);
      expect(readiness?.to).toBe("researching");
      expect(readiness?.gate).toBe("hard");
      expect(readiness?.ready).toBe(false);
      expect(readiness?.reasons[0]).toContain("birth intent");
    });
  });

  test("reports the publish gate as soft and not-ready-with-warning when unmeasured", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      const readiness = nextStageReadinessSync(bundleDir, "evaluating", noEvents);
      expect(readiness).toEqual({
        to: "published",
        gate: "soft",
        ready: false,
        reasons: [PUBLISHING_UNMEASURED_WARNING],
      });
    });
  });

  test("null at the top of the ladder", () => {
    withBundleDir((bundleDir) => {
      writeSkillJson(bundleDir, { name: "Demo", oneLiner: "x" });
      expect(nextStageReadinessSync(bundleDir, "published", noEvents)).toBeNull();
    });
  });
});
