/**
 * End-to-end: the read-out -- human grading + measurements (data-model.md
 * §2.9, §2.11, §2.12; plan.md Phase 9). Mocked like phase8: the real
 * `skillmaker` CLI against fake ACP adapters (no LLM, CI-safe), covering:
 *
 *   run -> grade -> measurements 1/1 -> REGRADE as fail (latest wins: the
 *   regrade replaces the run's verdict, it is not a second sample) -> k=3
 *   loop all-pass (n=3, passRate 1.0, Wilson CI ~[43.8%, 100%] -- the
 *   tighter of rule-of-three/Wilson at 0 failures) -> grading a
 *   non-completed run refused (CLI exit 1 AND server 409) -> version bump
 *   resets measurements honestly (no cell for the new hash).
 *
 * Plus the Phase 9 server surface: run detail (transcript/artifacts/grading
 * history/checks), the artifact file allowlist + traversal guard, and the
 * non-blocking run-trigger endpoint.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");
const fakeAdapterSuccess = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");
const fakeAdapterInfraFail = join(import.meta.dir, "fixtures", "fake-acp-infra-fail.cjs");

let scratchDir: string;
let bundleDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
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

/** Scans stdout then stderr for the command's final JSON line (see phase8). */
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

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly runId: string;
  readonly skillVersionHash: string;
}

const cliRun = (slug: string, fixtureCase: string) => {
  const result = runCli(
    ["run", slug, "--fixture", fixtureCase, "--provider", "claude-code", "--json"],
    scratchDir,
  );
  return { result, json: jsonFrom<RunCliOutput>(result) };
};

const cliGrade = (slug: string, runId: string, verdict: string, notes?: string) =>
  runCli(
    [
      "grade",
      slug,
      runId,
      "--verdict",
      verdict,
      ...(notes !== undefined ? ["--notes", notes] : []),
      "--json",
    ],
    scratchDir,
  );

interface MeasurementCell {
  readonly fixtureCase: string;
  readonly versionHash: string;
  readonly provider: string;
  readonly model: string;
  readonly n: number;
  readonly passes: number;
  readonly passRate: number;
  readonly ci: readonly [number, number] | null;
  readonly guidance: string | null;
}

const cliMeasurements = (slug: string): ReadonlyArray<MeasurementCell> => {
  const result = runCli(["measurements", slug, "--json"], scratchDir);
  expect(result.exitCode).toBe(0);
  const parsed = jsonFrom<{ measurements: ReadonlyArray<MeasurementCell> }>(result);
  expect(parsed).toBeDefined();
  return parsed?.measurements ?? [];
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase9-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "graded-skill", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "graded-skill");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Graded Skill\n\nv1.\n");

  expect(runCli(["fixture", "add", "graded-skill", "golden-basic", "--json"], scratchDir).exitCode).toBe(0);
  writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");

  // Author grading.checks on the fixture -- the checklist the grading
  // panel/history carries (data-model.md §2.5, §2.9).
  const caseJsonPath = join(bundleDir, "evals", "fixtures", "golden-basic", "case.json");
  const caseJson = JSON.parse(readFileSync(caseJsonPath, "utf8")) as Record<string, unknown>;
  caseJson.grading = { checks: ["output file exists", "content is on-topic"] };
  writeFileSync(caseJsonPath, `${JSON.stringify(caseJson, null, 2)}\n`);
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

let firstRunId: string;
let firstVersionHash: string;
let infraRunId: string;

