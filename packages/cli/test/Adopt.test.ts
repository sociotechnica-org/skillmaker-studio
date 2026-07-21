/**
 * Unit tests for the CLI layer of `skillmaker adopt` / `adopt --triage`:
 * discovery is restricted to the project directory, always (friction log
 * entry #1, director ruling 2026-07-21: "it should restrict itself to the
 * project directory only... always"). A `[path]` argument may narrow the
 * sweep to a subtree of the workspace, but a path that escapes the
 * workspace root -- parent dir, sibling dir, absolute home-registry path --
 * is refused outright.
 *
 * Core-level adopt/triage behavior is covered in
 * `packages/core/test/Adopt.test.ts` and `packages/core/test/Triage.test.ts`.
 */
import { BunServices } from "@effect/platform-bun";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { WorkspaceLayer } from "@skillmaker/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAdoptTriage } from "../src/commands/Adopt.ts";
import { runInit } from "../src/commands/Init.ts";

const TestServices = BunServices.layer;

const provide = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(WorkspaceLayer), Effect.provide(TestServices)));

const withTempDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-cli-adopt-test-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const makeDir = (dir: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      yield* fs.makeDirectory(dir, { recursive: true });
    }).pipe(Effect.provide(TestServices)),
  );

const writeSkill = (dir: string, name: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      yield* fs.makeDirectory(path.join(dir, name), { recursive: true });
      yield* fs.writeFileString(
        path.join(dir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: test\n---\nBody.\n`,
      );
    }).pipe(Effect.provide(TestServices)),
  );

describe("runAdoptTriage: project-directory-only discovery", () => {
  test("a parent-directory path is refused", async () => {
    await withTempDir(async (outer) => {
      const project = join(outer, "project");
      await writeSkill(outer, "outside-skill");
      await makeDir(project);
      await provide(runInit(project, { json: false }));

      const result = await provide(runAdoptTriage(project, "..", { json: false }));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("outside the workspace");
      expect(result.stderr).toContain("only scans inside the project directory");
    });
  });

  test("an absolute path to a home-style registry outside the workspace is refused", async () => {
    await withTempDir(async (outer) => {
      const project = join(outer, "project");
      const fakeHomeRegistry = join(outer, ".claude", "skills");
      await writeSkill(fakeHomeRegistry, "personal-skill");
      await makeDir(project);
      await provide(runInit(project, { json: false }));

      const result = await provide(runAdoptTriage(project, fakeHomeRegistry, { json: false }));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("outside the workspace");

      const manifestExists = await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          return yield* fs.exists(path.join(project, "adopt-manifest.md"));
        }).pipe(Effect.provide(TestServices)),
      );
      expect(manifestExists).toBe(false);
    });
  });

  test("a subtree of the workspace is still a legitimate sweep target", async () => {
    await withTempDir(async (outer) => {
      const project = join(outer, "project");
      await makeDir(project);
      await provide(runInit(project, { json: false }));
      await writeSkill(join(project, "sub"), "inside-skill");

      const result = await provide(runAdoptTriage(project, "sub", { json: true }));
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.rows).toBe(1);
    });
  });
});
