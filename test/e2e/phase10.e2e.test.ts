/**
 * End-to-end: agent stations + the review-pair loop, mocked (data-model.md
 * §2.13, plan.md Phase 10). Drives the real `skillmaker` CLI's
 * `station run` command against a prompt-aware fake ACP adapter
 * (`test/e2e/fixtures/fake-acp-station.cjs`) -- no real LLM call, CI-safe,
 * requires no auth.
 *
 * Covers: station run -> produces-filtered copyback -> `review.requested`
 * appended -> bundle awaiting-review -> `review.resolved` (revise) -> the
 * NEXT station run includes the revise notes in its prompt -> `advance` is
 * still guard-blocked (no approval yet) -> `review.resolved` (approve) ->
 * `advance` unlocks.
 *
 * The guarded REAL e2e (against the real `claude-code-acp` adapter, driving
 * William's actual `william-draft-skill-md` skill) lives in
 * `test/e2e/phase10-real.e2e.test.ts`, gated on `SKILLMAKER_REAL_ACP=1`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterStation = join(import.meta.dir, "fixtures", "fake-acp-station.cjs");

let scratchDir: string;
let bundleDir: string;
let skillBundleDir: string;
let capturePromptPath: string;

const runCli = (args: ReadonlyArray<string>, cwd: string, env?: Record<string, string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const setProviderCommand = (command: ReadonlyArray<string>): void => {
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

const jsonFrom = <T>(result: ReturnType<typeof runCli>): T | undefined => {
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of stream.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // not the JSON line; keep scanning
      }
    }
  }
  return undefined;
};

interface StationRunOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly bundle: string;
  readonly state: string;
  readonly skill: string;
  readonly runId: string;
  readonly model: string | null;
  readonly changedPaths: ReadonlyArray<string>;
  readonly reviewRequested: boolean;
}

const cliStationRun = (slug: string, env?: Record<string, string>) => {
  const result = runCli(["station", "run", slug, "--provider", "claude-code", "--json"], scratchDir, env);
  return { result, json: jsonFrom<StationRunOutput>(result) };
};

const postEvent = async (body: unknown): Promise<{ status: number; body: unknown }> => {
  // Exercises the server-mediated `POST /api/events` path (Server.ts) --
  // one of the two doors onto `review.resolved`. The other is the
  // `skillmaker review resolve` CLI subcommand (ReviewResolve.ts), covered
  // by test/e2e/phase20-story4-review-resolve.e2e.test.ts.
  const port = 24000 + Math.floor(Math.random() * 8000);
  const baseUrl = `http://localhost:${port}`;
  const serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const health = await fetch(`${baseUrl}/api/health`);
        if (health.ok) break;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as unknown;
    return { status: response.status, body: parsed };
  } finally {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
};

interface BundleStatus {
  readonly stage: string;
  readonly substate: string;
}

const cliBundleStatus = (slug: string): BundleStatus => {
  const result = runCli(["status", slug, "--json"], scratchDir);
  const parsed = jsonFrom<{ stage: string; substate: string }>(result);
  return { stage: parsed?.stage ?? "unknown", substate: parsed?.substate ?? "unknown" };
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase10-"));
  capturePromptPath = join(scratchDir, "captured-prompt.txt");
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);

  // The station's skill: a bundle in the SAME workspace whose output/ gets
  // installed into the sandbox. Its own content doesn't matter here -- the
  // fake adapter does the "work" -- only that it exists with an output/.
  expect(runCli(["new", "fake-station-skill", "--json"], scratchDir).exitCode).toBe(0);
  skillBundleDir = join(scratchDir, "skills", "fake-station-skill");
  writeFileSync(
    join(skillBundleDir, "output", "SKILL.md"),
    "---\nname: fake-station-skill\ndescription: test-only stand-in for william-draft-skill-md.\n---\n\nDo the thing.\n",
  );

  // The bundle under production. Advance it to "drafting" via --override so
  // this test exercises the station/review machinery, not the full ladder.
  expect(runCli(["new", "example-skill", "--json"], scratchDir).exitCode).toBe(0);
  bundleDir = join(scratchDir, "skills", "example-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Example Skill\n\nInitial design notes.\n");

  // Point the bundle's drafting station at our fake skill bundle.
  const stationsPath = join(bundleDir, "stations.json");
  const stations = JSON.parse(readFileSync(stationsPath, "utf8")) as {
    stations: Record<string, { skill?: string }>;
  };
  const drafting = stations.stations.drafting;
  if (drafting !== undefined) drafting.skill = "fake-station-skill";
  writeFileSync(stationsPath, `${JSON.stringify(stations, null, 2)}\n`);

  expect(
    runCli(["advance", "example-skill", "--to", "researching", "--override", "--json"], scratchDir).exitCode,
  ).toBe(0);
  expect(
    runCli(["advance", "example-skill", "--to", "drafting", "--override", "--json"], scratchDir).exitCode,
  ).toBe(0);

  setProviderCommand(["node", fakeAdapterStation]);
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker station run: the drafting station, mocked", () => {
  let firstRunOutput: StationRunOutput | undefined;

  test("`skillmaker station run` completes and reports the resolved skill + changed paths", () => {
    const { result, json } = cliStationRun("example-skill");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("completed");
    expect(json?.state).toBe("drafting");
    expect(json?.skill).toBe("fake-station-skill");
    expect(json?.changedPaths).toContain("design.md");
    expect(json?.changedPaths).toContain("output/SKILL.md");
    expect(json?.reviewRequested).toBe(true);
    firstRunOutput = json;
  });

  test("produces-listed files are copied back into the bundle dir, nothing else", () => {
    expect(readFileSync(join(bundleDir, "design.md"), "utf8")).toContain("Fake Design");
    expect(existsSync(join(bundleDir, "output", "SKILL.md"))).toBe(true);
    const skillContent = readFileSync(join(bundleDir, "output", "SKILL.md"), "utf8");
    expect(skillContent).toContain("Initial draft, no revise notes.");
  });

  test("run.json, transcript.jsonl, and artifacts/ land under the bundle's runs/ dir, kind=station", () => {
    expect(firstRunOutput?.runId).toBeDefined();
    const runDir = join(bundleDir, "runs", String(firstRunOutput?.runId));
    expect(existsSync(join(runDir, "run.json"))).toBe(true);
    expect(existsSync(join(runDir, "transcript.jsonl"))).toBe(true);
    const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as {
      readonly kind: string;
      readonly station: string | null;
      readonly status: string;
    };
    expect(runRecord.kind).toBe("station");
    expect(runRecord.station).toBe("drafting");
    expect(runRecord.status).toBe("completed");
  });

  test("the journal recorded station.started, run events, and review.requested; the bundle is now awaiting-review", () => {
    const journalPath = join(scratchDir, ".skillmaker", "events.jsonl");
    const events = readFileSync(journalPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: Record<string, unknown> });
    expect(events.some((e) => e.type === "station.started" && e.payload.state === "drafting")).toBe(true);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    const reviewRequested = events.filter((e) => e.type === "review.requested");
    expect(reviewRequested.length).toBe(1);
    expect(reviewRequested[0]?.payload.artifacts).toContain("design.md");

    const status = cliBundleStatus("example-skill");
    expect(status.stage).toBe("drafting");
    expect(status.substate).toBe("awaiting-review");
  });

  test("advance is still guard-blocked -- no approved review yet", () => {
    const result = runCli(
      ["advance", "example-skill", "--to", "evaluating", "--json"],
      scratchDir,
    );
    expect(result.exitCode).toBe(1);
  });
});

describe("the review-pair loop: revise carries notes into the next station run", () => {
  test("review.resolved (revise) is accepted by the server and returns the bundle to working", async () => {
    const { status, body } = await postEvent({
      type: "review.resolved",
      payload: {
        bundle: "example-skill",
        state: "drafting",
        decision: "revise",
        notes: "Tighten the description -- name the exact trigger phrase.",
      },
    });
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe("appended");

    const statusAfter = cliBundleStatus("example-skill");
    expect(statusAfter.stage).toBe("drafting");
    expect(statusAfter.substate).toBe("working");
  });

  test("the NEXT `station run` includes the revise notes in the prompt sent to the adapter", () => {
    const { result, json } = cliStationRun("example-skill", {
      FAKE_ACP_CAPTURE_PROMPT_TO: capturePromptPath,
    });
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("completed");

    const capturedPrompt = readFileSync(capturePromptPath, "utf8");
    expect(capturedPrompt).toContain("REVISE NOTES:");
    expect(capturedPrompt).toContain("Tighten the description -- name the exact trigger phrase.");

    // The fake adapter also folds the notes into the written SKILL.md, a
    // second, independent signal that the notes actually reached the run.
    const skillContent = readFileSync(join(bundleDir, "output", "SKILL.md"), "utf8");
    expect(skillContent).toContain("Revised per notes: Tighten the description");
  });

  test("the bundle is awaiting-review again after the revised run", () => {
    const status = cliBundleStatus("example-skill");
    expect(status.stage).toBe("drafting");
    expect(status.substate).toBe("awaiting-review");
  });

  test("review.resolved (approve) satisfies the forward guard, and `advance` now succeeds", async () => {
    const { status } = await postEvent({
      type: "review.resolved",
      payload: { bundle: "example-skill", state: "drafting", decision: "approve" },
    });
    expect(status).toBe(200);

    const statusAfter = cliBundleStatus("example-skill");
    expect(statusAfter.substate).toBe("working");

    const advanced = runCli(["advance", "example-skill", "--to", "evaluating", "--json"], scratchDir);
    expect(advanced.exitCode).toBe(0);

    const final = cliBundleStatus("example-skill");
    expect(final.stage).toBe("evaluating");
  });
});