describe("grade + measurements: the CLI door", () => {
  test("a completed run grades pass; measurements shows 1/1 with the tighter-of-rule-of-three/Wilson CI", () => {
    setProviderCommand(["node", fakeAdapterSuccess]);
    const { result, json } = cliRun("graded-skill", "golden-basic");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("completed");
    firstRunId = String(json?.runId);
    firstVersionHash = String(json?.skillVersionHash);

    const graded = cliGrade("graded-skill", firstRunId, "pass", "looks right");
    expect(graded.exitCode).toBe(0);

    const cells = cliMeasurements("graded-skill");
    expect(cells.length).toBe(1);
    const cell = cells[0];
    expect(cell?.fixtureCase).toBe("golden-basic");
    expect(cell?.versionHash).toBe(firstVersionHash);
    expect(cell?.n).toBe(1);
    expect(cell?.passes).toBe(1);
    expect(cell?.passRate).toBe(1);
    // n=1 all-pass: rule-of-three clamps to [0, 1] (degenerate), Wilson's
    // zero-failure lower bound is tighter (~0.2066) and wins.
    expect(cell?.ci?.[0]).toBeGreaterThan(0);
    expect(cell?.ci?.[1]).toBe(1);

    // Friction log finding #5: response.md is written to disk with the
    // agent's final message text -- grading must never require JSONL
    // spelunking. fake-acp-success.cjs sends two agent_message_chunks:
    // "Working on it..." then " Done." (see the fixture).
    const responsePath = join(bundleDir, "runs", firstRunId, "response.md");
    expect(existsSync(responsePath)).toBe(true);
    const responseText = readFileSync(responsePath, "utf8");
    expect(responseText).toContain("Working on it...");
    expect(responseText).toContain("Done.");
  });

  test("a REGRADE as fail replaces the verdict -- latest wins, still n=1 (not two samples)", () => {
    const regraded = cliGrade("graded-skill", firstRunId, "fail", "second look: off-topic");
    expect(regraded.exitCode).toBe(0);

    const cells = cliMeasurements("graded-skill");
    expect(cells.length).toBe(1);
    expect(cells[0]?.n).toBe(1);
    expect(cells[0]?.passes).toBe(0);
    expect(cells[0]?.passRate).toBe(0);
    // A failure exists, so the CI is Wilson, not rule-of-three.
    expect(cells[0]?.ci?.[0]).toBe(0);
    expect(cells[0]?.ci?.[1]).toBeLessThan(1);
  });

  test("k=3 all-pass: n=3, passRate 1.0, Wilson CI ~[43.8%, 100%] (never the degenerate [0%, 100%])", () => {
    // Regrade run 1 back to pass (a third event for the same run id), then
    // two fresh runs graded pass.
    expect(cliGrade("graded-skill", firstRunId, "pass").exitCode).toBe(0);
    for (let i = 0; i < 2; i++) {
      const { result, json } = cliRun("graded-skill", "golden-basic");
      expect(result.exitCode).toBe(0);
      expect(cliGrade("graded-skill", String(json?.runId), "pass").exitCode).toBe(0);
    }

    const cells = cliMeasurements("graded-skill");
    expect(cells.length).toBe(1);
    const cell = cells[0];
    expect(cell?.n).toBe(3);
    expect(cell?.passes).toBe(3);
    expect(cell?.passRate).toBe(1);
    // Rule of three at n=3 would be the degenerate [0, 1]; Wilson's
    // zero-failure bound (~[0.4385, 1]) is tighter and wins (friction log
    // finding #6 -- an interval containing 0% for an all-pass fixture reads
    // as broken math).
    expect(cell?.ci?.[0]).toBeCloseTo(0.4385, 3);
    expect(cell?.ci?.[1]).toBe(1);
  });

  test("grading an infra-error run is refused (exit 1) and it never enters measurements", () => {
    setProviderCommand(["node", fakeAdapterInfraFail]);
    const { result, json } = cliRun("graded-skill", "golden-basic");
    expect(result.exitCode).toBe(3);
    expect(json?.status).toBe("infra-error");
    infraRunId = String(json?.runId);

    const graded = cliGrade("graded-skill", infraRunId, "pass");
    expect(graded.exitCode).toBe(1);

    const cells = cliMeasurements("graded-skill");
    expect(cells.length).toBe(1);
    expect(cells[0]?.n).toBe(3);
  });

  test("grading a nonexistent run is refused (exit 1)", () => {
    expect(cliGrade("graded-skill", "no-such-run", "pass").exitCode).toBe(1);
  });

  test("a version bump resets measurements honestly: no cell for the new hash", () => {
    writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Graded Skill\n\nv2 -- changed.\n");
    const recorded = runCli(["version", "record", "graded-skill", "--json"], scratchDir);
    expect(recorded.exitCode).toBe(0);
    const newHash = jsonFrom<{ hash: string }>(recorded)?.hash;
    expect(newHash).toBeDefined();
    expect(newHash).not.toBe(firstVersionHash);

    const cells = cliMeasurements("graded-skill");
    // Old cells remain (history is kept), but nothing is measured at the
    // new version -- the viewer's "current latest version" filter therefore
    // shows "not yet measured" (data-model.md §1.6).
    expect(cells.every((cell) => cell.versionHash !== newHash)).toBe(true);
    expect(cells.some((cell) => cell.versionHash === firstVersionHash)).toBe(true);
  });
});

