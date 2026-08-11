/**
 * `skillmaker grade` -- the CLI door. Git-visible grade files (director
 * ruling 2026-08-11, Grades.ts): a grade writes BOTH the
 * `runs/<id>/grades/human/grade.json` file AND the `run.graded` journal
 * event (kept for UI liveness); a regrade archives the prior file grade as
 * `grade.<n>.json` and appends a second event.
 */
import { BunServices } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WorkspaceLayer, Workspace } from "@skillmaker/core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGrade } from "../src/commands/Grade.ts";

const TestServices = BunServices.layer;

const provide = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(WorkspaceLayer), Effect.provide(TestServices)));

const withTempDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-cli-grade-test-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const setUpRun = async (dir: string, runId: string, status = "completed"): Promise<string> => {
  await provide(
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      yield* workspace.init(dir);
      yield* workspace.createBundle(dir, { slug: "example-skill" });
    }),
  );
  const runDir = join(dir, "skills", "example-skill", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "run.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: runId,
      bundle: "example-skill",
      kind: "eval",
      station: null,
      fixtureCase: "golden-basic",
      skillVersionHash: "sha256:v1",
      provider: "claude-code",
      model: "fake-model-1",
      startedAt: "2026-08-11T00:00:00.000Z",
      endedAt: "2026-08-11T00:01:00.000Z",
      status,
      actor: { kind: "process", name: "run-engine" },
    }),
  );
  return runDir;
};

const journalLines = (dir: string): Array<Record<string, any>> => {
  const journalPath = join(dir, ".skillmaker", "events.jsonl");
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, any>);
};

describe("runGrade: git-visible grade files + journal event", () => {
  test("a grade writes grades/human/grade.json AND appends run.graded", async () => {
    await withTempDir(async (dir) => {
      const runDir = await setUpRun(dir, "run-1");
      const result = await provide(
        runGrade(dir, "example-skill", "run-1", { json: false, verdict: "pass", notes: "solid" }),
      );
      expect(result.exitCode).toBe(0);

      const gradePath = join(runDir, "grades", "human", "grade.json");
      expect(existsSync(gradePath)).toBe(true);
      const grade = JSON.parse(readFileSync(gradePath, "utf8")) as Record<string, unknown>;
      expect(grade).toMatchObject({
        schemaVersion: 1,
        runId: "run-1",
        grader: "human",
        verdict: "pass",
        notes: "solid",
      });
      expect(typeof grade["gradedAt"]).toBe("string");
      expect((grade["actor"] as { kind: string }).kind).toBe("user");

      const graded = journalLines(dir).filter((event) => event["type"] === "run.graded");
      expect(graded).toHaveLength(1);
      expect(graded[0]?.["payload"]).toMatchObject({ id: "run-1", verdict: "pass", notes: "solid" });
    });
  });

  test("a regrade archives the prior file grade and appends a second event -- latest wins", async () => {
    await withTempDir(async (dir) => {
      const runDir = await setUpRun(dir, "run-1");
      await provide(runGrade(dir, "example-skill", "run-1", { json: false, verdict: "pass" }));
      await provide(runGrade(dir, "example-skill", "run-1", { json: false, verdict: "fail" }));

      const latest = JSON.parse(
        readFileSync(join(runDir, "grades", "human", "grade.json"), "utf8"),
      ) as { readonly verdict: string };
      expect(latest.verdict).toBe("fail");
      const archived = JSON.parse(
        readFileSync(join(runDir, "grades", "human", "grade.1.json"), "utf8"),
      ) as { readonly verdict: string };
      expect(archived.verdict).toBe("pass");

      const graded = journalLines(dir).filter((event) => event["type"] === "run.graded");
      expect(graded).toHaveLength(2);
    });
  });

  test("a non-completed run is refused: no grade file, no event", async () => {
    await withTempDir(async (dir) => {
      const runDir = await setUpRun(dir, "run-1", "infra-error");
      const result = await provide(
        runGrade(dir, "example-skill", "run-1", { json: false, verdict: "pass" }),
      );
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(join(runDir, "grades"))).toBe(false);
      expect(journalLines(dir).filter((event) => event["type"] === "run.graded")).toHaveLength(0);
    });
  });
});
