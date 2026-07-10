/**
 * End-to-end: builds the viewer once (or reuses an existing `dist/`),
 * spawns the real `skillmaker` CLI's `start` command against a fresh
 * workspace, and drives it exactly as a user/browser would -- HTTP against
 * a real Bun.serve instance, not the in-process Effect program
 * (plan.md Phase 3 verify criteria).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let port: number;
let baseUrl: string;

const copyToolVersions = (dir: string) => {
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(dir, ".tool-versions"));
  }
};

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

const claimPath = () => join(scratchDir, ".skillmaker", "claims", "server.json");

beforeAll(async () => {
  // Build the viewer once (cached across runs -- `dist/` is gitignored but
  // this speeds up repeat local test runs and CI reruns within the same
  // checkout).
  if (!existsSync(join(viewerDist, "index.html"))) {
    const build = Bun.spawnSync(["bun", "run", "--filter", "@skillmaker/viewer", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) {
      throw new Error(
        "packages/viewer failed to build in test setup -- run `bun run build:viewer` manually to see the error",
      );
    }
  }

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase3-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "alpha", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "beta", "--json"], scratchDir).exitCode).toBe(0);

  port = 20000 + Math.floor(Math.random() * 20000);
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

interface BundleView {
  readonly slug: string;
  readonly stage: string;
  readonly substate: string;
  readonly archived: boolean;
}

describe("skillmaker CLI end-to-end: Phase 3 (start + viewer skeleton)", () => {
  test("GET /api/health reports ok", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
  });

  test("GET /api/bundles matches `list --json`", async () => {
    const response = await fetch(`${baseUrl}/api/bundles`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { bundles: ReadonlyArray<BundleView> };
    expect(body.bundles.map((b) => b.slug).sort()).toEqual(["alpha", "beta"]);

    const cliList = runCli(["list", "--json"], scratchDir);
    expect(cliList.exitCode).toBe(0);
    const cliBundles = (JSON.parse(cliList.stdout) as { bundles: ReadonlyArray<BundleView> }).bundles;
    expect(body.bundles).toEqual(cliBundles);
  });

  test("GET / serves the viewer HTML with the app mount", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("id=\"app-root\"");
    expect(html).toContain("Skillmaker Studio");
  });

  test("a client-routed path falls back to the SPA shell", async () => {
    const response = await fetch(`${baseUrl}/some/client/route`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("id=\"app-root\"");
  });

  test("path traversal via the encoded-slash bypass is rejected with 404", async () => {
    // A literal "/../etc/passwd" is collapsed by the HTTP client itself
    // before the request is ever sent (WHATWG URL dot-segment
    // normalization applies to "%2e%2e" too), so it never reaches the
    // server as a traversal attempt. The encoded-slash form
    // ("%2f" instead of a real "/") is the payload that actually reaches
    // the server un-collapsed and exercises resolveStaticPath's guard.
    const response = await fetch(`${baseUrl}/..%2f..%2f..%2fetc%2fpasswd`);
    expect(response.status).toBe(404);
  });

  test("GET /api/unknown is a 404, not the SPA fallback", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);
  });

  test("creating a bundle while running triggers an SSE journal message", async () => {
    const controller = new AbortController();
    const streamPromise = (async () => {
      const response = await fetch(`${baseUrl}/api/events-stream`, { signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("no readable body on SSE response");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("data: journal")) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error("SSE stream closed before a journal message arrived");
        }
        buffer += decoder.decode(value);
      }
      return buffer;
    })();

    // Give the SSE connection a moment to register before triggering the change.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const created = runCli(["new", "third-bundle", "--json"], scratchDir);
    expect(created.exitCode).toBe(0);

    const timeoutPromise = new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for SSE journal message")), 3000);
    });

    const buffer = await Promise.race([streamPromise, timeoutPromise]);
    expect(buffer).toContain("data: journal");
    controller.abort();
  }, 10000);

  test("claim file exists while running, at the started port", () => {
    expect(existsSync(claimPath())).toBe(true);
    const claim = JSON.parse(readFileSync(claimPath(), "utf8")) as { pid: number; port: number };
    expect(claim.port).toBe(port);
  });

  test("stopping the server (SIGTERM) removes the claim file", async () => {
    if (serverProcess === undefined) {
      throw new Error("server process not started");
    }
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
    serverProcess = undefined;
    expect(existsSync(claimPath())).toBe(false);
  }, 10000);
});
