/**
 * End-to-end: the "one contract, two doors" guarded state machine
 * (data-model.md §2.13, plan.md Phase 4). Spawns the real `skillmaker` CLI's
 * `start` command against a fresh workspace and drives the whole production
 * loop over HTTP against a real Bun.serve instance -- `POST /api/events`,
 * `GET /api/bundles/:slug` -- exactly as the viewer's runtime client would,
 * cross-checked against `skillmaker list --json` at each step.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let port: number;
let baseUrl: string;
let projectUrl: string;

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

interface BundleView {
  readonly slug: string;
  readonly stage: string;
  readonly substate: string;
  readonly archived: boolean;
}

const listStages = (): Record<string, string> => {
  const cliList = runCli(["list", "--json"], scratchDir);
  expect(cliList.exitCode).toBe(0);
  const bundles = (JSON.parse(cliList.stdout) as { bundles: ReadonlyArray<BundleView> }).bundles;
  const stages: Record<string, string> = {};
  for (const bundle of bundles) {
    stages[bundle.slug] = bundle.stage;
  }
  return stages;
};

const postEvent = async (
  type: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${projectUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
};

const requestAndApproveReview = async (slug: string, state: string): Promise<void> => {
  const requested = await postEvent("review.requested", { bundle: slug, state });
  expect(requested.status).toBe(200);
  const resolved = await postEvent("review.resolved", { bundle: slug, state, decision: "approve" });
  expect(resolved.status).toBe(200);
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase4-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  // Birth intent + stage artifacts up front: the ruled gate table (THE
  // MERGE, StageGates.ts) requires oneLiner for researching, design.md for
  // drafting (scaffolded non-empty by `new`), and output/SKILL.md for
  // evaluating. This suite is about the JOURNAL guards, so satisfy the
  // artifact gates once here.
  expect(
    runCli(["new", "gamma", "--one-liner", "Walks the guarded state machine.", "--json"], scratchDir).exitCode,
  ).toBe(0);
  writeFileSync(
    join(scratchDir, "skills", "gamma", "output", "SKILL.md"),
    "---\nname: gamma\ndescription: phase4 walker.\n---\n\nDo the gamma thing.\n",
  );

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  port = server.port;
  baseUrl = server.baseUrl;
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

describe("skillmaker CLI end-to-end: Phase 4 (guarded state machine over HTTP)", () => {
  test("POST of a non-allowlisted event type is rejected with 400", async () => {
    const result = await postEvent("bundle.created", { bundle: "gamma", name: "Gamma" });
    expect(result.status).toBe(400);
    expect(typeof result.body.error).toBe("string");
  });

  test("attempting to skip a stage (idea -> drafting) is rejected with 409 and a reason", async () => {
    const result = await postEvent("bundle.stage_changed", { bundle: "gamma", from: "idea", to: "drafting" });
    expect(result.status).toBe(409);
    expect(typeof result.body.error).toBe("string");
    expect(listStages().gamma).toBe("idea");
  });

  test("attempting idea -> researching without an approved review is rejected with 409", async () => {
    const result = await postEvent("bundle.stage_changed", { bundle: "gamma", from: "idea", to: "researching" });
    expect(result.status).toBe(409);
    expect(listStages().gamma).toBe("idea");
  });

  test("review.requested then review.resolved(approve) unblocks the forward transition", async () => {
    await requestAndApproveReview("gamma", "idea");

    const detail = await fetch(`${projectUrl}/bundles/gamma`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { guardStatus: { approvedForForward: boolean } };
    expect(detailBody.guardStatus.approvedForForward).toBe(true);

    const advance = await postEvent("bundle.stage_changed", { bundle: "gamma", from: "idea", to: "researching" });
    expect(advance.status).toBe(200);
    expect(listStages().gamma).toBe("researching");
  });

  test("attempting the next forward transition without a fresh review is rejected with 409", async () => {
    const result = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "researching",
      to: "drafting",
    });
    expect(result.status).toBe(409);
    expect(listStages().gamma).toBe("researching");
  });

  test("walking review -> approve -> advance up through evaluating", async () => {
    await requestAndApproveReview("gamma", "researching");
    const toDrafting = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "researching",
      to: "drafting",
    });
    expect(toDrafting.status).toBe(200);
    expect(listStages().gamma).toBe("drafting");

    await requestAndApproveReview("gamma", "drafting");
    const toEvaluating = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "drafting",
      to: "evaluating",
    });
    expect(toEvaluating.status).toBe(200);
    expect(listStages().gamma).toBe("evaluating");
  });

  test("the publish gate is SOFT (ruled 2026-08-11): an unmeasured publish succeeds with the 'publishing unmeasured' warning -- no gate_decided required", async () => {
    await requestAndApproveReview("gamma", "evaluating");

    const detail = await fetch(`${projectUrl}/bundles/gamma`);
    const detailBody = (await detail.json()) as {
      guardStatus: { approvedForForward: boolean; gateApproved: boolean };
    };
    expect(detailBody.guardStatus.approvedForForward).toBe(true);
    // gate_decided events are still reportable facts, but no longer guards.
    expect(detailBody.guardStatus.gateApproved).toBe(false);

    const publish = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "evaluating",
      to: "published",
    });
    expect(publish.status).toBe(200);
    const warnings = publish.body.warnings;
    expect(Array.isArray(warnings)).toBe(true);
    expect(String((warnings as unknown[])[0])).toContain("publishing unmeasured");
    expect(listStages().gamma).toBe("published");
  });

  test("bundle.gate_decided remains a recordable fact (200), just not a gate", async () => {
    const gate = await postEvent("bundle.gate_decided", {
      bundle: "gamma",
      gate: "publish",
      decision: "approved",
      basis: "manually verified in e2e test",
    });
    expect(gate.status).toBe(200);
  });

  test("moving back to drafting with a reason succeeds", async () => {
    const moveBack = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "published",
      to: "drafting",
      reason: "found a factual error after publishing",
    });
    expect(moveBack.status).toBe(200);
    expect(listStages().gamma).toBe("drafting");
  });

  test("moving back without a reason is rejected with 409", async () => {
    const result = await postEvent("bundle.stage_changed", { bundle: "gamma", from: "drafting", to: "idea" });
    expect(result.status).toBe(409);
    expect(listStages().gamma).toBe("drafting");
  });

  test("review.resolved is rejected with 409 when the bundle is not awaiting review", async () => {
    const result = await postEvent("review.resolved", { bundle: "gamma", state: "drafting", decision: "approve" });
    expect(result.status).toBe(409);
  });

  test("GET /api/bundles/:slug returns bundle + guardStatus + recent events", async () => {
    const response = await fetch(`${projectUrl}/bundles/gamma`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      bundle: BundleView;
      guardStatus: { stage: string };
      events: ReadonlyArray<{ type: string }>;
    };
    expect(body.bundle.slug).toBe("gamma");
    expect(body.guardStatus.stage).toBe("drafting");
    expect(body.events.length).toBeGreaterThan(0);
  });

  test("GET /api/bundles/:slug for an unknown bundle is a 404", async () => {
    const response = await fetch(`${projectUrl}/bundles/does-not-exist`);
    expect(response.status).toBe(404);
  });
});
