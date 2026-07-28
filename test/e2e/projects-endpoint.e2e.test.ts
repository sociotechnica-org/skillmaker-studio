/**
 * `GET /api/projects` -- the machine-level registry, live (director rulings
 * 2026-07-27). Locked at the HTTP boundary the sidebar uses:
 *   1. The response is an ARRAY of registered projects, each carrying the
 *      URL `slug` for its `/api/projects/:slug/...` routes.
 *   2. Name derives from the project's own skillmaker.config.json at read
 *      time (init defaults it to the directory basename) -- the registry
 *      itself stores only paths.
 *   3. Skills are the project's bundles with slug/stage/oneLiner, in the
 *      server's own stage vocabulary; an archived bundle does not appear.
 *   4. Project-scoped routes resolve through the slug; an unknown slug is
 *      an honest 404.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;
let projectUrl: string;
let projectSlug: string;

interface ProjectsResponse {
  readonly projects: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly path: string;
    readonly ok: boolean;
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

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  baseUrl = server.baseUrl;
  projectUrl = server.projectUrls[0] as string;
  projectSlug = server.projectSlugs[0] as string;

  // Archive the second bundle through the allowlisted event door -- the same
  // path the viewer's own archive action uses, now project-scoped.
  const archived = await fetch(`${projectUrl}/events`, {
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
  test("serves the registered project with its slug, derived name, and skills; archived excluded", async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProjectsResponse;

    // The ARRAY shape is the contract -- one registered project here.
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toHaveLength(1);

    const project = body.projects[0];
    if (project === undefined) throw new Error("unreachable: length asserted above");

    // Slug is the URL identifier the harness computed with core's own rule.
    expect(project.slug).toBe(projectSlug);
    expect(project.ok).toBe(true);

    // Name comes from skillmaker.config.json's `name` (init defaults it to
    // the directory basename) -- derived at read time, never stored in the
    // registry.
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

  test("project-scoped routes resolve through the slug; an unknown slug 404s", async () => {
    const catalog = await fetch(`${projectUrl}/catalog`);
    expect(catalog.status).toBe(200);
    const entries = ((await catalog.json()) as { entries: ReadonlyArray<{ slug: string }> }).entries;
    expect(entries.map((entry) => entry.slug)).toContain("first-skill");

    const missing = await fetch(`${baseUrl}/api/projects/no-such-project/catalog`);
    expect(missing.status).toBe(404);
  });
});
