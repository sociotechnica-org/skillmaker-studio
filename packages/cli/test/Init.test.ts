/**
 * Unit tests for `skillmaker init`'s finish-the-job behavior
 * (docs/proposals/2026-07-20-install-simplification.md Phase A.5):
 * sweeping for pre-existing skills, detecting agent harnesses, registering
 * the `/skillmaker` skill, and printing one explicit next action.
 *
 * `sweepExistingSkills` also checks a handful of home-directory spots
 * (`~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`) via
 * `os.homedir()`. To keep these tests deterministic regardless of what the
 * machine running them actually has under its real home directory, HOME
 * (and USERPROFILE, for completeness) are pointed at an empty temp dir for
 * the duration of each test -- `os.homedir()` reads those env vars, so this
 * neutralizes the home sweep without needing to touch `Init.ts`'s pure,
 * uninjected `homeSweepDirs()` helper.
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
import { runInit } from "../src/commands/Init.ts";

const TestServices = BunServices.layer;

const withIsolatedHome = async <A>(run: (dir: string, home: string) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-cli-init-test-"));
  const home = mkdtempSync(join(tmpdir(), "skillmaker-cli-init-home-"));
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await run(dir, home);
  } finally {
    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }
    if (savedUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = savedUserProfile;
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
};

const runInitEffect = (dir: string, json = false) =>
  Effect.runPromise(runInit(dir, { json }).pipe(Effect.provide(WorkspaceLayer), Effect.provide(TestServices)));

describe("runInit", () => {
  test("bare workspace: no sweep matches, no harness, next action opens the board", async () => {
    await withIsolatedHome(async (dir) => {
      const result = await runInitEffect(dir);
      expect(result.stdout).toContain(`skillmaker: initialized workspace at ${dir}`);
      expect(result.stdout).toContain("no existing skills found nearby");
      expect(result.stdout).toContain("no agent harness detected");
      expect(result.stdout).toContain('→ run "skillmaker start" to open the board');
      expect(result.stdout).not.toContain("adopt-manifest.md");
    });
  });

  test("re-running init reports already_initialized", async () => {
    await withIsolatedHome(async (dir) => {
      await runInitEffect(dir);
      const second = await runInitEffect(dir);
      expect(second.stdout).toContain(`skillmaker: already initialized at ${dir}`);
    });
  });

  test("a bare SKILL.md in the tree is swept into adopt-manifest.md, next action reviews it", async () => {
    await withIsolatedHome(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          yield* fs.makeDirectory(path.join(dir, "found-skill"), { recursive: true });
          yield* fs.writeFileString(
            path.join(dir, "found-skill", "SKILL.md"),
            "---\nname: found-skill\ndescription: test\n---\nBody.\n",
          );
        }).pipe(Effect.provide(TestServices)),
      );

      const result = await runInitEffect(dir);
      expect(result.stdout).toContain("existing skill(s) nearby -- wrote");
      expect(result.stdout).toContain(`review ${join(dir, "adopt-manifest.md")}`);
      expect(result.stdout).toContain('then run "skillmaker adopt --from-manifest"');

      const manifestExists = await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          return yield* fs.exists(path.join(dir, "adopt-manifest.md"));
        }).pipe(Effect.provide(TestServices)),
      );
      expect(manifestExists).toBe(true);
    });
  });

  test("a .claude/ dir is detected and gets the /skillmaker skill registered", async () => {
    await withIsolatedHome(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          yield* fs.makeDirectory(path.join(dir, ".claude"), { recursive: true });
        }).pipe(Effect.provide(TestServices)),
      );

      const result = await runInitEffect(dir);
      expect(result.stdout).toContain("skillmaker: detected Claude Code");
      expect(result.stdout).toContain(
        `/skillmaker skill installed at ${join(dir, ".claude", "skills", "skillmaker", "SKILL.md")}`,
      );
      expect(result.stdout).toContain("consider adding .claude/skills/ and .agents/skills/ to .gitignore");

      const installed = await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          return yield* fs.readFileString(
            path.join(dir, ".claude", "skills", "skillmaker", "SKILL.md"),
          );
        }).pipe(Effect.provide(TestServices)),
      );
      expect(installed).toContain("name: skillmaker");

      // Re-running is a no-op for the skill file: same content, so the
      // "installed" line doesn't repeat and no gitignore hint is printed
      // for it a second time (nothing changed to hint about).
      const second = await runInitEffect(dir);
      expect(second.stdout).toContain("already up to date at");
      expect(second.stdout).not.toContain("consider adding .claude/skills/");
    });
  });

  test("json output carries the same facts as the text output", async () => {
    await withIsolatedHome(async (dir) => {
      const result = await runInitEffect(dir, true);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("initialized");
      expect(parsed.root).toBe(dir);
      expect(parsed.sweep.manifest).toBeNull();
      expect(parsed.harnesses).toEqual([
        { kind: "claude-code", present: false },
        { kind: "codex", present: false },
      ]);
      expect(parsed.skillInstalls).toEqual([]);
      expect(parsed.nextAction).toBe('run "skillmaker start" to open the board');
    });
  });
});
