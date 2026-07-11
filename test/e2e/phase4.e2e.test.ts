/**
 * End-to-end: the "one contract, two doors" guarded state machine
 * (data-model.md §2.13, plan.md Phase 4). Spawns the real `skillmaker` CLI's
 * `start` command against a fresh workspace and drives the whole production
 * loop over HTTP against a real Bun.serve instance -- `POST /api/events`,
 * `GET /api/bundles/:slug` -- exactly as the viewer's runtime client would,
 * cross-checked against `skillmaker list --json` at each step.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
  const response = await fetch(`${baseUrl}/api/events`, {
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
  expect(runCli(["new", "gamma", "--json"], scratchDir).exitCode).toBe(0);

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

    const detail = await fetch(`${baseUrl}/api/bundles/gamma`);
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

  test("attempting to publish without an approved publish gate is rejected with 409", async () => {
    await requestAndApproveReview("gamma", "evaluating");

    const detail = await fetch(`${baseUrl}/api/bundles/gamma`);
    const detailBody = (await detail.json()) as {
      guardStatus: { approvedForForward: boolean; gateApproved: boolean };
    };
    expect(detailBody.guardStatus.approvedForForward).toBe(true);
    expect(detailBody.guardStatus.gateApproved).toBe(false);

    const publish = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "evaluating",
      to: "published",
    });
    expect(publish.status).toBe(409);
    expect(listStages().gamma).toBe("evaluating");
  });

  test("bundle.gate_decided(approved) then stage_changed publishes successfully", async () => {
    const gate = await postEvent("bundle.gate_decided", {
      bundle: "gamma",
      gate: "publish",
      decision: "approved",
      basis: "manually verified in e2e test",
    });
    expect(gate.status).toBe(200);

    const publish = await postEvent("bundle.stage_changed", {
      bundle: "gamma",
      from: "evaluating",
      to: "published",
    });
    expect(publish.status).toBe(200);
    expect(listStages().gamma).toBe("published");
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
    const response = await fetch(`${baseUrl}/api/bundles/gamma`);
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
    const response = await fetch(`${baseUrl}/api/bundles/does-not-exist`);
    expect(response.status).toBe(404);
  });
});
