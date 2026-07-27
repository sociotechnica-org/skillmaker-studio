/**
 * The machine-registry endpoints (director rulings 2026-07-27): registering
 * projects at runtime (`POST /api/projects` with create/init), unregistering
 * (`DELETE /api/projects/:slug` -- never touches the directory), broken
 * project reporting, the CLI registry commands, and the server-side disk
 * browser behind the New-project dialog (`/api/fs/list|validate|mkdir` --
 * absolute paths only, directories only).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchRoot: string;
let firstWorkspace: string;
let home: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const initWorkspace = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: dir });
  expect(Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: dir }).exitCode).toBe(0);
};

const listProjects = async (): Promise<
  ReadonlyArray<{ slug: string; name: string; ok: boolean; error?: string; absolutePath: string }>
> => {
  const response = await fetch(`${baseUrl}/api/projects`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { projects: ReadonlyArray<never> }).projects;
};

beforeAll(async () => {
  scratchRoot = mkdtempSync(join(tmpdir(), "skillmaker-e2e-registry-"));
  firstWorkspace = join(scratchRoot, "first-project");
  initWorkspace(firstWorkspace);

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: firstWorkspace,
    projects: [firstWorkspace],
  });
  serverProcess = server.process;
  baseUrl = server.baseUrl;
  home = server.home;
}, 60000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  if (scratchRoot !== undefined) {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
  if (home !== undefined) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("POST /api/projects", () => {
  test("registers an existing workspace and serves its routes immediately", async () => {
    const second = join(scratchRoot, "second-project");
    initWorkspace(second);

    const response = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: second }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { status: string; project: { slug: string } | null };
    expect(body.status).toBe("registered");
    expect(body.project?.slug).toBe("second-project");

    // Project-scoped routes work without a restart.
    const catalog = await fetch(`${baseUrl}/api/projects/second-project/catalog`);
    expect(catalog.status).toBe(200);
  });

  test("a directory that is not a workspace 409s needs_init without init: true, scaffolds with it", async () => {
    const bare = join(scratchRoot, "bare-directory");
    mkdirSync(bare);

    const refused = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: bare }),
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { status: string }).status).toBe("needs_init");
    // The refusal wrote nothing.
    expect(existsSync(join(bare, "skillmaker.config.json"))).toBe(false);

    const scaffolded = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: bare, init: true }),
    });
    expect(scaffolded.status).toBe(201);
    const body = (await scaffolded.json()) as { status: string; initialized: boolean };
    expect(body.status).toBe("registered");
    expect(body.initialized).toBe(true);
    // The default workspace scaffold landed in the directory itself.
    expect(existsSync(join(bare, "skillmaker.config.json"))).toBe(true);
    expect(existsSync(join(bare, ".skillmaker", "events.jsonl"))).toBe(true);
  });

  test("create: true makes the directory first (parent must exist); relative paths are refused", async () => {
    const fresh = join(scratchRoot, "brand-new-project");
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fresh, create: true, init: true }),
    });
    expect(created.status).toBe(201);
    expect(existsSync(join(fresh, "skillmaker.config.json"))).toBe(true);

    const relative = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "relative/somewhere", create: true }),
    });
    expect(relative.status).toBe(400);

    const orphan = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(scratchRoot, "missing-parent", "child"), create: true }),
    });
    expect(orphan.status).toBe(400);
  });
});

describe("DELETE /api/projects/:slug", () => {
  test("unregisters without touching the directory", async () => {
    const doomed = join(scratchRoot, "doomed-project");
    initWorkspace(doomed);
    const registered = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: doomed }),
    });
    expect(registered.status).toBe(201);

    const removed = await fetch(`${baseUrl}/api/projects/doomed-project`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { status: string }).status).toBe("removed");

    // Gone from the registry, but the directory and its data survive.
    const projects = await listProjects();
    expect(projects.map((p) => p.slug)).not.toContain("doomed-project");
    expect(existsSync(join(doomed, "skillmaker.config.json"))).toBe(true);

    const missing = await fetch(`${baseUrl}/api/projects/doomed-project`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });
});

describe("broken projects", () => {
  test("a registered directory that vanished is reported, never crashed over", async () => {
    const ghost = join(scratchRoot, "ghost-project");
    initWorkspace(ghost);
    const registered = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: ghost }),
    });
    expect(registered.status).toBe(201);

    rmSync(ghost, { recursive: true, force: true });
    // Trigger a registry reconcile via a mutation (any add/remove refreshes).
    const probe = join(scratchRoot, "probe-project");
    initWorkspace(probe);
    await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: probe }),
    });

    const projects = await listProjects();
    const ghostRow = projects.find((p) => p.slug === "ghost-project");
    expect(ghostRow?.ok).toBe(false);
    expect(ghostRow?.error).toContain("does not exist");

    // Its project-scoped routes answer 503, not a crash.
    const scoped = await fetch(`${baseUrl}/api/projects/ghost-project/catalog`);
    expect(scoped.status).toBe(503);
  });
});

describe("fs browse endpoints", () => {
  test("list returns directories only, flags projects, refuses relative paths", async () => {
    writeFileSync(join(scratchRoot, "a-file.txt"), "not a directory");
    const response = await fetch(`${baseUrl}/api/fs/list?path=${encodeURIComponent(scratchRoot)}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string;
      dirs: ReadonlyArray<{ name: string; isProject: boolean }>;
    };
    const names = body.dirs.map((d) => d.name);
    expect(names).toContain("first-project");
    expect(names).not.toContain("a-file.txt"); // files are never listed
    expect(body.dirs.find((d) => d.name === "first-project")?.isProject).toBe(true);

    const relative = await fetch(`${baseUrl}/api/fs/list?path=not-absolute`);
    expect(relative.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/fs/list?path=${encodeURIComponent(join(scratchRoot, "nope"))}`);
    expect(missing.status).toBe(404);
  });

  test("validate distinguishes project / plain dir / missing-but-creatable", async () => {
    const project = await fetch(`${baseUrl}/api/fs/validate?path=${encodeURIComponent(firstWorkspace)}`);
    const projectBody = (await project.json()) as { valid: boolean; isProject: boolean };
    expect(projectBody.valid).toBe(true);
    expect(projectBody.isProject).toBe(true);

    const missingPath = join(scratchRoot, "does-not-exist-yet");
    const missing = await fetch(`${baseUrl}/api/fs/validate?path=${encodeURIComponent(missingPath)}`);
    const missingBody = (await missing.json()) as { valid: boolean; creatable?: boolean };
    expect(missingBody.valid).toBe(false);
    expect(missingBody.creatable).toBe(true);
  });

  test("mkdir creates one level, requires the parent, refuses repeats", async () => {
    const target = join(scratchRoot, "made-by-dialog");
    const created = await fetch(`${baseUrl}/api/fs/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target }),
    });
    expect(created.status).toBe(201);
    expect(existsSync(target)).toBe(true);

    const repeat = await fetch(`${baseUrl}/api/fs/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target }),
    });
    expect(repeat.status).toBe(409);

    const orphan = await fetch(`${baseUrl}/api/fs/mkdir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(scratchRoot, "no-parent", "child") }),
    });
    expect(orphan.status).toBe(400);
  });
});

describe("skillmaker project CLI", () => {
  test("add/list/remove against an isolated home", () => {
    const cliHome = mkdtempSync(join(tmpdir(), "skillmaker-e2e-cli-home-"));
    const env = { ...process.env, SKILLMAKER_STUDIO_HOME: cliHome };

    const added = Bun.spawnSync(["bun", cliEntry, "project", "add", firstWorkspace, "--json"], {
      cwd: scratchRoot,
      env,
    });
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout.toString()) as { status: string }).toEqual({
      status: "added",
      path: firstWorkspace,
    });

    // A non-workspace directory is refused with a pointer to `init`.
    const bare = join(scratchRoot, "cli-bare");
    mkdirSync(bare, { recursive: true });
    const refused = Bun.spawnSync(["bun", cliEntry, "project", "add", bare], { cwd: scratchRoot, env });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain("skillmaker init");

    const listed = Bun.spawnSync(["bun", cliEntry, "project", "list", "--json"], { cwd: scratchRoot, env });
    expect(listed.exitCode).toBe(0);
    const listBody = JSON.parse(listed.stdout.toString()) as {
      projects: ReadonlyArray<{ slug: string; path: string; ok: boolean }>;
    };
    expect(listBody.projects).toHaveLength(1);
    expect(listBody.projects[0]?.path).toBe(firstWorkspace);
    expect(listBody.projects[0]?.ok).toBe(true);

    const removed = Bun.spawnSync(["bun", cliEntry, "project", "remove", firstWorkspace, "--json"], {
      cwd: scratchRoot,
      env,
    });
    expect(removed.exitCode).toBe(0);
    expect((JSON.parse(removed.stdout.toString()) as { status: string }).status).toBe("removed");
    // The workspace directory is untouched.
    expect(existsSync(join(firstWorkspace, "skillmaker.config.json"))).toBe(true);

    const registryFile = JSON.parse(readFileSync(join(cliHome, "config.json"), "utf8")) as {
      projects: ReadonlyArray<unknown>;
    };
    expect(registryFile.projects).toHaveLength(0);

    rmSync(cliHome, { recursive: true, force: true });
  });
});
