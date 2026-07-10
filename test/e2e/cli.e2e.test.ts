/**
 * End-to-end: spawns the real `skillmaker` CLI (not the in-process Effect
 * program) against a fresh, git-initialized scratch directory, and drives it
 * through `init` -> `new` -> re-run of both, asserting on the filesystem and
 * on stdout, exactly as a user invoking the binary would see it
 * (plan.md Phase 1 verify criteria).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-"));
  // asdf/mise resolve `bun` via .tool-versions; scratch dirs outside the repo
  // don't inherit it, so copy it in.
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

const journalPath = () => join(scratchDir, ".skillmaker", "events.jsonl");

const journalLines = (): ReadonlyArray<string> =>
  readFileSync(journalPath(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

describe("skillmaker CLI end-to-end", () => {
  test("init scaffolds a workspace", () => {
    const result = runCli(["init", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; root: string };
    expect(parsed.status).toBe("initialized");

    expect(existsSync(join(scratchDir, "skillmaker.config.json"))).toBe(true);
    expect(existsSync(journalPath())).toBe(true);
    expect(existsSync(join(scratchDir, "skills"))).toBe(true);

    const gitignore = readFileSync(join(scratchDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".skillmaker/*");

    const gitattributes = readFileSync(join(scratchDir, ".gitattributes"), "utf8");
    expect(gitattributes).toContain(".skillmaker/events.jsonl merge=union");
  });

  test("new my-first-skill scaffolds a bundle and journals its creation", () => {
    const result = runCli(["new", "my-first-skill", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; slug: string };
    expect(parsed.status).toBe("created");
    expect(parsed.slug).toBe("my-first-skill");

    const bundleDir = join(scratchDir, "skills", "my-first-skill");
    expect(existsSync(join(bundleDir, "bundle.json"))).toBe(true);
    expect(existsSync(join(bundleDir, "stations.json"))).toBe(true);
    expect(existsSync(join(bundleDir, "design.md"))).toBe(true);
    for (const relative of ["research", "evals/fixtures", "output", "runs"]) {
      expect(existsSync(join(bundleDir, relative, ".gitkeep"))).toBe(true);
    }

    const lines = journalLines();
    expect(lines.length).toBe(1);
    const event = JSON.parse(lines[0] as string) as { type: string; payload: unknown };
    expect(event.type).toBe("bundle.created");
    expect(event.payload).toEqual({ bundle: "my-first-skill" });
  });

  test("re-running init is a zero-file-change no-op", () => {
    const before = readFileSync(join(scratchDir, "skillmaker.config.json"), "utf8");
    const beforeGitignore = readFileSync(join(scratchDir, ".gitignore"), "utf8");

    const result = runCli(["init", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe("already_initialized");

    const after = readFileSync(join(scratchDir, "skillmaker.config.json"), "utf8");
    const afterGitignore = readFileSync(join(scratchDir, ".gitignore"), "utf8");
    expect(after).toBe(before);
    expect(afterGitignore).toBe(beforeGitignore);
  });

  test("re-running new is a no-op: no duplicate journal event", () => {
    const result = runCli(["new", "my-first-skill", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe("already_exists");

    const lines = journalLines();
    expect(lines.length).toBe(1);
  });

  test("new rejects an invalid slug with a usage error", () => {
    const result = runCli(["new", "Not_A_Slug"]);
    expect(result.exitCode).toBe(2);
  });

  test("new fails cleanly outside a workspace", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-outside-"));
    const toolVersions = join(repoRoot, ".tool-versions");
    if (existsSync(toolVersions)) {
      cpSync(toolVersions, join(outsideDir, ".tool-versions"));
    }
    try {
      const result = Bun.spawnSync(["bun", cliEntry, "new", "some-skill"], {
        cwd: outsideDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(1);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
