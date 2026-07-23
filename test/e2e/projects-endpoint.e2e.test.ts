/**
 * `GET /api/projects` -- the next shell's sidebar Projects source. Today the
 * server serves exactly ONE project (the workspace it is running for); the
 * machine-level registry (IA doc §A, `~/.skillmaker`) lands later. Locked at
 * the HTTP boundary the sidebar uses:
 *   1. The response is an ARRAY of projects (the registry-proof shape) with
 *      one element: the workspace's name and root path.
 *   2. Skills are the workspace's bundles with slug/stage/oneLiner, in the
 *      server's own stage vocabulary.
 *   3. An archived bundle does not appear.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

interface ProjectsResponse {
  readonly projects: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly skills: ReadonlyArray<{ readonly slug: string; readonly stage: string; readonly oneLiner: string }>;
  }>;
}

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-projects-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
  expect(Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: scratchDir }).exitCode).toBe(0);
  expect(Bun.spawnSync(["bun", cliEntry, "new", "first-skill", "--json"], { cwd: scratchDir }).exitCode).toBe(0);
  expect(Bun.spawnSync(["bun", cliEntry, "new", "shelved-skill", "--json"], { cwd: scratchDir }).exitCode).toBe(0);

  const server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  baseUrl = server.baseUrl;

  // Archive the second bundle through the allowlisted event door -- the same
  // path the viewer's own archive action uses.
  const archived = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "bundle.archived", payload: { bundle: "shelved-skill" } }),
  });
  expect(archived.status).toBe(200);
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

describe("GET /api/projects", () => {
  test("serves the workspace as the one project, skills included, archived excluded", async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProjectsResponse;

    // The ARRAY shape is the contract -- one element today.
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toHaveLength(1);

    const project = body.projects[0];
    if (project === undefined) throw new Error("unreachable: length asserted above");

    // Name comes from skillmaker.config.json's `name` (init defaults it to
    // the directory basename).
    const config = JSON.parse(readFileSync(join(scratchDir, "skillmaker.config.json"), "utf8")) as {
      name: string;
    };
    expect(project.name).toBe(config.name);

    // Path is the workspace root; the macOS temp dir is not under $HOME, so
    // no `~` shortening applies here -- it must still end with the scratch
    // dir's basename (realpath vs /private prefix tolerated).
    expect(project.path.endsWith(basename(scratchDir))).toBe(true);

    // Skills: the live bundle with stage + one-liner; the archived one gone.
    const slugs = project.skills.map((skill) => skill.slug);
    expect(slugs).toContain("first-skill");
    expect(slugs).not.toContain("shelved-skill");
    const first = project.skills.find((skill) => skill.slug === "first-skill");
    expect(first?.stage).toBe("idea");
    expect(typeof first?.oneLiner).toBe("string");
  });
});
