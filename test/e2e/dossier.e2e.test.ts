/**
 * End-to-end: the dossier (issue #94, `Mechanism - Receiving Dock.md`'s
 * "the dossier" -- progressive context-of-use fields with honest gaps).
 * Spawns the real `skillmaker` CLI's `start` command against a fresh
 * workspace and drives the full lifecycle both through the CLI
 * (`skillmaker new`, `skillmaker fixture add --context`, `skillmaker
 * reindex`, `skillmaker dossier`) and over HTTP (`GET /api/bundles/:slug`,
 * `GET /api/catalog`): scaffold a bundle, confirm dossier.md's honest-gap
 * skeleton, author real dossier content by hand (files are canonical),
 * reindex clean, confirm the API serves sections + gaps, confirm a
 * context-tagged fixture reindexes warning-free, and confirm the Bench's
 * catalog response carries no dossier field at all (no nag inflation).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

interface ReindexCliWarning {
  readonly bundle: string | null;
  readonly source: string;
  readonly message: string;
}

interface ReindexCliOutput {
  readonly status: "reindexed";
  readonly warnings: ReadonlyArray<ReindexCliWarning>;
}

const cliReindex = (): { result: ReturnType<typeof runCli>; json?: ReindexCliOutput } => {
  const result = runCli(["reindex", "--json"], scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as ReindexCliOutput };
};

interface DossierCliOutput {
  readonly bundle: string;
  readonly job: string | null;
  readonly contexts: ReadonlyArray<{ readonly name: string; readonly body: string }>;
  readonly outOfScope: string | null;
  readonly basis: string | null;
  readonly evidence: string | null;
  readonly fitCriterion: string | null;
  readonly warnings: ReadonlyArray<string>;
}

const cliDossier = (slug: string): { result: ReturnType<typeof runCli>; json?: DossierCliOutput } => {
  const result = runCli(["dossier", slug, "--json"], scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as DossierCliOutput };
};

interface FixtureView {
  readonly caseName: string;
  readonly context?: string;
}

interface WarningView {
  readonly bundle?: string;
  readonly source: string;
  readonly message: string;
}

interface DossierContextView {
  readonly name: string;
  readonly body: string;
}

interface DossierView {
  readonly job?: string;
  readonly contexts: ReadonlyArray<DossierContextView>;
  readonly outOfScope?: string;
  readonly basis?: string;
  readonly evidence?: string;
  readonly fitCriterion?: string;
}

interface BundleDetailResponse {
  readonly bundle: { readonly slug: string };
  readonly fixtures: ReadonlyArray<FixtureView>;
  readonly warnings: ReadonlyArray<WarningView>;
  readonly dossier: DossierView;
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

const getCatalogRaw = async (): Promise<{ status: number; text: string }> => {
  const response = await fetch(`${baseUrl}/api/catalog`);
  return { status: response.status, text: await response.text() };
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-dossier-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "frame-the-problem", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "frame-the-problem");

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

describe("skillmaker CLI end-to-end: the dossier (issue #94)", () => {
  test("`skillmaker new` scaffolds a dossier.md with comment-hinted empty sections", () => {
    const dossierPath = join(bundleDir, "dossier.md");
    expect(existsSync(dossierPath)).toBe(true);
    const content = readFileSync(dossierPath, "utf8");
    expect(content).toContain("bundle: frame-the-problem");
    expect(content).toContain("## Job");
    expect(content).toContain("## Contexts");
    expect(content).toContain("## Out-of-scope");
    expect(content).toContain("## Basis");
    expect(content).toContain("## Evidence");
    expect(content).toContain("## Fit criterion");
  });

  test("`skillmaker dossier` reports every section as an honest gap on a fresh scaffold", () => {
    const { result, json } = cliDossier("frame-the-problem");
    expect(result.exitCode).toBe(0);
    expect(json?.job).toBeNull();
    expect(json?.contexts).toEqual([]);
    expect(json?.outOfScope).toBeNull();
    expect(json?.basis).toBeNull();
    expect(json?.evidence).toBeNull();
    expect(json?.fitCriterion).toBeNull();
    expect(json?.warnings).toEqual([]);
  });

  test("GET /api/bundles/:slug serves the same honest gaps, no warnings", async () => {
    const { status, body } = await getBundleDetail("frame-the-problem");
    expect(status).toBe(200);
    expect(body.dossier.job).toBeUndefined();
    expect(body.dossier.contexts).toEqual([]);
    expect(body.dossier.fitCriterion).toBeUndefined();
    expect(body.warnings.filter((w) => w.source === "dossier")).toEqual([]);
  });

  test("hand-authoring dossier.md (files are canonical): reindex clean, API serves the content", () => {
    writeFileSync(
      join(bundleDir, "dossier.md"),
      `---
bundle: frame-the-problem
---
# Dossier — Frame The Problem

## Job
Turns a vague ask into a structured problem statement.

## Contexts

### PR review comment
Handoff-in: a diff. Downstream reads only the comment body. Single-turn, no
tools, no human gate. Stakes: load-bearing.

## Out-of-scope
Not for open-ended brainstorming with no artifact to react to.

## Basis
Volere requirements process -- ask Dana.

## Evidence
None yet; no permission requested.

## Fit criterion
Given a vague ask, produces a one-paragraph problem statement a stranger
could act on.
`,
    );

    const { result, json } = cliReindex();
    expect(result.exitCode).toBe(0);
    expect(json?.warnings.filter((w) => w.source === "dossier")).toEqual([]);
  });

  test("`skillmaker dossier` now reports the authored content", () => {
    const { result, json } = cliDossier("frame-the-problem");
    expect(result.exitCode).toBe(0);
    expect(json?.job).toBe("Turns a vague ask into a structured problem statement.");
    expect(json?.contexts).toEqual([
      {
        name: "PR review comment",
        body: "Handoff-in: a diff. Downstream reads only the comment body. Single-turn, no\ntools, no human gate. Stakes: load-bearing.",
      },
    ]);
    expect(json?.basis).toBe("Volere requirements process -- ask Dana.");
  });

  test("GET /api/bundles/:slug now serves the authored sections, no gaps for what's filled in", async () => {
    const { status, body } = await getBundleDetail("frame-the-problem");
    expect(status).toBe(200);
    expect(body.dossier.job).toBe("Turns a vague ask into a structured problem statement.");
    expect(body.dossier.contexts).toHaveLength(1);
    expect(body.dossier.contexts[0]?.name).toBe("PR review comment");
    expect(body.dossier.fitCriterion).toContain("stranger");
  });

  test("a fixture tagged with --context reindexes warning-free and carries the tag over the API", () => {
    const add = runCli(
      ["fixture", "add", "frame-the-problem", "reviewer-golden", "--context", "PR review comment", "--json"],
      scratchDir,
    );
    expect(add.exitCode).toBe(0);

    const { result, json } = cliReindex();
    expect(result.exitCode).toBe(0);
    expect(json?.warnings).toEqual([]);
  });

  test("GET /api/bundles/:slug's fixtures carry the context tag", async () => {
    const { status, body } = await getBundleDetail("frame-the-problem");
    expect(status).toBe(200);
    const fixture = body.fixtures.find((f) => f.caseName === "reviewer-golden");
    expect(fixture?.context).toBe("PR review comment");
  });

  test("GET /api/catalog (the Lab Bench's data source) carries no dossier field at all -- no nag inflation", async () => {
    const { status, text } = await getCatalogRaw();
    expect(status).toBe(200);
    // Deliberately a raw string check, not a typed decode: the point is that
    // NOTHING resembling dossier content (job/contexts/fitCriterion/basis/
    // "unrecorded") appears anywhere in the catalog wire payload, not just
    // that a typed field is absent.
    expect(text).not.toContain("dossier");
    expect(text).not.toContain("fitCriterion");
    expect(text).not.toContain("unrecorded");
  });
});
