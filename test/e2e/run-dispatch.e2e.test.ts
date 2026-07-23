/**
 * End-to-end: server-side fixture-run dispatch (run / run-all / runs-active)
 * over the real server, against `fixtures/fake-acp-gated.cjs` -- an adapter
 * whose `session/prompt` blocks until a gate file exists, so "a run in
 * progress" is a deterministic state, not a race. Covers:
 *
 *   - POST /api/bundles/:slug/run: 404 unknown bundle/fixture, 409 no
 *     prompt.md, 202 {runId, status:"running"} dispatch
 *   - the (slug, fixture) duplicate guard's 409 while a run is in flight
 *   - the concurrency cap (2): a third dispatch queues (`queued: true`)
 *   - GET runs-active: running/queued entries + emptiness after completion
 *   - runs land through the SAME engine path as the CLI: run.json +
 *     run.started/run.completed journal events
 *   - POST run-all: 202 {accepted, total, fixtures}, sequential (one active
 *     at a time) in fixture order, `runAll` progress on runs-active, 409
 *     while a sweep is already in flight
 *
 * No real LLM call -- CI-safe, no auth required.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer, type StartedE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeGatedAdapter = join(import.meta.dir, "fixtures", "fake-acp-gated.cjs");

const SKILL = "example-skill";
const FIXTURES = ["alpha", "bravo", "charlie"] as const;

let scratchDir: string;
let gateFile: string;
let server: StartedE2eServer;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const getJson = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const postJson = async (path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

interface ActiveEntry {
  readonly runId: string;
  readonly fixture: string;
  readonly startedAt: string;
  readonly state: "running" | "queued";
}

interface RunsActiveBody {
  readonly active: ReadonlyArray<ActiveEntry>;
  readonly runAll: { readonly completed: number; readonly total: number } | null;
}

const runsActive = async (): Promise<RunsActiveBody> =>
  (await getJson(`/api/bundles/${SKILL}/runs-active`)).body as unknown as RunsActiveBody;

const waitFor = async <T>(probe: () => Promise<T | undefined>, what: string, timeoutMs = 60_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const journalEvents = (): ReadonlyArray<{ type: string; payload: Record<string, unknown> }> =>
  readFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });

const openGate = () => writeFileSync(gateFile, "open\n");
const closeGate = () => {
  if (existsSync(gateFile)) unlinkSync(gateFile);
};

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-run-dispatch-"));
  gateFile = join(scratchDir, "the-gate");
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", SKILL, "--json"], scratchDir).exitCode).toBe(0);

  const bundleDir = join(scratchDir, "skills", SKILL);
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Example Skill\n\nDoes a thing.\n");
  for (const fixture of FIXTURES) {
    expect(runCli(["fixture", "add", SKILL, fixture, "--json"], scratchDir).exitCode).toBe(0);
    writeFileSync(join(bundleDir, "evals", "fixtures", fixture, "prompt.md"), `Do the ${fixture} thing.\n`);
  }
  // A fixture with case.json but NO prompt.md -- the 409 precheck case.
  expect(runCli(["fixture", "add", SKILL, "no-prompt", "--json"], scratchDir).exitCode).toBe(0);
  unlinkSync(join(bundleDir, "evals", "fixtures", "no-prompt", "prompt.md"));

  // Point the claude-code provider at the gate-controlled fake adapter.
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command: ["node", fakeGatedAdapter, gateFile] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  baseUrl = server.baseUrl;
}, 90_000);

afterAll(() => {
  server?.process.kill();
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("run dispatch (POST run / runs-active)", () => {
  test("validation: unknown bundle 404, unknown fixture 404, missing prompt.md 409, missing fixture field 400, unknown provider 400", async () => {
    expect((await postJson("/api/bundles/nope/run", { fixture: "alpha" })).status).toBe(404);
    expect((await postJson(`/api/bundles/${SKILL}/run`, { fixture: "ghost" })).status).toBe(404);
    expect((await postJson(`/api/bundles/${SKILL}/run`, { fixture: "no-prompt" })).status).toBe(409);
    expect((await postJson(`/api/bundles/${SKILL}/run`, {})).status).toBe(400);
    expect((await postJson(`/api/bundles/${SKILL}/run`, { fixture: "alpha", provider: "ghost" })).status).toBe(400);
  });

  test("dispatch, 409 duplicate guard, cap-2 queueing, completion via the real engine", async () => {
    closeGate();

    // First run: accepted immediately, running.
    const first = await postJson(`/api/bundles/${SKILL}/run`, { fixture: "alpha" });
    expect(first.status).toBe(202);
    expect(first.body.status).toBe("running");
    expect(first.body.queued).toBe(false);
    const alphaRunId = first.body.runId as string;
    expect(typeof alphaRunId).toBe("string");

    // Duplicate (slug, fixture) while in flight: 409.
    expect((await postJson(`/api/bundles/${SKILL}/run`, { fixture: "alpha" })).status).toBe(409);

    // Second fixture takes the second slot; third queues (cap 2).
    const second = await postJson(`/api/bundles/${SKILL}/run`, { fixture: "bravo" });
    expect(second.status).toBe(202);
    expect(second.body.queued).toBe(false);
    const third = await postJson(`/api/bundles/${SKILL}/run`, { fixture: "charlie" });
    expect(third.status).toBe(202);
    expect(third.body.queued).toBe(true);

    const active = await runsActive();
    expect(active.runAll).toBeNull();
    expect(active.active.map((entry) => [entry.fixture, entry.state])).toEqual([
      ["alpha", "running"],
      ["bravo", "running"],
      ["charlie", "queued"],
    ]);

    // Release the gate: all three complete; the guard frees itself.
    openGate();
    await waitFor(async () => ((await runsActive()).active.length === 0 ? true : undefined), "all runs to drain");

    // Same engine path as the CLI: run.json persisted, journal carries
    // run.started + run.completed for each fixture.
    const runsDir = join(scratchDir, "skills", SKILL, "runs");
    const runDirs = readdirSync(runsDir).filter((name) => !name.startsWith("."));
    expect(runDirs).toContain(alphaRunId);
    for (const runId of runDirs) {
      const runJson = JSON.parse(readFileSync(join(runsDir, runId, "run.json"), "utf8")) as { status: string };
      expect(runJson.status).toBe("completed");
    }
    const events = journalEvents();
    const started = events.filter((event) => event.type === "run.started");
    const completed = events.filter((event) => event.type === "run.completed");
    expect(started.length).toBe(3);
    expect(completed.length).toBe(3);
    expect(completed.every((event) => event.payload["status"] === "completed")).toBe(true);
  });
});

describe("run-all (sequential sweep)", () => {
  test("202 up front, one-at-a-time in fixture order, runAll progress, 409 while sweeping, drains clean", async () => {
    closeGate();
    const eventsBefore = journalEvents().length;

    const accepted = await postJson(`/api/bundles/${SKILL}/run-all`, {});
    expect(accepted.status).toBe(202);
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.body.total).toBe(3);
    expect(accepted.body.fixtures).toEqual(["alpha", "bravo", "charlie"]);

    // A second sweep -- and any single dispatch of a busy fixture -- is a 409.
    expect((await postJson(`/api/bundles/${SKILL}/run-all`, {})).status).toBe(409);

    // Sequential: exactly ONE active run at a time even though the cap is 2.
    const firstActive = await waitFor(async () => {
      const status = await runsActive();
      return status.active.length > 0 ? status : undefined;
    }, "the sweep's first run to start");
    expect(firstActive.active.length).toBe(1);
    expect(firstActive.active[0]?.fixture).toBe("alpha");
    expect(firstActive.runAll).toEqual({ completed: 0, total: 3 });

    // Release the gate: the sweep proceeds through the rest and drains.
    openGate();
    await waitFor(async () => {
      const status = await runsActive();
      return status.active.length === 0 && status.runAll === null ? true : undefined;
    }, "the sweep to drain");

    // Journal: three more run.started, in fixture order, all completed.
    const swept = journalEvents().slice(eventsBefore);
    const startedOrder = swept
      .filter((event) => event.type === "run.started")
      .map((event) => (event.payload["run"] as { fixtureCase: string }).fixtureCase);
    expect(startedOrder).toEqual(["alpha", "bravo", "charlie"]);
    expect(swept.filter((event) => event.type === "run.completed").length).toBe(3);
  });
});
