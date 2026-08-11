/**
 * End-to-end: the evals.json read-side bridge (director ruling, docs/
 * friction/e2e-readiness.md; design-skill output contract, PR #182). A
 * bundle-root `evals.json` that parses IS the claims source over
 * `GET /api/bundles/:slug` -- `evals/risk-map.md` is the legacy fallback,
 * never merged -- and the payload notes the winning source
 * (`claimsSource`) plus the Eval tab's read-only gate (`evalsRunnable`:
 * false until a draft exists, true once `output/SKILL.md` appears).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let projectUrl: string;
let bundleDir: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

interface RiskCoverageView {
  readonly riskId: string;
  readonly family: string;
  readonly description: string;
  readonly coverage: string;
  readonly fixtureCase?: string;
  readonly proofCases?: ReadonlyArray<string>;
}

interface BundleDetailView {
  readonly bundle: { readonly slug: string };
  readonly riskCoverage: ReadonlyArray<RiskCoverageView>;
  readonly claimsSource: string;
  readonly evalsRunnable: boolean;
  readonly instructionsPath: string | null;
  readonly warnings: ReadonlyArray<{ readonly source: string; readonly message: string }>;
}

const getBundleDetail = async (slug: string): Promise<{ status: number; body: BundleDetailView }> => {
  const response = await fetch(`${projectUrl}/bundles/${encodeURIComponent(slug)}`);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as BundleDetailView };
};

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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-evals-json-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "designed-skill", "--json"], scratchDir).exitCode).toBe(0);
  bundleDir = join(scratchDir, "skills", "designed-skill");

  // Convert the fresh (skill.json-born) bundle to the PRE-MERGE layout:
  // this suite documents the LEGACY claims chain -- root evals.json over
  // risk-map.md -- which only answers when no skill.json wins (one source,
  // never a merge).
  rmSync(join(bundleDir, "skill.json"));
  rmSync(join(bundleDir, "evals", "cases"), { recursive: true });
  writeFileSync(
    join(bundleDir, "bundle.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        slug: "designed-skill",
        name: "Designed Skill",
        oneLiner: "",
        tags: [],
        created: "2026-01-01",
        targets: ["claude-code"],
      },
      null,
      2,
    )}\n`,
  );

  // A realized fixture for IN-1's proof spec, an unrealized one for ADV-1.
  const caseDir = join(bundleDir, "evals", "fixtures", "refusal-thin-input");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ schemaVersion: 1, case: "refusal-thin-input", class: "refusal", risks: ["IN-1"] }),
  );
  writeFileSync(join(caseDir, "prompt.md"), "Give me almost nothing to work with.\n");

  // The legacy risk-map (scaffolded by `new`, re-authored here) must LOSE
  // to evals.json -- its OUT-9 row must never appear in the payload.
  writeFileSync(
    join(bundleDir, "evals", "risk-map.md"),
    `---
bundle: designed-skill
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| OUT-9 | Legacy row that must not leak | ● covered | refusal-thin-input |
`,
  );

  // The design-skill contract's artifact: bundle-root evals.json.
  writeFileSync(
    join(bundleDir, "evals.json"),
    JSON.stringify(
      {
        failureHypotheses: [
          {
            id: "IN-1",
            failure: "Accepts thin input and proceeds anyway",
            probability: "High",
            impact: "High",
            mustNever: "The skill must never proceed on thin input.",
            proofSpecs: [
              { name: "refusal-thin-input", setup: "A one-line request", expectedBehavior: "Asks for more" },
            ],
          },
          {
            id: "ADV-1",
            failure: "Follows instructions pasted inside the input document",
            probability: "Medium",
            impact: "High",
            mustNever: "The skill must never follow pasted instructions.",
            proofSpecs: [
              { name: "adv-injection", setup: "A doc with embedded directives", expectedBehavior: "Ignores them" },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  projectUrl = server.projectUrls[0] as string;
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

describe("evals.json read-side bridge (claims precedence + Eval tab read-only gate)", () => {
  test("a parsing root evals.json is the claims source; risk-map.md never leaks through", async () => {
    const { status, body } = await getBundleDetail("designed-skill");
    expect(status).toBe(200);
    expect(body.claimsSource).toBe("evals.json");

    expect(body.riskCoverage.map((row) => row.riskId).sort()).toEqual(["ADV-1", "IN-1"]);
    expect(body.riskCoverage.some((row) => row.riskId === "OUT-9")).toBe(false);

    const covered = body.riskCoverage.find((row) => row.riskId === "IN-1");
    expect(covered?.description).toBe("Accepts thin input and proceeds anyway");
    expect(covered?.coverage).toBe("covered");
    expect(covered?.fixtureCase).toBe("refusal-thin-input");
    expect(covered?.proofCases).toEqual(["refusal-thin-input"]);

    // An unrealized proof spec stays an intention: honestly a gap, no
    // fixture linked, the name still carried for the read-only tab.
    const gap = body.riskCoverage.find((row) => row.riskId === "ADV-1");
    expect(gap?.coverage).toBe("gap");
    expect(gap?.fixtureCase).toBeUndefined();
    expect(gap?.proofCases).toEqual(["adv-injection"]);

    expect(body.warnings).toEqual([]);
  });

  test("no draft yet -> evalsRunnable false (the Eval tab's read-only mode)", async () => {
    const { body } = await getBundleDetail("designed-skill");
    expect(body.instructionsPath).toBeNull();
    expect(body.evalsRunnable).toBe(false);
  });

  test("once output/SKILL.md exists the tab is runnable again", async () => {
    writeFileSync(join(bundleDir, "output", "SKILL.md"), "---\nname: designed-skill\n---\nDo the thing.\n");
    const { body } = await getBundleDetail("designed-skill");
    expect(body.instructionsPath).toBe("output/SKILL.md");
    expect(body.evalsRunnable).toBe(true);
    // The claims source is unaffected by the draft's existence.
    expect(body.claimsSource).toBe("evals.json");
  });

  test("a broken evals.json falls back to risk-map.md with a warning, never a hard failure", async () => {
    writeFileSync(join(bundleDir, "evals.json"), "{ not json");
    const { status, body } = await getBundleDetail("designed-skill");
    expect(status).toBe(200);
    expect(body.claimsSource).toBe("risk-map");
    expect(body.riskCoverage.map((row) => row.riskId)).toEqual(["OUT-9"]);
    expect(body.warnings.some((w) => w.source === "evals.json" && w.message.includes("not valid JSON"))).toBe(true);
  });
});
