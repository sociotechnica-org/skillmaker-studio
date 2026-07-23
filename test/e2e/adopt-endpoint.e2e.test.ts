/**
 * E2e for `POST /api/adopt` -- the shell's "Import existing SKILL.md" door.
 * Adoption was terminal-only (`skillmaker adopt`); this endpoint reuses the
 * SAME core pipeline (registry tripwire + `adoptWorkspace` + the identical
 * journal writes) so the viewer can import in place. v1 scope (D1/D2):
 * single-path, in-place adopt -- no dock machinery.
 *
 * Locked at the HTTP boundary:
 *   1. POST with a project-relative SKILL.md path adopts it in place (200),
 *      journals bundle.created + skill.version_recorded, and the bundle
 *      shows up in GET /api/bundles.
 *   2. A re-run reports skipped (already adopted), adopts nothing.
 *   3. A path outside the workspace is refused (400), a missing path is a
 *      404, and a non-SKILL.md file is a 400 -- honest errors, no writes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const adopt = (payload: unknown): Promise<Response> =>
  fetch(`${baseUrl}/api/adopt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const journalEvents = (): ReadonlyArray<{ type: string; payload: { bundle?: string } }> =>
  readFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payload: { bundle?: string } });

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-adopt-endpoint-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
  expect(Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: scratchDir }).exitCode).toBe(0);

  // A pre-existing, not-yet-adopted skill directory inside the project.
  const skillDir = join(scratchDir, "imported", "release-notes");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: Release Notes\ndescription: Writes release notes from a changelog.\n---\n\n# Release Notes\n",
  );

  const server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  baseUrl = server.baseUrl;
}, 60000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("POST /api/adopt", () => {
  test("adopts a project-relative SKILL.md in place and journals it, same as `skillmaker adopt`", async () => {
    const response = await adopt({ path: "imported/release-notes/SKILL.md" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      found: number;
      adopted: ReadonlyArray<{ slug: string; path: string }>;
      skipped: ReadonlyArray<unknown>;
    };
    expect(report.adopted.map((skill) => skill.slug)).toEqual(["release-notes"]);

    // Wrapped IN PLACE: bundle.json + adopt marker live in the skill's own
    // directory, not under skills/<slug>.
    const skillDir = join(scratchDir, "imported", "release-notes");
    expect(existsSync(join(skillDir, "bundle.json"))).toBe(true);
    expect(existsSync(join(skillDir, ".skillmaker-adopt.json"))).toBe(true);
    expect(existsSync(join(scratchDir, "skills", "release-notes"))).toBe(false);

    // The same journal writes the CLI's adopt performs.
    const events = journalEvents();
    expect(
      events.some((e) => e.type === "bundle.created" && e.payload.bundle === "release-notes"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "skill.version_recorded" && e.payload.bundle === "release-notes"),
    ).toBe(true);

    // And it is now a first-class bundle on the board.
    const list = (await (await fetch(`${baseUrl}/api/bundles`)).json()) as {
      bundles: ReadonlyArray<{ slug: string; stage: string }>;
    };
    expect(list.bundles.find((b) => b.slug === "release-notes")?.stage).toBe("idea");
  });

  test("a re-run reports skipped (already adopted) and adopts nothing", async () => {
    const response = await adopt({ path: "imported/release-notes" });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      adopted: ReadonlyArray<unknown>;
      skipped: ReadonlyArray<{ reason: string }>;
    };
    expect(report.adopted).toEqual([]);
    expect(report.skipped.map((s) => s.reason)).toEqual(["already-adopted"]);
  });

  test("a path outside the workspace is refused -- adopt only scans inside the project", async () => {
    const response = await adopt({ path: "../elsewhere" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("outside the workspace");
  });

  test("a missing path is a 404", async () => {
    const response = await adopt({ path: "no/such/dir" });
    expect(response.status).toBe(404);
  });

  test("a file that is not a SKILL.md is a 400", async () => {
    const response = await adopt({ path: "skillmaker.config.json" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("not a SKILL.md");
  });

  test("a non-string path is a 400", async () => {
    const response = await adopt({ path: 42 });
    expect(response.status).toBe(400);
  });
});
