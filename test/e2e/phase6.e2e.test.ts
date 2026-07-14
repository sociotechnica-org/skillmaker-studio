/**
 * End-to-end: versions + drift (data-model.md §2.7/§2.11, plan.md Phase 6).
 * Spawns the real `skillmaker` CLI's `start` command against a fresh
 * workspace and drives the full version lifecycle both through the CLI
 * (`skillmaker version record`, `skillmaker status`) and over HTTP
 * (`GET /api/bundles/:slug`, `POST /api/bundles/:slug/record-version`,
 * `GET /api/bundles/:slug/file`), the way the viewer's Versions/Files tabs
 * would: write output/SKILL.md and fill design.md, record a version, edit
 * each file independently to see drift track it, record again, and confirm
 * recording identical content twice is an idempotent no-op.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let port: number;
let baseUrl: string;
let bundleDir: string;

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

interface VersionRecordCliOutput {
  readonly status: "appended" | "already_appended";
  readonly slug: string;
  readonly hash: string;
  readonly designHash: string;
  readonly label: string | null;
}

const cliVersionRecord = (slug: string, label?: string): { result: ReturnType<typeof runCli>; json?: VersionRecordCliOutput } => {
  const args = ["version", "record", slug, "--json", ...(label !== undefined ? ["--label", label] : [])];
  const result = runCli(args, scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as VersionRecordCliOutput };
};

interface StatusCliOutput {
  readonly slug: string;
  readonly designHash: string;
  readonly outputHash: string;
  readonly drift: string;
  readonly latestVersion: { readonly hash: string; readonly label: string | null; readonly recordedAt: string } | null;
}

const cliStatus = (slug: string): StatusCliOutput => {
  const result = runCli(["status", slug, "--json"], scratchDir);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as StatusCliOutput;
};

interface VersionView {
  readonly bundle: string;
  readonly hash: string;
  readonly designHash: string;
  readonly label?: string;
  readonly recordedAt: string;
}

interface BundleDetailResponse {
  readonly bundle: { readonly slug: string; readonly drift: string; readonly designHash: string; readonly outputHash: string };
  readonly versions: ReadonlyArray<VersionView>;
}

const getBundleDetail = async (slug: string): Promise<{ status: number; body: BundleDetailResponse }> => {
  const response = await fetch(`${baseUrl}/api/bundles/${encodeURIComponent(slug)}`);
  const text = await response.text();
  let body: BundleDetailResponse;
  try {
    body = JSON.parse(text) as BundleDetailResponse;
  } catch (cause) {
    throw new Error(`GET /api/bundles/${slug} returned non-JSON (status ${response.status}): ${text}\n${String(cause)}`);
  }
  return { status: response.status, body };
};

const postRecordVersion = async (
  slug: string,
  label?: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}/api/bundles/${encodeURIComponent(slug)}/record-version`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(label !== undefined ? { label } : {}),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
};

const getBundleFile = async (
  slug: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(
    `${baseUrl}/api/bundles/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`,
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
};

beforeAll(async () => {
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase6-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "echo-formatter", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "echo-formatter");
  writeFileSync(join(bundleDir, "design.md"), "# Echo Formatter\n\nFormats echoes.\n");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Echo Formatter\n\nInitial output.\n");

  port = 20000 + Math.floor(Math.random() * 20000);
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

describe("skillmaker CLI end-to-end: Phase 6 (versions + drift)", () => {
  test("status before any version shows drift 'no-version'", () => {
    const status = cliStatus("echo-formatter");
    expect(status.drift).toBe("no-version");
    expect(status.latestVersion).toBeNull();
  });

  let firstHash: string;

  test("version record appends a version and prints its short hash", () => {
    const { result, json } = cliVersionRecord("echo-formatter", "v0.1");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("appended");
    expect(json?.label).toBe("v0.1");
    expect(json?.hash.startsWith("sha256:")).toBe(true);
    firstHash = json!.hash;
  });

  test("status after recording shows drift 'in-sync' and the recorded version", () => {
    const status = cliStatus("echo-formatter");
    expect(status.drift).toBe("in-sync");
    expect(status.latestVersion?.hash).toBe(firstHash);
    expect(status.latestVersion?.label).toBe("v0.1");
  });

  test("editing design.md alone moves drift to 'design-changed'", () => {
    writeFileSync(join(bundleDir, "design.md"), "# Echo Formatter\n\nFormats echoes, loudly.\n");
    const status = cliStatus("echo-formatter");
    expect(status.drift).toBe("design-changed");
  });

  test("editing output/SKILL.md too moves drift to 'both'", () => {
    writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Echo Formatter\n\nRevised output.\n");
    const status = cliStatus("echo-formatter");
    expect(status.drift).toBe("both");
  });

  let secondHash: string;

  test("recording again produces a new hash and returns to 'in-sync'", () => {
    const { result, json } = cliVersionRecord("echo-formatter", "v0.2");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("appended");
    expect(json?.hash).not.toBe(firstHash);
    secondHash = json!.hash;

    const status = cliStatus("echo-formatter");
    expect(status.drift).toBe("in-sync");
    expect(status.latestVersion?.hash).toBe(secondHash);
  });

  test("recording identical content again is an idempotent no-op (already_appended, exit 0)", () => {
    const { result, json } = cliVersionRecord("echo-formatter", "v0.2");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("already_appended");
    expect(json?.hash).toBe(secondHash);
  });

  test("recording identical content with a different label is a caught idempotency conflict (exit 1)", () => {
    const { result } = cliVersionRecord("echo-formatter", "v0.2-renamed");
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("already recorded");
  });

  test("GET /api/bundles/:slug shows 2 versions, newest first, matching drift/hashes", async () => {
    const { status, body } = await getBundleDetail("echo-formatter");
    expect(status).toBe(200);
    expect(body.bundle.drift).toBe("in-sync");
    expect(body.bundle.outputHash).toBe(secondHash);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0]?.hash).toBe(secondHash);
    expect(body.versions[0]?.label).toBe("v0.2");
    expect(body.versions[1]?.hash).toBe(firstHash);
    expect(body.versions[1]?.label).toBe("v0.1");
  });

  test("POST /api/bundles/:slug/record-version hashes server-side and appends over HTTP", async () => {
    writeFileSync(join(bundleDir, "design.md"), "# Echo Formatter\n\nFormats echoes via HTTP.\n");
    const { status, body } = await postRecordVersion("echo-formatter", "v0.3");
    expect(status).toBe(200);
    expect(body.status).toBe("appended");
    expect(body.label).toBe("v0.3");

    const detail = await getBundleDetail("echo-formatter");
    expect(detail.status).toBe(200);
    expect(detail.body.bundle.drift).toBe("in-sync");
    expect(detail.body.versions).toHaveLength(3);
    expect(detail.body.versions[0]?.label).toBe("v0.3");
  });

  test("POST /api/bundles/:slug/record-version is also idempotent on identical content", async () => {
    const { status, body } = await postRecordVersion("echo-formatter", "v0.3");
    expect(status).toBe(200);
    expect(body.status).toBe("already_appended");
  });

  test("GET /api/bundles/:slug/file serves design.md", async () => {
    const { status, body } = await getBundleFile("echo-formatter", "design.md");
    expect(status).toBe(200);
    expect(body.path).toBe("design.md");
    expect(String(body.content)).toContain("Formats echoes via HTTP.");
  });

  test("GET /api/bundles/:slug/file serves output/SKILL.md", async () => {
    const { status, body } = await getBundleFile("echo-formatter", "output/SKILL.md");
    expect(status).toBe(200);
    expect(body.path).toBe("output/SKILL.md");
    expect(String(body.content)).toContain("Revised output.");
  });

  test("GET /api/bundles/:slug/file 404s a traversal attempt", async () => {
    const { status } = await getBundleFile("echo-formatter", "../../../etc/passwd");
    expect(status).toBe(404);
  });

  test("GET /api/bundles/:slug/file 404s a path outside the allowlist", async () => {
    const { status: statusA } = await getBundleFile("echo-formatter", "bundle.json");
    expect(statusA).toBe(404);
    const { status: statusB } = await getBundleFile("echo-formatter", "stations.json");
    expect(statusB).toBe(404);
    const { status: statusC } = await getBundleFile("echo-formatter", "output/");
    expect(statusC).toBe(404);
  });

  test("GET /api/bundles/:slug/file 404s a missing file inside the allowlist", async () => {
    const { status } = await getBundleFile("echo-formatter", "output/does-not-exist.md");
    expect(status).toBe(404);
  });
});
