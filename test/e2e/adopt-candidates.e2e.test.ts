/**
 * E2e for `GET /api/adopt/candidates` -- the new-skill launcher's "Import
 * one of these?" rows. Exposes the SAME read-only discovery sweep
 * `adopt --triage` runs (core's `walk`, issue #92), workspace-clamped by
 * construction: it only ever walks the server's own root.
 *
 * Locked at the HTTP boundary:
 *   1. Not-yet-adopted SKILL.md files are listed with project-relative
 *      paths and provisional slugs; discovery writes NOTHING.
 *   2. Adopting a candidate removes it from the next listing (bundle.json
 *      now sits next to it).
 *   3. POST is refused (405) -- the endpoint is read-only.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

type CandidatesResponse = {
  candidates: ReadonlyArray<{ path: string; slug: string }>;
};

const listCandidates = async (): Promise<CandidatesResponse> => {
  const response = await fetch(`${baseUrl}/api/adopt/candidates`);
  expect(response.status).toBe(200);
  return (await response.json()) as CandidatesResponse;
};

const writeSkill = (relativeDir: string, name: string): void => {
  const dir = join(scratchDir, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`);
};

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-adopt-candidates-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
  expect(Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: scratchDir }).exitCode).toBe(0);

  writeSkill(join("imported", "release-notes"), "Release Notes");
  writeSkill(join("docs", "standup-summarizer"), "Standup Summarizer");

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

describe("GET /api/adopt/candidates", () => {
  test("lists not-yet-adopted SKILL.md files with provisional slugs, writing nothing", async () => {
    const { candidates } = await listCandidates();
    expect(candidates).toEqual([
      { path: join("docs", "standup-summarizer", "SKILL.md"), slug: "standup-summarizer" },
      { path: join("imported", "release-notes", "SKILL.md"), slug: "release-notes" },
    ]);

    // Read-only: discovery stamped nothing.
    expect(existsSync(join(scratchDir, "imported", "release-notes", "bundle.json"))).toBe(false);
    expect(existsSync(join(scratchDir, "docs", "standup-summarizer", "bundle.json"))).toBe(false);
  });

  test("an adopted candidate drops out of the next listing", async () => {
    const adopt = await fetch(`${baseUrl}/api/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "imported/release-notes/SKILL.md" }),
    });
    expect(adopt.status).toBe(200);

    const { candidates } = await listCandidates();
    expect(candidates.map((candidate) => candidate.slug)).toEqual(["standup-summarizer"]);
  });

  test("POST is refused -- the endpoint is read-only", async () => {
    const response = await fetch(`${baseUrl}/api/adopt/candidates`, { method: "POST" });
    expect(response.status).toBe(405);
  });
});
