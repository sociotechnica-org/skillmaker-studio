/**
 * Regression e2e for the board's "+ New bundle" affordance: a human could
 * make todos from the viewer but not bundles -- creation was terminal-only
 * (`skillmaker new`), because `POST /api/events` deliberately excludes
 * `bundle.created`. `POST /api/bundles` closes that gap by reusing the SAME
 * `Workspace.createBundle` the CLI calls, then journaling `bundle.created`.
 *
 * Locked at the HTTP boundary the create form uses:
 *   1. POST scaffolds a real bundle in the idea stage (201) and journals it.
 *   2. A duplicate is reported, not double-created (200 already_exists).
 *   3. An invalid slug is rejected (400 invalid_slug), nothing scaffolded.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

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

const createBundle = (payload: unknown): Promise<Response> =>
  fetch(`${baseUrl}/api/bundles`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const journalHasBundleCreated = (slug: string): boolean =>
  readFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payload: { bundle?: string } })
    .some((event) => event.type === "bundle.created" && event.payload.bundle === slug);

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-create-bundle-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
  expect(Bun.spawnSync(["bun", cliEntry, "init", "--json"], { cwd: scratchDir }).exitCode).toBe(0);

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

describe("POST /api/bundles", () => {
  test("scaffolds a new bundle in the idea stage and journals bundle.created", async () => {
    const response = await createBundle({ slug: "my-first-skill", name: "My First Skill" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "created", slug: "my-first-skill" });

    // A full scaffold on disk, same as `skillmaker new`.
    const bundleDir = join(scratchDir, "skills", "my-first-skill");
    expect(existsSync(join(bundleDir, "bundle.json"))).toBe(true);
    expect(existsSync(join(bundleDir, "design.md"))).toBe(true);
    expect(existsSync(join(bundleDir, "stations.json"))).toBe(true);
    expect(journalHasBundleCreated("my-first-skill")).toBe(true);

    // It shows on the board in the idea stage.
    const list = (await (await fetch(`${baseUrl}/api/bundles`)).json()) as {
      bundles: ReadonlyArray<{ slug: string; stage: string }>;
    };
    expect(list.bundles.find((b) => b.slug === "my-first-skill")?.stage).toBe("idea");
  });

  test("a duplicate is reported, not double-created", async () => {
    const response = await createBundle({ slug: "my-first-skill" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_exists", slug: "my-first-skill" });
  });

  test("an invalid slug is rejected and nothing is scaffolded", async () => {
    const response = await createBundle({ slug: "Not A Slug" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { status: string }).status).toBe("invalid_slug");
    expect(existsSync(join(scratchDir, "skills", "Not A Slug"))).toBe(false);
  });

  test("a missing slug is a 400", async () => {
    const response = await createBundle({ name: "no slug here" });
    expect(response.status).toBe(400);
  });
});
