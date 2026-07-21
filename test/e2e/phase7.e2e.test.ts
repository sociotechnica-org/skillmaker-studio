/**
 * End-to-end: evals have shape -- fixtures + coverage (data-model.md §2.5,
 * §2.6, §2.11, plan.md Phase 7). Spawns the real `skillmaker` CLI's `start`
 * command against a fresh workspace and drives the full fixtures/risk-map
 * lifecycle both through the CLI (`skillmaker new`, `skillmaker fixture
 * add`, `skillmaker reindex`, `skillmaker status`) and over HTTP
 * (`GET /api/bundles`, `GET /api/bundles/:slug`), the way the viewer's
 * Evals tab and board fixture-count indicator would: scaffold a bundle,
 * confirm the risk-map.md skeleton exists, add two fixtures with risks,
 * author a 3-row risk-map (including a gap), reindex clean, check
 * status/API surface fixtures + coverage, then break a case.json and
 * confirm reindex still exits 0 but surfaces a warning everywhere.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

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

interface FixtureAddCliOutput {
  readonly status: "created";
  readonly bundle: string;
  readonly case: string;
  readonly class: string;
  readonly risks: ReadonlyArray<string>;
}

const cliFixtureAdd = (
  slug: string,
  caseName: string,
  options: { readonly klass?: string; readonly risks?: string } = {},
): { result: ReturnType<typeof runCli>; json?: FixtureAddCliOutput } => {
  const args = [
    "fixture",
    "add",
    slug,
    caseName,
    "--json",
    ...(options.klass !== undefined ? ["--class", options.klass] : []),
    ...(options.risks !== undefined ? ["--risks", options.risks] : []),
  ];
  const result = runCli(args, scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as FixtureAddCliOutput };
};

interface ReindexCliWarning {
  readonly bundle: string | null;
  readonly source: string;
  readonly message: string;
}

interface ReindexCliOutput {
  readonly status: "reindexed";
  readonly bundles: number;
  readonly todos: number;
  readonly events: number;
  readonly warnings: ReadonlyArray<ReindexCliWarning>;
}

const cliReindex = (): { result: ReturnType<typeof runCli>; json?: ReindexCliOutput } => {
  const result = runCli(["reindex", "--json"], scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as ReindexCliOutput };
};

interface StatusCoverageSummary {
  readonly covered: number;
  readonly partial: number;
  readonly gap: number;
  readonly na: number;
}

interface StatusCliWarning {
  readonly source: string;
  readonly message: string;
}

interface StatusCliOutput {
  readonly slug: string;
  readonly fixtureCount: number;
  readonly coverage: StatusCoverageSummary;
  readonly warnings: ReadonlyArray<StatusCliWarning>;
}

const cliStatus = (slug: string): { result: ReturnType<typeof runCli>; json?: StatusCliOutput } => {
  const result = runCli(["status", slug, "--json"], scratchDir);
  if (result.exitCode !== 0) {
    return { result };
  }
  return { result, json: JSON.parse(result.stdout) as StatusCliOutput };
};

interface FixtureView {
  readonly bundle: string;
  readonly caseName: string;
  readonly class: string;
  readonly risks: ReadonlyArray<string>;
  readonly hasPromptMd: boolean;
}

interface RiskCoverageView {
  readonly bundle: string;
  readonly riskId: string;
  readonly family: string;
  readonly coverage: string;
  readonly fixtureCase?: string;
}

interface WarningView {
  readonly bundle?: string;
  readonly source: string;
  readonly message: string;
}

interface BundleDetailResponse {
  readonly bundle: { readonly slug: string };
  readonly fixtures: ReadonlyArray<FixtureView>;
  readonly riskCoverage: ReadonlyArray<RiskCoverageView>;
  readonly warnings: ReadonlyArray<WarningView>;
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

interface BundlesResponse {
  readonly bundles: ReadonlyArray<{ readonly slug: string }>;
  readonly fixtureCounts: Readonly<Record<string, number>>;
}

const getBundles = async (): Promise<{ status: number; body: BundlesResponse }> => {
  const response = await fetch(`${baseUrl}/api/bundles`);
  const body = (await response.json()) as BundlesResponse;
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase7-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "frame-the-problem", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "frame-the-problem");

  const server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  port = server.port;
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

describe("skillmaker CLI end-to-end: Phase 7 (evals have shape: fixtures + coverage)", () => {
  test("`skillmaker new` scaffolds an evals/risk-map.md skeleton", () => {
    const riskMapPath = join(bundleDir, "evals", "risk-map.md");
    expect(existsSync(riskMapPath)).toBe(true);
    const content = readFileSync(riskMapPath, "utf8");
    expect(content).toContain("bundle: frame-the-problem");
    expect(content).toContain("| Risk | Description | Coverage | Fixture |");
  });

  test("`skillmaker fixture add` scaffolds a golden case with risks", () => {
    const { result, json } = cliFixtureAdd("frame-the-problem", "golden-basic", { risks: "IN-1,RE-2" });
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("created");
    expect(json?.class).toBe("golden");
    expect(json?.risks).toEqual(["IN-1", "RE-2"]);

    const caseDir = join(bundleDir, "evals", "fixtures", "golden-basic");
    expect(existsSync(join(caseDir, "case.json"))).toBe(true);
    expect(existsSync(join(caseDir, "prompt.md"))).toBe(true);
    expect(existsSync(join(caseDir, "files", ".gitkeep"))).toBe(true);
    expect(existsSync(join(caseDir, "expected", "answer-key.md"))).toBe(true);
  });

  test("`skillmaker fixture add` scaffolds a second, refusal-class case", () => {
    const { result, json } = cliFixtureAdd("frame-the-problem", "refusal-thin-input", {
      klass: "refusal",
      risks: "ADV-1",
    });
    expect(result.exitCode).toBe(0);
    expect(json?.class).toBe("refusal");
    expect(json?.risks).toEqual(["ADV-1"]);
  });

  test("`skillmaker fixture add` refuses to overwrite an existing case (exit 1)", () => {
    const { result } = cliFixtureAdd("frame-the-problem", "golden-basic");
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("already exists");
  });

  test("authoring a 3-row risk-map.md including a gap", () => {
    writeFileSync(
      join(bundleDir, "evals", "risk-map.md"),
      `---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | golden-basic |
| RE-2 | Multi-step reasoning | ◐ partial | golden-basic |
| ADV-1 | Prompt injection | ○ gap | — |
`,
    );
  });

  test("`skillmaker reindex` exits 0 with no warnings once fixtures + risk-map agree", () => {
    const { result, json } = cliReindex();
    expect(result.exitCode).toBe(0);
    expect(json?.warnings).toEqual([]);
    expect(json?.bundles).toBeGreaterThanOrEqual(1);
  });

  test("`skillmaker status` reports fixture count + coverage summary, no warnings", () => {
    const { result, json } = cliStatus("frame-the-problem");
    expect(result.exitCode).toBe(0);
    expect(json?.fixtureCount).toBe(2);
    expect(json?.coverage).toEqual({ covered: 1, partial: 1, gap: 1, na: 0 });
    expect(json?.warnings).toEqual([]);
  });

  test("GET /api/bundles/:slug returns fixtures + riskCoverage, no warnings", async () => {
    const { status, body } = await getBundleDetail("frame-the-problem");
    expect(status).toBe(200);
    expect(body.fixtures).toHaveLength(2);
    const golden = body.fixtures.find((fixture) => fixture.caseName === "golden-basic");
    expect(golden?.class).toBe("golden");
    expect(golden?.risks).toEqual(["IN-1", "RE-2"]);
    expect(golden?.hasPromptMd).toBe(true);

    expect(body.riskCoverage).toHaveLength(3);
    const gapRow = body.riskCoverage.find((row) => row.riskId === "ADV-1");
    expect(gapRow?.coverage).toBe("gap");
    expect(gapRow?.family).toBe("ADV");
    expect(gapRow?.fixtureCase).toBeUndefined();

    expect(body.warnings).toEqual([]);
  });

  test("GET /api/bundles reports a fixture count of 2 for this bundle", async () => {
    const { status, body } = await getBundles();
    expect(status).toBe(200);
    expect(body.fixtureCounts["frame-the-problem"]).toBe(2);
  });

  test("breaking golden-basic/case.json: reindex still exits 0, but surfaces a warning", () => {
    writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "case.json"), "{ not valid json");

    const { result, json } = cliReindex();
    expect(result.exitCode).toBe(0);
    expect(json?.warnings.length).toBeGreaterThan(0);
    const warning = json?.warnings.find((w) => w.bundle === "frame-the-problem" && w.source === "fixtures");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("malformed JSON");
  });

  test("`skillmaker status` still works and lists the warning", () => {
    const { result, json } = cliStatus("frame-the-problem");
    expect(result.exitCode).toBe(0);
    // golden-basic no longer parses, so only refusal-thin-input remains.
    expect(json?.fixtureCount).toBe(1);
    expect(json?.warnings.some((w) => w.message.includes("malformed JSON"))).toBe(true);
  });

  test("GET /api/bundles/:slug still returns 200 with the warning surfaced", async () => {
    const { status, body } = await getBundleDetail("frame-the-problem");
    expect(status).toBe(200);
    expect(body.fixtures).toHaveLength(1);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings.some((w) => w.source === "fixtures" && w.message.includes("malformed JSON"))).toBe(true);
  });
});
