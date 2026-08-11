import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { isValidSlug, layer as WorkspaceLayer, Workspace } from "../src/WorkspaceService.ts";
import { withTempDir } from "./support/TestLayer.ts";

describe("isValidSlug", () => {
  test.each([
    ["research-a-skill", true],
    ["a", true],
    ["a1-b2", true],
    ["", false],
    ["Research-A-Skill", false],
    ["research_a_skill", false],
    ["-leading-dash", false],
    ["trailing-dash-", false],
    ["double--dash", false],
    ["has space", false],
  ])("%s -> %s", (slug, expected) => {
    expect(isValidSlug(slug)).toBe(expected);
  });
});

describe("Workspace.init / resolve / createBundle", () => {
  test("init scaffolds config + journal + skills dir, idempotently", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;

        const first = yield* workspace.init(dir);
        expect(first.status).toBe("initialized");

        const configExists = yield* fs.exists(path.join(dir, "skillmaker.config.json"));
        const journalExists = yield* fs.exists(path.join(dir, ".skillmaker", "events.jsonl"));
        expect(configExists).toBe(true);
        expect(journalExists).toBe(true);

        const second = yield* workspace.init(dir);
        expect(second.status).toBe("already_initialized");
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("resolve walks up to find the workspace root from a nested cwd", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;

        yield* workspace.init(dir);

        const nested = path.join(dir, "a", "b", "c");
        yield* fs.makeDirectory(nested, { recursive: true });

        const resolved = yield* workspace.resolve(nested);
        expect(resolved.root).toBe(dir);
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("resolve fails with WorkspaceNotFoundError when there is no config", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const outcome = yield* Effect.flip(workspace.resolve(dir));
        expect(outcome._tag).toBe("WorkspaceNotFoundError");
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("createBundle scaffolds a bundle and is idempotent on re-run", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;

        yield* workspace.init(dir);
        const first = yield* workspace.createBundle(dir, { slug: "my-first-skill" });
        expect(first.status).toBe("created");

        const bundleDir = path.join(dir, "skills", "my-first-skill");
        for (const relative of ["skill.json", "design.md"]) {
          const exists = yield* fs.exists(path.join(bundleDir, relative));
          expect(exists).toBe(true);
        }
        // THE MERGE write-side tranche (2026-08-11): new bundles are born
        // migrated -- skill.json, no legacy bundle.json, no stations.json.
        for (const legacy of ["bundle.json", "stations.json"]) {
          const exists = yield* fs.exists(path.join(bundleDir, legacy));
          expect(exists).toBe(false);
        }
        const raw = yield* fs.readFileString(path.join(bundleDir, "skill.json"));
        const skillJson = JSON.parse(raw) as {
          schemaVersion: number;
          skill: { slug: string; name: string; stage: string; harnesses: ReadonlyArray<string> };
          design: { failureHypotheses: ReadonlyArray<unknown> };
          evals: { cases: ReadonlyArray<unknown>; configs: ReadonlyArray<unknown> };
        };
        expect(skillJson.schemaVersion).toBe(2);
        expect(skillJson.skill.slug).toBe("my-first-skill");
        expect(skillJson.skill.name).toBe("My First Skill");
        expect(skillJson.skill.stage).toBe("idea");
        expect(skillJson.skill.harnesses).toEqual(["claude-code"]);
        expect(skillJson.design.failureHypotheses).toEqual([]);
        expect(skillJson.evals.cases).toEqual([]);
        for (const relative of ["research", "evals/cases", "output", "runs"]) {
          const exists = yield* fs.exists(path.join(bundleDir, relative, ".gitkeep"));
          expect(exists).toBe(true);
        }

        const second = yield* workspace.createBundle(dir, { slug: "my-first-skill" });
        expect(second.status).toBe("already_exists");
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("createBundle rejects an invalid slug", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        const outcome = yield* Effect.flip(
          workspace.createBundle(dir, { slug: "Not A Slug" }),
        );
        expect(outcome._tag).toBe("InvalidSlugError");
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});
