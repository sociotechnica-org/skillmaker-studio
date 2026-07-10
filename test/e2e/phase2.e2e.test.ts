/**
 * End-to-end: spawns the real `skillmaker` CLI against a fresh,
 * git-initialized scratch directory, and drives it through the Phase 2
 * verify sequence from plan.md — `list`/`status`/`reindex` and the
 * rebuildability proof (delete studio.db, `list` again, identical output).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, cpSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase2-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const dbPath = () => join(scratchDir, ".skillmaker", "studio.db");

interface BundleView {
  readonly slug: string;
  readonly stage: string;
  readonly substate: string;
  readonly archived: boolean;
}

describe("skillmaker CLI end-to-end: Phase 2 (journal fold + list/status/reindex)", () => {
  test(
    "init + new a + new b",
    () => {
      expect(runCli(["init", "--json"]).exitCode).toBe(0);
      expect(runCli(["new", "a", "--json"]).exitCode).toBe(0);
      expect(runCli(["new", "b", "--json"]).exitCode).toBe(0);
    },
    20000,
  );

  test(
    "list shows both bundles at idea/working",
    () => {
      const result = runCli(["list", "--json"]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { bundles: ReadonlyArray<BundleView> };
      expect(parsed.bundles.map((b) => b.slug).sort()).toEqual(["a", "b"]);
      for (const bundle of parsed.bundles) {
        expect(bundle.stage).toBe("idea");
        expect(bundle.substate).toBe("working");
        expect(bundle.archived).toBe(false);
      }

      const textResult = runCli(["list"]);
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain("SLUG");
      expect(textResult.stdout).toContain("a");
      expect(textResult.stdout).toContain("b");
    },
    15000,
  );

  test("reindex prints counts and creates studio.db", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      bundles: number;
      events: number;
      warnings: ReadonlyArray<string>;
    };
    expect(parsed.status).toBe("reindexed");
    expect(parsed.bundles).toBe(2);
    expect(parsed.events).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(existsSync(dbPath())).toBe(true);
  });

  test(
    "deleting studio.db and listing again reproduces identical output (rebuildability proof)",
    () => {
      const before = runCli(["list", "--json"]);
      expect(before.exitCode).toBe(0);

      unlinkSync(dbPath());
      expect(existsSync(dbPath())).toBe(false);

      const after = runCli(["list", "--json"]);
      expect(after.exitCode).toBe(0);
      expect(after.stdout).toBe(before.stdout);

      // list always rebuilds, so studio.db exists again afterward.
      expect(existsSync(dbPath())).toBe(true);
    },
    15000,
  );

  test("status a shows event history", () => {
    const result = runCli(["status", "a", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      slug: string;
      stage: string;
      substate: string;
      eventCount: number;
      lastEventType: string | null;
    };
    expect(parsed.slug).toBe("a");
    expect(parsed.stage).toBe("idea");
    expect(parsed.substate).toBe("working");
    expect(parsed.eventCount).toBe(1);
    expect(parsed.lastEventType).toBe("bundle.created");
  });

  test("status on an unknown slug exits 1", () => {
    const result = runCli(["status", "does-not-exist"]);
    expect(result.exitCode).toBe(1);
  });

  test(
    "list on an empty workspace prints a friendly message and exits 0",
    () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase2-empty-"));
      const toolVersions = join(repoRoot, ".tool-versions");
      if (existsSync(toolVersions)) {
        cpSync(toolVersions, join(emptyDir, ".tool-versions"));
      }
      try {
        Bun.spawnSync(["bun", cliEntry, "init"], { cwd: emptyDir });
        const result = Bun.spawnSync(["bun", cliEntry, "list"], {
          cwd: emptyDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString().length).toBeGreaterThan(0);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    },
    15000,
  );
});
