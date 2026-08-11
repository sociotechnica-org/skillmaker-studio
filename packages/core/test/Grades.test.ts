/**
 * Git-visible grade files (director ruling 2026-08-11, Grades.ts): the
 * write/archive shape (`grade.json` = latest, prior grades archived as
 * `grade.<n>.json`), the lane reads, and cross-lane latest-wins resolution.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { GradeRecord, HUMAN_GRADER, latestGrade, readGradeLanes, writeGradeFile } from "../src/Grades.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const makeGrade = (overrides: {
  readonly verdict: "pass" | "fail" | "partial";
  readonly grader?: string;
  readonly gradedAt?: string;
  readonly notes?: string;
  readonly checks?: ReadonlyArray<{ readonly text: string; readonly pass: boolean }>;
}): GradeRecord =>
  GradeRecord.make({
    schemaVersion: 1,
    runId: "run-1",
    grader: overrides.grader ?? HUMAN_GRADER,
    verdict: overrides.verdict,
    ...(overrides.checks !== undefined ? { checks: overrides.checks } : {}),
    ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
    gradedAt: overrides.gradedAt ?? "2026-08-11T00:00:00.000Z",
    actor,
  });

const withRunDir = (run: (runDir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-grades-test-"));
  try {
    run(join(dir, "runs", "run-1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("writeGradeFile", () => {
  test("first grade creates grades/<grader>/grade.json with the full record", () => {
    withRunDir((runDir) => {
      const result = writeGradeFile(
        runDir,
        makeGrade({ verdict: "pass", notes: "clean run", checks: [{ text: "did the thing", pass: true }] }),
      );
      expect(result.path).toBe(join(runDir, "grades", "human", "grade.json"));
      expect(result.archivedAs).toBeUndefined();
      const written = JSON.parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
      expect(written).toMatchObject({
        schemaVersion: 1,
        runId: "run-1",
        grader: "human",
        verdict: "pass",
        notes: "clean run",
        checks: [{ text: "did the thing", pass: true }],
        gradedAt: "2026-08-11T00:00:00.000Z",
        actor: { kind: "user", name: "test-user" },
      });
    });
  });

  test("regrade archives the prior grade.json as grade.<n>.json (append-only history), latest stays in grade.json", () => {
    withRunDir((runDir) => {
      writeGradeFile(runDir, makeGrade({ verdict: "pass", gradedAt: "2026-08-11T00:00:00.000Z" }));
      const second = writeGradeFile(runDir, makeGrade({ verdict: "fail", gradedAt: "2026-08-11T01:00:00.000Z" }));
      expect(second.archivedAs).toBe(join(runDir, "grades", "human", "grade.1.json"));
      const third = writeGradeFile(runDir, makeGrade({ verdict: "partial", gradedAt: "2026-08-11T02:00:00.000Z" }));
      expect(third.archivedAs).toBe(join(runDir, "grades", "human", "grade.2.json"));

      const latest = JSON.parse(readFileSync(join(runDir, "grades", "human", "grade.json"), "utf8")) as {
        readonly verdict: string;
      };
      expect(latest.verdict).toBe("partial");
      const first = JSON.parse(readFileSync(join(runDir, "grades", "human", "grade.1.json"), "utf8")) as {
        readonly verdict: string;
      };
      expect(first.verdict).toBe("pass");
      expect(existsSync(join(runDir, "grades", "human", "grade.3.json"))).toBe(false);
    });
  });
});

describe("readGradeLanes", () => {
  test("a missing grades/ directory reads as no lanes, no warnings (journal-only runs)", () => {
    withRunDir((runDir) => {
      mkdirSync(runDir, { recursive: true });
      expect(readGradeLanes(runDir)).toEqual({ lanes: [], warnings: [] });
    });
  });

  test("returns one lane per grader with history newest first", () => {
    withRunDir((runDir) => {
      writeGradeFile(runDir, makeGrade({ verdict: "pass", gradedAt: "2026-08-11T00:00:00.000Z" }));
      writeGradeFile(runDir, makeGrade({ verdict: "fail", gradedAt: "2026-08-11T01:00:00.000Z" }));
      writeGradeFile(runDir, makeGrade({ verdict: "partial", gradedAt: "2026-08-11T02:00:00.000Z" }));
      writeGradeFile(
        runDir,
        makeGrade({ verdict: "pass", grader: "agent-critic", gradedAt: "2026-08-10T00:00:00.000Z" }),
      );

      const { lanes, warnings } = readGradeLanes(runDir);
      expect(warnings).toEqual([]);
      expect(lanes.map((lane) => lane.grader)).toEqual(["agent-critic", "human"]);
      const human = lanes.find((lane) => lane.grader === "human");
      expect(human?.latest.verdict).toBe("partial");
      expect(human?.history.map((g) => g.verdict)).toEqual(["fail", "pass"]);
    });
  });

  test("a malformed grade.json skips that lane with a warning; a malformed history file skips just that file", () => {
    withRunDir((runDir) => {
      writeGradeFile(runDir, makeGrade({ verdict: "pass", gradedAt: "2026-08-11T00:00:00.000Z" }));
      writeGradeFile(runDir, makeGrade({ verdict: "fail", gradedAt: "2026-08-11T01:00:00.000Z" }));
      writeFileSync(join(runDir, "grades", "human", "grade.1.json"), "{ not json");
      const brokenLane = join(runDir, "grades", "robo");
      mkdirSync(brokenLane, { recursive: true });
      writeFileSync(join(brokenLane, "grade.json"), JSON.stringify({ verdict: "banana" }));

      const { lanes, warnings } = readGradeLanes(runDir);
      expect(lanes.map((lane) => lane.grader)).toEqual(["human"]);
      expect(lanes[0]?.latest.verdict).toBe("fail");
      expect(lanes[0]?.history).toEqual([]);
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("grades/human/grade.1.json is malformed");
      expect(warnings.join("\n")).toContain("grades/robo/grade.json is malformed");
    });
  });
});

describe("latestGrade", () => {
  test("latest gradedAt wins across lanes; a timestamp tie breaks deterministically by grader id", () => {
    withRunDir((runDir) => {
      writeGradeFile(runDir, makeGrade({ verdict: "fail", gradedAt: "2026-08-11T00:00:00.000Z" }));
      writeGradeFile(
        runDir,
        makeGrade({ verdict: "pass", grader: "agent-critic", gradedAt: "2026-08-11T05:00:00.000Z" }),
      );
      const { lanes } = readGradeLanes(runDir);
      expect(latestGrade(lanes)?.verdict).toBe("pass");
      expect(latestGrade(lanes)?.grader).toBe("agent-critic");

      // Tie: same timestamp in both lanes -- grader id descending wins.
      writeGradeFile(runDir, makeGrade({ verdict: "partial", gradedAt: "2026-08-11T05:00:00.000Z" }));
      const tied = readGradeLanes(runDir);
      expect(latestGrade(tied.lanes)?.grader).toBe("human");
      expect(latestGrade(tied.lanes)?.verdict).toBe("partial");
    });
  });

  test("no lanes resolves to undefined", () => {
    expect(latestGrade([])).toBeUndefined();
  });
});
