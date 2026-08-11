/**
 * PHASE 1 VERDICT (evaluated against the shipped code before this test was written)
 *
 * The proposed golden path is sound after these revisions:
 *
 * - Project registration is the CLI door `skillmaker project add <dir>` and
 *   bundle creation is `POST /api/projects/:project/bundles`. The latter
 *   accepts `slug`, `name`, and `oneLiner`; the CLI's `new` command does not
 *   currently accept a one-liner.
 * - Forward movement has two real doors: CLI `skillmaker advance` and HTTP
 *   `POST /api/projects/:project/events` with `bundle.stage_changed`. Both
 *   share Machine.checkTransition. Reviews are events at the same HTTP door.
 * - The shipped guard table checks a fresh approved review for every forward
 *   step and additionally requires `bundle.gate_decided: approved` for
 *   evaluating -> published. It does NOT yet enforce the newer ruled artifact
 *   table (idea birth intent, design.md, output/SKILL.md), and publish is not
 *   yet the ruled always-allowed soft transition. GATE-PENDING assertions below
 *   lock today's behavior without implementing app logic in this test-only PR.
 * - Station execution exists (`skillmaker station run` and the station-run
 *   HTTP endpoint), but canned direct writes are the honest seam here. Agent
 *   behavior/copyback/review-request mechanics already have dedicated e2e
 *   coverage; this test guards the product handoffs around their artifacts.
 * - Fixtures, runs, grades, and measurements are CLI doors: `fixture add`,
 *   `run`, `grade`, and `measurements`. A fake ACP adapter makes `run`
 *   deterministic. On origin/main, grading writes both `run.graded` and the
 *   git-visible `runs/<id>/grades/human/grade.json`.
 * - Install publishing is `skillmaker publish <slug> --to project` (also an
 *   HTTP door). The shipped soft signal for an ungraded version is the honest
 *   evidence string/stamp (`0 of 1 claims measured`), not a separate warning
 *   field, so the test asserts that actual contract.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");
const fakeAdapter = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");

const GOLDEN = "golden-path-skill";
const GATE_PROBE = "ungraded-gate-probe";
const CASE = "golden-basic";

let workspace: string;
let studioHome: string;
let claudeHome: string;
let projectUrl: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      SKILLMAKER_STUDIO_HOME: studioHome,
      CLAUDE_CONFIG_DIR: claudeHome,
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const cliJson = (result: ReturnType<typeof runCli>): Record<string, unknown> => {
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of stream.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRecord(parsed)) return parsed;
      } catch {
        // Progress can share stderr with the final JSON result.
      }
    }
  }
  throw new Error(`CLI did not emit a JSON object:\n${result.stdout}${result.stderr}`);
};

const readJsonRecord = (path: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${path} did not contain a JSON object`);
  return parsed;
};

const post = async (path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${projectUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const approve = async (bundle: string, state: string): Promise<void> => {
  expect((await post("/events", { type: "review.requested", payload: { bundle, state } })).status).toBe(200);
  expect(
    (
      await post("/events", {
        type: "review.resolved",
        payload: { bundle, state, decision: "approve" },
      })
    ).status,
  ).toBe(200);
};

const advanceHttp = (bundle: string, from: string, to: string) =>
  post("/events", { type: "bundle.stage_changed", payload: { bundle, from, to } });

const configureFakeProvider = (): void => {
  const path = join(workspace, "skillmaker.config.json");
  const config = readJsonRecord(path);
  const providers = config.providers;
  if (!isRecord(providers)) throw new Error("skillmaker.config.json has no providers object");
  providers["claude-code"] = { command: ["node", fakeAdapter] };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
};

const writeOneClaim = (bundleDir: string, fixture: string): void => {
  writeFileSync(
    join(bundleDir, "evals.json"),
    `${JSON.stringify(
      {
        failureHypotheses: [
          {
            id: "IN-1",
            failure: "The skill ignores the requested format",
            probability: "Medium",
            impact: "High",
            mustNever: "The skill must honor the requested format.",
            proofSpecs: [{ name: fixture, setup: "A format request", expectedBehavior: "Uses the format" }],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
};

const journalEvents = (): ReadonlyArray<Record<string, unknown>> =>
  readFileSync(join(workspace, ".skillmaker", "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("journal line was not an object");
      return parsed;
    });

beforeAll(async () => {
  if (!existsSync(join(viewerDist, "index.html"))) {
    const build = Bun.spawnSync(["bun", "run", "--filter", "@skillmaker/viewer", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) throw new Error("packages/viewer failed to build in test setup");
  }

  workspace = mkdtempSync(join(tmpdir(), "skillmaker-golden-path-workspace-"));
  studioHome = mkdtempSync(join(tmpdir(), "skillmaker-golden-path-home-"));
  claudeHome = mkdtempSync(join(tmpdir(), "skillmaker-golden-path-claude-"));

  Bun.spawnSync(["git", "init", "-q"], { cwd: workspace });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: workspace });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: workspace });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);

  // Exercise the real registry CLI door rather than having the server helper
  // pre-write config.json for us.
  const registered = runCli(["project", "add", workspace, "--json"]);
  expect(registered.exitCode).toBe(0);
  expect(cliJson(registered).status).toBe("added");

  const started = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: workspace,
    env: {
      SKILLMAKER_STUDIO_HOME: studioHome,
      CLAUDE_CONFIG_DIR: claudeHome,
    },
  });
  serverProcess = started.process;

  const projectsResponse = await fetch(`${started.baseUrl}/api/projects`);
  expect(projectsResponse.status).toBe(200);
  const projectsBody: unknown = await projectsResponse.json();
  if (!isRecord(projectsBody) || !Array.isArray(projectsBody.projects)) {
    throw new Error("GET /api/projects returned an unexpected shape");
  }
  const firstProject = projectsBody.projects[0];
  if (!isRecord(firstProject) || typeof firstProject.slug !== "string") {
    throw new Error("registered project had no URL slug");
  }
  projectUrl = `${started.baseUrl}/api/projects/${firstProject.slug}`;
}, 60_000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  for (const dir of [workspace, studioHome, claudeHome]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("golden path: birth intent through installed, measured skill", () => {
  test("walks every shipped seam and records the complete journal story", async () => {
    const created = await post("/bundles", {
      slug: GOLDEN,
      name: "Golden Path Skill",
      oneLiner: "Turn a request into a deterministic golden-path result.",
    });
    expect(created.status).toBe(201);

    const bundleDir = join(workspace, "skills", GOLDEN);
    const identity = readJsonRecord(join(bundleDir, "bundle.json"));
    expect(identity.name).toBe("Golden Path Skill");
    expect(identity.oneLiner).toBe("Turn a request into a deterministic golden-path result.");

    // GATE-PENDING (ruled table): idea -> researching should require a
    // non-empty name + oneLiner. Today the same transition succeeds for an
    // empty birth intent once review approval exists.
    expect(
      (
        await post("/bundles", {
          slug: GATE_PROBE,
          name: "",
          oneLiner: "",
        })
      ).status,
    ).toBe(201);
    await approve(GATE_PROBE, "idea");
    expect((await advanceHttp(GATE_PROBE, "idea", "researching")).status).toBe(200);

    await approve(GOLDEN, "idea");
    expect((await advanceHttp(GOLDEN, "idea", "researching")).status).toBe(200);

    // Artifacts are canned because this test owns product seams, not agent
    // quality. The dedicated station e2e owns fake-agent copyback behavior.
    unlinkSync(join(bundleDir, "design.md"));
    mkdirSync(join(bundleDir, "research"), { recursive: true });
    writeFileSync(join(bundleDir, "research", "notes.md"), "# Research\n\nA deterministic product-flow note.\n");
    expect(existsSync(join(bundleDir, "research", "notes.md"))).toBe(true);

    await approve(GOLDEN, "researching");
    // GATE-PENDING (ruled table): researching -> drafting should refuse when
    // design.md is absent. Shipped Machine.checkTransition currently allows
    // it after review approval, so assert that behavior explicitly.
    expect(existsSync(join(bundleDir, "design.md"))).toBe(false);
    expect((await advanceHttp(GOLDEN, "researching", "drafting")).status).toBe(200);
    writeFileSync(join(bundleDir, "design.md"), "# Golden Path Skill\n\n## Intent\n\nExercise every product seam.\n");

    await approve(GOLDEN, "drafting");
    // GATE-PENDING (ruled table): drafting -> evaluating should require
    // output/SKILL.md. It is not shipped yet; approved review still wins.
    expect(existsSync(join(bundleDir, "output", "SKILL.md"))).toBe(false);
    expect((await advanceHttp(GOLDEN, "drafting", "evaluating")).status).toBe(200);
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      "---\nname: golden-path-skill\ndescription: Exercises the complete product flow.\n---\n\nReturn the requested result.\n",
    );

    const fixture = runCli(["fixture", "add", GOLDEN, CASE, "--json"]);
    expect(fixture.exitCode).toBe(0);
    const caseDir = join(bundleDir, "evals", "fixtures", CASE);
    writeFileSync(join(caseDir, "prompt.md"), "Return the golden-path result.\n");
    const caseJson = readJsonRecord(join(caseDir, "case.json"));
    caseJson.risks = ["IN-1"];
    writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`);
    writeOneClaim(bundleDir, CASE);
    configureFakeProvider();

    const run = runCli(["run", GOLDEN, "--fixture", CASE, "--provider", "claude-code", "--json"]);
    expect(run.exitCode).toBe(0);
    const runOutput = cliJson(run);
    expect(runOutput.status).toBe("completed");
    const runId = runOutput.runId;
    if (typeof runId !== "string") throw new Error("run result had no runId");

    const runDir = join(bundleDir, "runs", runId);
    expect(readJsonRecord(join(runDir, "run.json")).status).toBe("completed");

    const grade = runCli(["grade", GOLDEN, runId, "--verdict", "pass", "--notes", "golden", "--json"]);
    expect(grade.exitCode).toBe(0);
    const gradePath = join(runDir, "grades", "human", "grade.json");
    expect(existsSync(gradePath)).toBe(true);
    const gradeFile = readJsonRecord(gradePath);
    expect(gradeFile.runId).toBe(runId);
    expect(gradeFile.grader).toBe("human");
    expect(gradeFile.verdict).toBe("pass");

    const measurements = runCli(["measurements", GOLDEN, "--json"]);
    expect(measurements.exitCode).toBe(0);
    const cells = cliJson(measurements).measurements;
    expect(Array.isArray(cells)).toBe(true);
    if (!Array.isArray(cells)) throw new Error("measurements was not an array");
    const goldenCell = cells.find(
      (cell) => isRecord(cell) && cell.fixtureCase === CASE && cell.n === 1 && cell.passes === 1,
    );
    expect(goldenCell).toBeDefined();

    await approve(GOLDEN, "evaluating");
    // GATE-PENDING (ruled soft table): the shipped machine still hard-refuses
    // evaluating -> published without bundle.gate_decided: approved.
    const currentHardGate = await advanceHttp(GOLDEN, "evaluating", "published");
    expect(currentHardGate.status).toBe(409);
    expect(
      (
        await post("/events", {
          type: "bundle.gate_decided",
          payload: { bundle: GOLDEN, gate: "publish", decision: "approved", basis: "golden-path e2e" },
        })
      ).status,
    ).toBe(200);
    expect((await advanceHttp(GOLDEN, "evaluating", "published")).status).toBe(200);

    const published = runCli(["publish", GOLDEN, "--to", "project", "--json"]);
    expect(published.exitCode).toBe(0);
    expect(cliJson(published).evidence).toBe("1 of 1 claims measured");
    const installedSkill = join(workspace, ".claude", "skills", GOLDEN, "SKILL.md");
    expect(existsSync(installedSkill)).toBe(true);
    const installed = readFileSync(installedSkill, "utf8");
    expect(installed).toContain("published by skillmaker-studio");
    expect(installed).toContain(`bundle: ${GOLDEN}`);
    expect(installed).toContain("evidence: 1 of 1 claims measured");

    // The shipped soft warning is an evidence line, not a warning field.
    // Publish an ungraded one-claim probe and lock that actual contract.
    const probeDir = join(workspace, "skills", GATE_PROBE);
    writeFileSync(join(probeDir, "output", "SKILL.md"), "# Ungraded Gate Probe\n");
    expect(runCli(["fixture", "add", GATE_PROBE, CASE, "--json"]).exitCode).toBe(0);
    const probeCase = join(probeDir, "evals", "fixtures", CASE, "case.json");
    const probeCaseJson = readJsonRecord(probeCase);
    probeCaseJson.risks = ["IN-1"];
    writeFileSync(probeCase, `${JSON.stringify(probeCaseJson, null, 2)}\n`);
    writeOneClaim(probeDir, CASE);
    expect(runCli(["advance", GATE_PROBE, "--to", "published", "--override", "--json"]).exitCode).toBe(0);
    expect(runCli(["version", "record", GATE_PROBE, "--json"]).exitCode).toBe(0);
    const ungradedPublish = runCli(["publish", GATE_PROBE, "--to", "project", "--json"]);
    expect(ungradedPublish.exitCode).toBe(0);
    expect(cliJson(ungradedPublish).evidence).toBe("0 of 1 claims measured");
    expect(readFileSync(join(workspace, ".claude", "skills", GATE_PROBE, "SKILL.md"), "utf8")).toContain(
      "evidence: 0 of 1 claims measured",
    );

    const belongsToGolden = (event: Record<string, unknown>): boolean => {
      const payload = event.payload;
      if (!isRecord(payload)) return false;
      if (payload.bundle === GOLDEN || payload.id === runId) return true;
      const eventRun = payload.run;
      return isRecord(eventRun) && eventRun.bundle === GOLDEN;
    };
    const goldenTypes = journalEvents()
      .filter(belongsToGolden)
      .map((event) => event.type);
    expect(goldenTypes).toEqual([
      "bundle.created",
      "review.requested",
      "review.resolved",
      "bundle.stage_changed",
      "review.requested",
      "review.resolved",
      "bundle.stage_changed",
      "review.requested",
      "review.resolved",
      "bundle.stage_changed",
      "skill.version_recorded",
      "run.started",
      "run.completed",
      "run.graded",
      "review.requested",
      "review.resolved",
      "bundle.gate_decided",
      "bundle.stage_changed",
      "skill.published",
    ]);
  }, 60_000);
});
