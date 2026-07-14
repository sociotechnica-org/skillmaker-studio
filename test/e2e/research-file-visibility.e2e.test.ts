/**
 * Regression e2e for the reviewer-can't-see-the-artifact gap: a researching
 * station writes `research/notes.md` and requests review, but the viewer had
 * no way to show it -- the file endpoint's allowlist served `design.md` and
 * `output/` only, and the Files-tab list was a hardcoded two-path constant.
 *
 * This locks the fix at the HTTP boundary the viewer actually uses:
 *   1. `GET /api/bundles/:slug/file?path=research/...` now serves (was 404).
 *   2. `GET /api/bundles/:slug` carries a `files` list enumerating the
 *      bundle's reviewable sources (design.md + research/* + output/*),
 *      pipeline-ordered, with scaffolding dotfiles dropped.
 *   3. The traversal guard the allowlist exists for still holds.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string = scratchDir) =>
  Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });

const waitForHealth = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server never became healthy at ${url}: ${String(lastError)}`);
};

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-research-vis-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);

  const bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nIntent.\n");
  mkdirSync(join(bundleDir, "research"), { recursive: true });
  writeFileSync(join(bundleDir, "research", "notes.md"), "# Research Notes\n\nThe cited findings.\n");
  // A scaffolding dotfile that must NOT surface in the reviewable file list.
  writeFileSync(join(bundleDir, "research", ".gitkeep"), "");
  mkdirSync(join(bundleDir, "output"), { recursive: true });
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "---\nname: demo-skill\n---\n\nDo the thing.\n");

  const port = 21000 + Math.floor(Math.random() * 8000);
  baseUrl = `http://localhost:${port}`;
  serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForHealth(baseUrl, 30000);
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

describe("research file visibility over HTTP", () => {
  test("the file endpoint serves research/notes.md (the allowlist regression)", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/demo-skill/file?path=research/notes.md`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; content: string };
    expect(body.path).toBe("research/notes.md");
    expect(body.content).toContain("The cited findings.");
  });

  test("the detail payload lists the reviewable files, pipeline-ordered, dotfiles dropped", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/demo-skill`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: ReadonlyArray<string> };
    expect(body.files).toEqual(["design.md", "research/notes.md", "output/SKILL.md"]);
    expect(body.files).not.toContain("research/.gitkeep");
  });

  test("the traversal guard the allowlist exists for still holds", async () => {
    for (const path of ["research/../../design.md", "../../../etc/passwd", "runs/x/../../../secret"]) {
      const response = await fetch(`${baseUrl}/api/bundles/demo-skill/file?path=${encodeURIComponent(path)}`);
      expect(response.status).toBe(404);
    }
  });
});
