/**
 * End-to-end regression: Story 3 friction log F4 -- `adopt` had no way to
 * record WHERE an in-place-adopted skill actually came from (a skills repo
 * URL, a local path snapshot, etc.), so `status` could never answer "is
 * this skill still current with its source?" (full drift-vs-upstream
 * comparison is explicitly out of scope / future work -- this fix only
 * records the provenance).
 *
 * Covers the full CLI flow end to end:
 *  1. `adopt --source <url> --ref <ref>` stamps upstream provenance on every
 *     skill adopted in that batch, both in `adopt --json`'s own output and
 *     (more importantly, since that's what persists) in `status <slug>`
 *     afterwards -- both `--json` and text modes.
 *  2. `adopt` with no `--source` leaves `status` showing no upstream info
 *     at all (omitted key in JSON, no `upstream:` line in text) -- adopting
 *     is not required to claim a source.
 *  3. The SQLite index round-trip: `status` rebuilds the index from disk
 *     before reading (`Status.ts`), so this also exercises
 *     `IndexService.ts`'s `upstream_json` column end to end (marker on
 *     disk -> rebuild() -> SQLite -> BundleRecord.upstream -> CLI output),
 *     not just the marker file itself.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const write = (relativePath: string, content: string): void => {
  const full = join(scratchDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

const skillMd = (name: string): string =>
  `---\nname: ${name}\ndescription: A test skill.\n---\n\n# ${name}\n\nDoes a thing.\n`;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase20-story3-fix4-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("Fix F4: adopt --source / --ref upstream provenance surfaces through status", () => {
  test("adopt --source --ref stamps upstream, and status --json shows it after an index rebuild", () => {
    write("imported/from-repo/SKILL.md", skillMd("from-repo"));

    const adopt = runCli([
      "adopt",
      "imported/from-repo",
      "--source",
      "https://github.com/example/skills-repo",
      "--ref",
      "v1.2.3",
      "--json",
    ]);
    expect(adopt.exitCode).toBe(0);
    const adoptJson = JSON.parse(adopt.stdout) as {
      adopted: ReadonlyArray<{ slug: string }>;
      upstream?: { source: string; ref: string | null };
    };
    expect(adoptJson.adopted).toHaveLength(1);
    expect(adoptJson.upstream).toEqual({ source: "https://github.com/example/skills-repo", ref: "v1.2.3" });
    const slug = adoptJson.adopted[0]!.slug;

    const status = runCli(["status", slug, "--json"]);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout) as {
      upstream: { source: string; ref: string | null; importedAt: string } | null;
    };
    expect(statusJson.upstream).not.toBeNull();
    expect(statusJson.upstream?.source).toBe("https://github.com/example/skills-repo");
    expect(statusJson.upstream?.ref).toBe("v1.2.3");
    expect(statusJson.upstream?.importedAt).toBeDefined();

    const statusText = runCli(["status", slug]);
    expect(statusText.exitCode).toBe(0);
    expect(statusText.stdout).toContain(
      `upstream:    https://github.com/example/skills-repo @ v1.2.3 (imported ${statusJson.upstream?.importedAt})`,
    );
  });

  test("adopt --source (no --ref) stamps upstream with ref omitted", () => {
    write("imported/no-ref/SKILL.md", skillMd("no-ref"));

    const adopt = runCli(["adopt", "imported/no-ref", "--source", "/local/path/to/skills-repo", "--json"]);
    expect(adopt.exitCode).toBe(0);
    const adoptJson = JSON.parse(adopt.stdout) as { adopted: ReadonlyArray<{ slug: string }> };
    const slug = adoptJson.adopted[0]!.slug;

    const status = runCli(["status", slug, "--json"]);
    const statusJson = JSON.parse(status.stdout) as {
      upstream: { source: string; ref: string | null; importedAt: string } | null;
    };
    expect(statusJson.upstream?.source).toBe("/local/path/to/skills-repo");
    expect(statusJson.upstream?.ref).toBeNull();

    const statusText = runCli(["status", slug]);
    expect(statusText.stdout).toContain("upstream:    /local/path/to/skills-repo (imported");
    expect(statusText.stdout).not.toContain("@ ");
  });

  test("adopt with no --source leaves status showing no upstream info at all", () => {
    write("imported/plain/SKILL.md", skillMd("plain"));

    const adopt = runCli(["adopt", "imported/plain", "--json"]);
    expect(adopt.exitCode).toBe(0);
    const adoptJson = JSON.parse(adopt.stdout) as {
      adopted: ReadonlyArray<{ slug: string }>;
      upstream?: unknown;
    };
    expect(adoptJson.upstream).toBeUndefined();
    const slug = adoptJson.adopted[0]!.slug;

    const status = runCli(["status", slug, "--json"]);
    const statusJson = JSON.parse(status.stdout) as { upstream: unknown };
    expect(statusJson.upstream).toBeNull();

    const statusText = runCli(["status", slug]);
    expect(statusText.stdout).not.toContain("upstream:");
  });
});
