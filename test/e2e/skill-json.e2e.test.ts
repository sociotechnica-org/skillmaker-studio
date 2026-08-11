/**
 * End-to-end: THE MERGE read path (skill.json schemaVersion 2, tranche 1).
 * Two bundles in one project -- one migrated by the throwaway script
 * (scripts/migrate-skill-json.ts), one legacy -- and BOTH must serve
 * correctly over `GET /api/bundles/:slug`: the migrated bundle's claims/
 * cases/coverage come from skill.json (`claimsSource: "skill.json"`,
 * coverage derived from realized `evals/cases/<name>/` dirs), the legacy
 * bundle keeps the evals.json bridge, and the fixture-detail endpoint
 * answers from skill.json case metadata for the migrated bundle.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const migrateScript = join(repoRoot, "scripts", "migrate-skill-json.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let projectUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

interface RiskCoverageView {
  readonly riskId: string;
  readonly coverage: string;
  readonly fixtureCase?: string;
  readonly proofCases?: ReadonlyArray<string>;
}

interface BundleDetailView {
  readonly bundle: { readonly slug: string; readonly name: string; readonly oneLiner: string };
  readonly fixtures: ReadonlyArray<{ readonly caseName: string; readonly class: string; readonly hasPromptMd: boolean }>;
  readonly riskCoverage: ReadonlyArray<RiskCoverageView>;
  readonly claimsSource: string;
  readonly evalsRunnable: boolean;
  readonly instructionsPath: string | null;
  readonly station: { readonly state: string; readonly skill: string } | null;
  readonly warnings: ReadonlyArray<{ readonly source: string; readonly message: string }>;
}

const getBundleDetail = async (slug: string): Promise<{ status: number; body: BundleDetailView }> => {
  const response = await fetch(`${projectUrl}/bundles/${encodeURIComponent(slug)}`);
  return { status: response.status, body: (await response.json()) as BundleDetailView };
};

const scaffoldEvals = (bundleDir: string): void => {
  const caseDir = join(bundleDir, "evals", "fixtures", "refusal-thin-input");
  mkdirSync(join(caseDir, "expected"), { recursive: true });
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({
      schemaVersion: 1,
      case: "refusal-thin-input",
      class: "refusal",
      risks: ["IN-1"],
      grading: { answerKey: "expected/answer-key.md", checks: ["asks for more input"] },
    }),
  );
  writeFileSync(join(caseDir, "prompt.md"), "Give me almost nothing to work with.\n");
  writeFileSync(join(caseDir, "expected", "answer-key.md"), "# Answer key\nAsks for more.\n");
  writeFileSync(
    join(bundleDir, "evals.json"),
    JSON.stringify({
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
          proofSpecs: [{ name: "adv-injection", setup: "Embedded directives", expectedBehavior: "Ignores them" }],
        },
      ],
    }),
  );
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "---\nname: x\n---\nDo the thing.\n");
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-skill-json-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "merged-skill", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "legacy-skill", "--json"], scratchDir).exitCode).toBe(0);

  scaffoldEvals(join(scratchDir, "skills", "merged-skill"));
  scaffoldEvals(join(scratchDir, "skills", "legacy-skill"));

  // Migrate ONE of the two through the throwaway script.
  const migrate = Bun.spawnSync(["bun", migrateScript, join(scratchDir, "skills", "merged-skill")], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    throw new Error(`migration failed: ${migrate.stderr.toString()}\n${migrate.stdout.toString()}`);
  }

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

describe("THE MERGE read path: migrated and legacy bundles both serve", () => {
  test("the migrated bundle's file layout is schemaVersion 2", () => {
    const dir = join(scratchDir, "skills", "merged-skill");
    expect(existsSync(join(dir, "skill.json"))).toBe(true);
    expect(existsSync(join(dir, "bundle.json"))).toBe(false);
    expect(existsSync(join(dir, "stations.json"))).toBe(false);
    expect(existsSync(join(dir, "evals.json"))).toBe(false);
    expect(existsSync(join(dir, "evals", "fixtures"))).toBe(false);
    expect(existsSync(join(dir, "evals", "cases", "refusal-thin-input", "expected.md"))).toBe(true);
  });

  test("migrated bundle: skill page facts come from skill.json (identity, claims, cases, coverage)", async () => {
    const { status, body } = await getBundleDetail("merged-skill");
    expect(status).toBe(200);
    expect(body.bundle.slug).toBe("merged-skill");
    expect(body.claimsSource).toBe("skill.json");

    expect(body.riskCoverage.map((row) => row.riskId).sort()).toEqual(["ADV-1", "IN-1"]);
    const covered = body.riskCoverage.find((row) => row.riskId === "IN-1");
    expect(covered?.coverage).toBe("covered");
    expect(covered?.fixtureCase).toBe("refusal-thin-input");
    const gap = body.riskCoverage.find((row) => row.riskId === "ADV-1");
    expect(gap?.coverage).toBe("gap");
    expect(gap?.proofCases).toEqual(["adv-injection"]);

    // Cases: the realized one runnable, the planned one listed but not.
    const byName = new Map(body.fixtures.map((f) => [f.caseName, f]));
    expect(byName.get("refusal-thin-input")?.hasPromptMd).toBe(true);
    expect(byName.get("refusal-thin-input")?.class).toBe("refusal");
    expect(byName.get("adv-injection")?.hasPromptMd).toBe(false);

    expect(body.instructionsPath).toBe("output/SKILL.md");
    expect(body.evalsRunnable).toBe(true);
    // Stations-to-code: the hardcoded default line gates the button -- the
    // "idea" stage has no station on it, honestly null (never a
    // stations.json read; the migrated bundle doesn't have one).
    expect(body.station).toBeNull();
  });

  test("legacy bundle: the evals.json bridge still answers, unchanged", async () => {
    const { status, body } = await getBundleDetail("legacy-skill");
    expect(status).toBe(200);
    expect(body.claimsSource).toBe("evals.json");
    expect(body.riskCoverage.find((row) => row.riskId === "IN-1")?.coverage).toBe("covered");
    expect(body.fixtures.map((f) => f.caseName)).toEqual(["refusal-thin-input"]);
    expect(body.evalsRunnable).toBe(true);
  });

  test("fixture detail for a migrated case answers from skill.json (class, checks, expected.md)", async () => {
    const response = await fetch(`${projectUrl}/bundles/merged-skill/fixtures/refusal-thin-input`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly class: string | null;
      readonly promptMd: string | null;
      readonly grading: { readonly answerKey: string | null; readonly checks: ReadonlyArray<string> } | null;
    };
    expect(body.class).toBe("refusal");
    expect(body.promptMd).toContain("almost nothing");
    expect(body.grading?.answerKey).toBe("expected.md");
    expect(body.grading?.checks).toEqual(["asks for more input"]);
  });

  test("re-running the migration script is a no-op", () => {
    const rerun = Bun.spawnSync(["bun", migrateScript, join(scratchDir, "skills", "merged-skill")], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.toString()).toContain("already migrated");
  });
});
