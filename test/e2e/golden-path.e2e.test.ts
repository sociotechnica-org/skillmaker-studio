/**
 * The golden path, walked end-to-end against the shipped product seams --
 * updated for THE MERGE write-side tranche (2026-08-11): the ruled gates
 * are LIVE, so the former GATE-PENDING assertions are now real refusal /
 * soft-warn assertions:
 *
 * - Bundles are born as skill.json (schemaVersion 2) -- no bundle.json.
 * - idea -> researching HARD-refuses without birth intent (name + oneLiner).
 * - researching -> drafting HARD-refuses without a non-empty design.md.
 * - drafting -> evaluating HARD-refuses without output/SKILL.md.
 * - evaluating -> published is SOFT: no `bundle.gate_decided` required
 *   anymore; an unmeasured bundle gets the "publishing unmeasured" warning
 *   and goes through anyway.
 * - Claims are written through the `claims add` door; cases through
 *   `case add` (the `fixture add` alias' ruled vocabulary), which refuses
 *   dangling `--risks` ids and wires the hypothesis->case edge.
 * - Stage transitions write skill.json.stage (file = record) and append
 *   the journal event (liveness) -- asserted on the file after each move.
 *
 * Station execution stays canned direct writes (agent behavior has its own
 * e2e coverage); a fake ACP adapter makes `run` deterministic. Install
 * publishing keeps the honest evidence stamp ("N of M claims measured").
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

/** The declared stage in a bundle's skill.json -- the file-is-record fact the doors now write. */
const declaredStage = (bundleDir: string): unknown => {
  const skill = readJsonRecord(join(bundleDir, "skill.json")).skill;
  if (!isRecord(skill)) throw new Error("skill.json has no skill section");
  return skill.stage;
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

/** One claim through the ruled CLI door -- lands in skill.json's design.failureHypotheses. */
const addOneClaim = (bundle: string): void => {
  const added = runCli([
    "claims",
    "add",
    bundle,
    "--id",
    "IN-1",
    "--failure",
    "The skill ignores the requested format",
    "--must-never",
    "The skill must honor the requested format.",
    "--probability",
    "Medium",
    "--impact",
    "High",
    "--json",
  ]);
  expect(added.exitCode).toBe(0);
  expect(cliJson(added).status).toBe("added");
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
  test("walks every shipped seam, gates live, and records the complete journal story", async () => {
    const created = await post("/bundles", {
      slug: GOLDEN,
      name: "Golden Path Skill",
      oneLiner: "Turn a request into a deterministic golden-path result.",
    });
    expect(created.status).toBe(201);

    // Born migrated: skill.json (schemaVersion 2), no legacy bundle.json.
    const bundleDir = join(workspace, "skills", GOLDEN);
    expect(existsSync(join(bundleDir, "bundle.json"))).toBe(false);
    const skillJson = readJsonRecord(join(bundleDir, "skill.json"));
    expect(skillJson.schemaVersion).toBe(2);
    const identity = skillJson.skill;
    if (!isRecord(identity)) throw new Error("skill.json has no skill section");
    expect(identity.name).toBe("Golden Path Skill");
    expect(identity.oneLiner).toBe("Turn a request into a deterministic golden-path result.");
    expect(identity.stage).toBe("idea");

    // GATE LIVE (ruled table): idea -> researching HARD-refuses an empty
    // birth intent -- "how else will you research."
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
    const birthRefusal = await advanceHttp(GATE_PROBE, "idea", "researching");
    expect(birthRefusal.status).toBe(409);
    expect(isRecord(birthRefusal.body) && String(birthRefusal.body.error)).toContain("birth intent");
    expect(declaredStage(join(workspace, "skills", GATE_PROBE))).toBe("idea");

    await approve(GOLDEN, "idea");
    expect((await advanceHttp(GOLDEN, "idea", "researching")).status).toBe(200);
    // File = record: the door wrote the declared stage before the event.
    expect(declaredStage(bundleDir)).toBe("researching");

    // Artifacts are canned because this test owns product seams, not agent
    // quality. The dedicated station e2e owns fake-agent copyback behavior.
    unlinkSync(join(bundleDir, "design.md"));
    mkdirSync(join(bundleDir, "research"), { recursive: true });
    writeFileSync(join(bundleDir, "research", "notes.md"), "# Research\n\nA deterministic product-flow note.\n");
    expect(existsSync(join(bundleDir, "research", "notes.md"))).toBe(true);

    await approve(GOLDEN, "researching");
    // GATE LIVE (ruled table): researching -> drafting HARD-refuses while
    // design.md is absent, even with the review approved.
    expect(existsSync(join(bundleDir, "design.md"))).toBe(false);
    const designRefusal = await advanceHttp(GOLDEN, "researching", "drafting");
    expect(designRefusal.status).toBe(409);
    expect(isRecord(designRefusal.body) && String(designRefusal.body.error)).toContain("design.md");
    expect(declaredStage(bundleDir)).toBe("researching");
    writeFileSync(join(bundleDir, "design.md"), "# Golden Path Skill\n\n## Intent\n\nExercise every product seam.\n");
    expect((await advanceHttp(GOLDEN, "researching", "drafting")).status).toBe(200);
    expect(declaredStage(bundleDir)).toBe("drafting");

    await approve(GOLDEN, "drafting");
    // GATE LIVE (ruled table): drafting -> evaluating HARD-refuses without
    // output/SKILL.md. Derived readiness says the same thing continuously.
    expect(existsSync(join(bundleDir, "output", "SKILL.md"))).toBe(false);
    const draftRefusal = await advanceHttp(GOLDEN, "drafting", "evaluating");
    expect(draftRefusal.status).toBe(409);
    expect(isRecord(draftRefusal.body) && String(draftRefusal.body.error)).toContain("output/SKILL.md");
    const notReadyDetail = await fetch(`${projectUrl}/bundles/${GOLDEN}`);
    expect(notReadyDetail.status).toBe(200);
    const notReadyBody: unknown = await notReadyDetail.json();
    if (!isRecord(notReadyBody) || !isRecord(notReadyBody.readiness)) {
      throw new Error("bundle detail carried no readiness");
    }
    expect(notReadyBody.readiness).toMatchObject({ to: "evaluating", gate: "hard", ready: false });
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      "---\nname: golden-path-skill\ndescription: Exercises the complete product flow.\n---\n\nReturn the requested result.\n",
    );
    expect((await advanceHttp(GOLDEN, "drafting", "evaluating")).status).toBe(200);
    expect(declaredStage(bundleDir)).toBe("evaluating");

    // Claims through the ruled door -- skill.json's design layer.
    addOneClaim(GOLDEN);
    const withClaim = readJsonRecord(join(bundleDir, "skill.json"));
    const design = withClaim.design;
    if (!isRecord(design) || !Array.isArray(design.failureHypotheses)) {
      throw new Error("skill.json has no design.failureHypotheses");
    }
    expect(design.failureHypotheses).toHaveLength(1);

    // GATE LIVE (write door): a dangling --risks id is a clean refusal.
    const dangling = runCli(["case", "add", GOLDEN, CASE, "--risks", "RE-9", "--json"]);
    expect(dangling.exitCode).not.toBe(0);
    expect(dangling.stdout + dangling.stderr).toContain("RE-9");

    // The `case add` alias (ruled vocabulary) writes skill.json + evals/cases/.
    const fixture = runCli(["case", "add", GOLDEN, CASE, "--risks", "IN-1", "--json"]);
    expect(fixture.exitCode).toBe(0);
    expect(cliJson(fixture).status).toBe("created");
    const caseDir = join(bundleDir, "evals", "cases", CASE);
    expect(existsSync(join(caseDir, "expected.md"))).toBe(true);
    expect(existsSync(join(caseDir, "case.json"))).toBe(false);
    writeFileSync(join(caseDir, "prompt.md"), "Return the golden-path result.\n");
    const wired = readJsonRecord(join(bundleDir, "skill.json"));
    const wiredDesign = wired.design;
    const wiredEvals = wired.evals;
    if (!isRecord(wiredDesign) || !Array.isArray(wiredDesign.failureHypotheses)) {
      throw new Error("skill.json lost design.failureHypotheses");
    }
    if (!isRecord(wiredEvals) || !Array.isArray(wiredEvals.cases)) {
      throw new Error("skill.json has no evals.cases");
    }
    const hypothesis = wiredDesign.failureHypotheses[0];
    expect(isRecord(hypothesis) && hypothesis.cases).toEqual([CASE]);
    const caseEntry = wiredEvals.cases[0];
    expect(isRecord(caseEntry) && caseEntry.name).toBe(CASE);
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
    // GATE LIVE (soft, replacing the old hard guard): no bundle.gate_decided
    // needed anymore -- a measured bundle publishes straight through, with
    // no warning (it has a graded realized case).
    const published = await advanceHttp(GOLDEN, "evaluating", "published");
    expect(published.status).toBe(200);
    expect(isRecord(published.body) && published.body.warnings).toBeUndefined();
    expect(declaredStage(bundleDir)).toBe("published");

    const installed0 = runCli(["publish", GOLDEN, "--to", "project", "--json"]);
    expect(installed0.exitCode).toBe(0);
    expect(cliJson(installed0).evidence).toBe("1 of 1 claims measured");
    const installedSkill = join(workspace, ".claude", "skills", GOLDEN, "SKILL.md");
    expect(existsSync(installedSkill)).toBe(true);
    const installed = readFileSync(installedSkill, "utf8");
    expect(installed).toContain("published by skillmaker-studio");
    expect(installed).toContain(`bundle: ${GOLDEN}`);
    expect(installed).toContain("evidence: 1 of 1 claims measured");

    // The soft gate's warning, on the honest path: the probe reaches
    // evaluating via an override (journaled escape hatch, gates bypassed),
    // then walks the guarded door to published with a claim + case but NO
    // graded run -- the ruled outcome is a 200 WITH "publishing unmeasured".
    const probeDir = join(workspace, "skills", GATE_PROBE);
    writeFileSync(join(probeDir, "output", "SKILL.md"), "# Ungraded Gate Probe\n");
    addOneClaim(GATE_PROBE);
    expect(runCli(["case", "add", GATE_PROBE, CASE, "--risks", "IN-1", "--json"]).exitCode).toBe(0);
    const overridden = runCli(["advance", GATE_PROBE, "--to", "evaluating", "--override", "--json"]);
    expect(overridden.exitCode).toBe(0);
    expect(declaredStage(probeDir)).toBe("evaluating");
    await approve(GATE_PROBE, "evaluating");
    const softPublish = await advanceHttp(GATE_PROBE, "evaluating", "published");
    expect(softPublish.status).toBe(200);
    if (!isRecord(softPublish.body) || !Array.isArray(softPublish.body.warnings)) {
      throw new Error("soft publish carried no warnings array");
    }
    expect(String(softPublish.body.warnings[0])).toContain("publishing unmeasured");
    expect(declaredStage(probeDir)).toBe("published");

    // The install door keeps its honest evidence stamp for ungraded claims.
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
    // NOTE: no bundle.gate_decided anywhere -- the hard publish gate is gone.
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
      "bundle.stage_changed",
      "skill.published",
    ]);
  }, 60_000);
});
