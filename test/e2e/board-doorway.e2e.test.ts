/**
 * End-to-end: the Published column is a doorway, not a shelf (issue #82).
 * Spawns the real `skillmaker` CLI's `start` command against a fresh
 * workspace, walks a bundle through the guarded state machine to
 * `published` over HTTP exactly as `phase4.e2e.test.ts` does, then asserts
 * on the server-side contract that feeds the viewer's doorway: `GET
 * /api/bundles` carries `stageChangedAt`, it survives a `reindex`, and the
 * real (framework-free) `partitionDoorway` helper the Board actually
 * renders with -- imported straight from the viewer package, not
 * reimplemented here -- shows a fresh publish and elides an old one with
 * an exact count.
 *
 * There is no browser-level e2e harness in this repo (no playwright/jsdom
 * anywhere in the workspace): `boardDoorway.ts` is deliberately pure so its
 * visibility/boundary logic is unit-tested without React in
 * `packages/viewer/src/app/runtime/boardDoorway.test.ts`. This suite proves
 * the other half -- that the real server produces the timestamps that
 * helper depends on, and that a real "old publish" record from a live
 * journal does get elided by it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partitionDoorway } from "../../packages/viewer/src/app/runtime/boardDoorway.ts";
import type { BundleRecord } from "../../packages/viewer/src/app/runtime/schemas.ts";

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

/** Walks a freshly-created bundle from idea all the way to published via the real guarded contract (mirrors phase4.e2e.test.ts). */
const publishViaGuardedFlow = async (slug: string): Promise<void> => {
  await requestAndApproveReview(slug, "idea");
  expect((await postEvent("bundle.stage_changed", { bundle: slug, from: "idea", to: "researching" })).status).toBe(
    200,
  );
  await requestAndApproveReview(slug, "researching");
  expect(
    (await postEvent("bundle.stage_changed", { bundle: slug, from: "researching", to: "drafting" })).status,
  ).toBe(200);
  await requestAndApproveReview(slug, "drafting");
  expect((await postEvent("bundle.stage_changed", { bundle: slug, from: "drafting", to: "evaluating" })).status).toBe(
    200,
  );
  await requestAndApproveReview(slug, "evaluating");
  expect(
    (
      await postEvent("bundle.gate_decided", {
        bundle: slug,
        gate: "publish",
        decision: "approved",
        basis: "verified in e2e test",
      })
    ).status,
  ).toBe(200);
  expect(
    (await postEvent("bundle.stage_changed", { bundle: slug, from: "evaluating", to: "published" })).status,
  ).toBe(200);
};

const getBundles = async (): Promise<ReadonlyArray<BundleRecord>> => {
  const response = await fetch(`${baseUrl}/api/bundles`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { bundles: ReadonlyArray<BundleRecord> };
  return body.bundles;
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-board-doorway-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "kappa", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "lambda", "--json"], scratchDir).exitCode).toBe(0);

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

describe("issue #82: the Published column is a doorway, not a shelf", () => {
  test("publishing a bundle now stamps a fresh stageChangedAt", async () => {
    const before = Date.now();
    await publishViaGuardedFlow("kappa");
    const after = Date.now();

    const bundles = await getBundles();
    const kappa = bundles.find((b) => b.slug === "kappa");
    expect(kappa?.stage).toBe("published");
    expect(typeof kappa?.stageChangedAt).toBe("string");
    const stampedMs = Date.parse(kappa?.stageChangedAt as string);
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);
  });

  test("a publish backdated well outside the doorway window still shows on the Board via GET /api/bundles (nothing hidden from the journal)", async () => {
    // "lambda" was created via the real CLI (a legitimate bundle.created is
    // already in the journal with a "now" timestamp). Directly appending a
    // bundle.stage_changed line simulates a publish that actually happened
    // long ago -- the fold never rejects an event (guard enforcement lives
    // only in the HTTP handler), so this is a faithful way to get an "old"
    // stageChangedAt without waiting a week in a test.
    const journalPath = join(scratchDir, ".skillmaker", "events.jsonl");
    const oldAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const backdatedPublish = {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000082",
      at: oldAt,
      actor: { kind: "user", name: "e2e-backdate" },
      type: "bundle.stage_changed",
      payload: { bundle: "lambda", from: "idea", to: "published" },
    };
    appendFileSync(journalPath, `${JSON.stringify(backdatedPublish)}\n`);

    const bundles = await getBundles();
    const lambda = bundles.find((b) => b.slug === "lambda");
    // The bundle list itself is unfiltered -- deliberately not in this pass
    // (per the issue): nothing is hidden from the journal, the Lab, or the
    // bundle's own pages. Only the Board's Published column cards elide it,
    // client-side.
    expect(lambda?.stage).toBe("published");
    expect(lambda?.stageChangedAt).toBe(oldAt);
  });

  test("the real partitionDoorway helper shows the fresh publish and elides the old one, with an exact footer count", async () => {
    const bundles = await getBundles();
    const published = bundles.filter((b) => b.stage === "published");
    expect(published.map((b) => b.slug).sort()).toEqual(["kappa", "lambda"]);

    const { visible, elidedCount } = partitionDoorway(published, new Date());
    expect(visible.map((b) => b.slug)).toEqual(["kappa"]);
    expect(elidedCount).toBe(1);
  });

  test("reindex re-derives the same stageChangedAt for both the fresh and the backdated publish (no drift, no reset)", async () => {
    const before = await getBundles();
    const kappaBefore = before.find((b) => b.slug === "kappa")?.stageChangedAt;
    const lambdaBefore = before.find((b) => b.slug === "lambda")?.stageChangedAt;
    expect(typeof kappaBefore).toBe("string");
    expect(typeof lambdaBefore).toBe("string");

    const reindex = runCli(["reindex", "--json"], scratchDir);
    expect(reindex.exitCode).toBe(0);
    const reindexBody = JSON.parse(reindex.stdout) as { status: string };
    expect(reindexBody.status).toBe("reindexed");

    const after = await getBundles();
    expect(after.find((b) => b.slug === "kappa")?.stageChangedAt).toBe(kappaBefore as string);
    expect(after.find((b) => b.slug === "lambda")?.stageChangedAt).toBe(lambdaBefore as string);
  });

  test("sanity: the raw journal line for lambda's backdated publish really is on disk (not a fixture artifact)", () => {
    const journalPath = join(scratchDir, ".skillmaker", "events.jsonl");
    const lines = readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload: { bundle?: string; to?: string } });
    const lambdaPublishes = lines.filter(
      (e) => e.type === "bundle.stage_changed" && e.payload.bundle === "lambda" && e.payload.to === "published",
    );
    expect(lambdaPublishes.length).toBe(1);
  });
});