describe("phase 9 server surface", () => {
  beforeAll(async () => {
    setProviderCommand(["node", fakeAdapterSuccess]);
    const server = await startE2eServer({
      command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
      cwd: scratchDir,
    });
    serverProcess = server.process;
    baseUrl = server.baseUrl;
  }, 30000);

  test("GET /api/bundles/:slug includes measurements[]", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/graded-skill`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      measurements: ReadonlyArray<{ fixtureCase: string; n: number }>;
    };
    expect(Array.isArray(body.measurements)).toBe(true);
    expect(body.measurements.some((cell) => cell.fixtureCase === "golden-basic" && cell.n === 3)).toBe(true);
  });

  test("GET /api/bundles/:slug/runs/:runId returns run, parsed transcript, artifacts, grading history (newest first), and checks", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/graded-skill/runs/${firstRunId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { id: string; status: string; fixtureCase: string };
      transcript: ReadonlyArray<{ dir?: string }>;
      artifacts: ReadonlyArray<string>;
      gradingHistory: ReadonlyArray<{ at: string; payload: { verdict: string } }>;
      checks: ReadonlyArray<string>;
    };
    expect(body.run.id).toBe(firstRunId);
    expect(body.run.status).toBe("completed");
    expect(body.transcript.length).toBeGreaterThan(0);
    expect(body.transcript.every((entry) => typeof entry === "object" && entry !== null)).toBe(true);
    expect(body.artifacts).toContain("fake-output.md");
    // Friction log finding #5: response.md must be surfaced in the run
    // detail artifacts list so the viewer's run-detail page offers it
    // alongside the fixture's own artifacts.
    expect(body.artifacts).toContain("response.md");
    // Run 1 was graded pass -> fail -> pass: full history, newest first.
    expect(body.gradingHistory.length).toBe(3);
    expect(body.gradingHistory[0]?.payload.verdict).toBe("pass");
    expect(body.gradingHistory[1]?.payload.verdict).toBe("fail");
    const times = body.gradingHistory.map((event) => event.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(body.checks).toEqual(["output file exists", "content is on-topic"]);
  });

  test("GET run detail 404s for an unknown run id", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/graded-skill/runs/no-such-run`);
    expect(response.status).toBe(404);
  });

  test("POST run.graded on an infra-error run is a 409", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "run.graded", payload: { id: infraRunId, verdict: "pass" } }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("infra-error");
  });

  test("POST run.graded on a nonexistent run is a 409", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "run.graded", payload: { id: "no-such-run", verdict: "pass" } }),
    });
    expect(response.status).toBe(409);
  });

  test("POST run.graded on a completed run appends (the panel's write path)", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "run.graded",
        payload: {
          id: firstRunId,
          verdict: "pass",
          checks: [
            { text: "output file exists", pass: true },
            { text: "content is on-topic", pass: true },
          ],
          notes: "graded from the server test",
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("appended");
  });

  test("artifact files are readable via the file endpoint allowlist", async () => {
    const response = await fetch(
      `${baseUrl}/api/bundles/graded-skill/file?path=${encodeURIComponent(
        `runs/${firstRunId}/artifacts/fake-output.md`,
      )}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { content: string };
    expect(body.content).toContain("Fake output");
  });

  test("response.md is readable via the file endpoint allowlist", async () => {
    const response = await fetch(
      `${baseUrl}/api/bundles/graded-skill/file?path=${encodeURIComponent(`runs/${firstRunId}/response.md`)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { content: string };
    expect(body.content).toContain("Working on it...");
    expect(body.content).toContain("Done.");
  });

  test("the artifact path allowlist is traversal-guarded", async () => {
    const attempts = [
      `runs/${firstRunId}/artifacts/../../../../skillmaker.config.json`,
      `runs/${firstRunId}/artifacts/../../${firstRunId}/run.json`,
      "runs/../design.md",
      `runs/${firstRunId}/artifacts/`,
      "/etc/passwd",
    ];
    for (const attempt of attempts) {
      const response = await fetch(
        `${baseUrl}/api/bundles/graded-skill/file?path=${encodeURIComponent(attempt)}`,
      );
      expect(response.status).toBe(404);
    }
  });

  test("POST /api/bundles/:slug/fixtures/:case/run returns a run id immediately and the run completes in the background", async () => {
    const before = Date.now();
    const response = await fetch(`${baseUrl}/api/bundles/graded-skill/fixtures/golden-basic/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "claude-code" }),
    });
    const elapsed = Date.now() - before;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runId: string; status: string };
    expect(body.status).toBe("started");
    expect(body.runId.length).toBeGreaterThan(0);
    // Non-blocking: the response must come back well before a run could
    // finish end-to-end (sandbox setup + adapter round-trips); generous
    // bound to stay CI-safe.
    expect(elapsed).toBeLessThan(2000);

    // The run proceeds detached: poll run.json until it lands as completed.
    const runJsonPath = join(bundleDir, "runs", body.runId, "run.json");
    const deadline = Date.now() + 20000;
    let status = "";
    while (Date.now() < deadline) {
      if (existsSync(runJsonPath)) {
        const record = JSON.parse(readFileSync(runJsonPath, "utf8")) as { status: string };
        status = record.status;
        if (status !== "running") break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(status).toBe("completed");
  }, 30000);

  test("triggering a run for an unknown provider is a 400; unknown fixture a 409; unknown bundle a 404", async () => {
    const badProvider = await fetch(`${baseUrl}/api/bundles/graded-skill/fixtures/golden-basic/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "nope" }),
    });
    expect(badProvider.status).toBe(400);

    const badFixture = await fetch(`${baseUrl}/api/bundles/graded-skill/fixtures/no-such-case/run`, {
      method: "POST",
    });
    expect(badFixture.status).toBe(409);

    const badBundle = await fetch(`${baseUrl}/api/bundles/no-such-bundle/fixtures/golden-basic/run`, {
      method: "POST",
    });
    expect(badBundle.status).toBe(404);
  });
});
