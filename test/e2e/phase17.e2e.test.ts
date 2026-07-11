/**
 * End-to-end: Phase 17's two new endpoints -- `GET /api/events` (the
 * Activity page's paginated journal feed) and `GET /api/catalog` (the
 * Catalog page's skill-browser rows). Spawns the real `skillmaker start`
 * server against a fresh workspace, same harness as phase3/phase9.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let bundleDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const waitForHealth = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server never became healthy at ${url}: ${String(lastError)}`);
};

interface EventsPage {
  readonly events: ReadonlyArray<{ readonly id: string; readonly type: string }>;
  readonly nextCursor: string | null;
}

interface CatalogRow {
  readonly slug: string;
  readonly name: string;
  readonly stage: string;
  readonly drift: string;
  readonly latestVersion: { readonly hash: string } | null;
  readonly fixtureCount: number;
  readonly measuredFixtureCount: number;
}

beforeAll(async () => {
  if (!existsSync(join(viewerDist, "index.html"))) {
    const build = Bun.spawnSync(["bun", "run", "--filter", "@skillmaker/viewer", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) {
      throw new Error("packages/viewer failed to build in test setup");
    }
  }

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase17-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "alpha", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "beta", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "alpha");
  expect(runCli(["fixture", "add", "alpha", "golden-basic", "--json"], scratchDir).exitCode).toBe(0);
  writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");
  expect(runCli(["version", "record", "alpha", "--json"], scratchDir).exitCode).toBe(0);

  const port = 20000 + Math.floor(Math.random() * 20000);
  baseUrl = `http://localhost:${port}`;
  serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForHealth(baseUrl, 15000);
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

describe("phase 17: GET /api/events", () => {
  test("defaults to the most recent events, newest first", async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as EventsPage;
    expect(body.events.length).toBeGreaterThan(0);
    const times = body.events.map((event) => (event as unknown as { at: string }).at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  test("limit is honored and paginates via nextCursor/before", async () => {
    const firstPage = await fetch(`${baseUrl}/api/events?limit=2`);
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as EventsPage;
    expect(firstBody.events.length).toBe(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const secondPage = await fetch(
      `${baseUrl}/api/events?limit=2&before=${encodeURIComponent(String(firstBody.nextCursor))}`,
    );
    expect(secondPage.status).toBe(200);
    const secondBody = (await secondPage.json()) as EventsPage;
    expect(secondBody.events.length).toBeGreaterThan(0);

    const firstIds = new Set(firstBody.events.map((event) => event.id));
    for (const event of secondBody.events) {
      expect(firstIds.has(event.id)).toBe(false);
    }
  });

  test("an unknown before cursor is a 400", async () => {
    const response = await fetch(`${baseUrl}/api/events?before=no-such-event`);
    expect(response.status).toBe(400);
  });

  test("a non-positive-integer limit is a 400", async () => {
    for (const limit of ["0", "-1", "abc"]) {
      const response = await fetch(`${baseUrl}/api/events?limit=${encodeURIComponent(limit)}`);
      expect(response.status).toBe(400);
    }
  });

  test("limit is capped at the max page size", async () => {
    const response = await fetch(`${baseUrl}/api/events?limit=100000`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as EventsPage;
    expect(body.events.length).toBeLessThanOrEqual(200);
  });
});

describe("phase 17: GET /api/catalog", () => {
  test("returns one row per bundle with the skill-browser fields", async () => {
    const response = await fetch(`${baseUrl}/api/catalog`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: ReadonlyArray<CatalogRow> };
    expect(body.entries.map((entry) => entry.slug).sort()).toEqual(["alpha", "beta"]);

    const alpha = body.entries.find((entry) => entry.slug === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.name).toBeDefined();
    expect(alpha?.stage).toBe("idea");
    expect(alpha?.latestVersion).not.toBeNull();
    expect(alpha?.fixtureCount).toBe(1);
    // Nothing has been measured yet at the recorded version.
    expect(alpha?.measuredFixtureCount).toBe(0);

    const beta = body.entries.find((entry) => entry.slug === "beta");
    expect(beta?.latestVersion).toBeNull();
    expect(beta?.drift).toBe("no-version");
  });
});
