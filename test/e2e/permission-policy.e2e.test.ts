/**
 * End-to-end: issue #140's deny-by-default permission policy, mocked.
 * Drives the real `skillmaker` CLI's `run` command against
 * `fixtures/fake-acp-permissions.cjs`, an adapter that asks for two
 * permissions during the session: a write inside the sandbox and a write to
 * /etc (outside it). Covers all of issue #140's acceptance criteria at the
 * CLI level:
 *
 *   - in-sandbox request allowed; transcript records decision + reason
 *   - outside request denied; the run continues (completed, not a crash) and
 *     the CLI prints a visible denial line
 *   - --permissive approves everything, decisions still recorded
 *   - the policy is deterministic across identical re-runs
 *
 * No real LLM call -- CI-safe, no auth required.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterPermissions = join(import.meta.dir, "fixtures", "fake-acp-permissions.cjs");

let scratchDir: string;

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly runId: string;
  readonly artifacts: ReadonlyArray<string>;
  readonly responsePath: string;
}

interface PermissionResults {
  readonly inside: string;
  readonly outside: string;
}

interface PermissionDecisionEntry {
  readonly type: string;
  readonly optionId: string;
  readonly decision: string;
  readonly reason: string;
}

/** One `skillmaker run` against the fake permissions adapter; extracts the JSON summary line and the transcript's synthetic permission decisions. */
const cliRun = (extraArgs: ReadonlyArray<string> = []) => {
  const result = runCli(
    ["run", "example-skill", "--fixture", "golden-basic", "--provider", "claude-code", "--json", ...extraArgs],
    scratchDir,
  );
  let json: RunCliOutput | undefined;
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of stream.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        json = JSON.parse(trimmed) as RunCliOutput;
        break;
      } catch {
        // not the JSON line; keep scanning
      }
    }
    if (json !== undefined) break;
  }
  expect(json).toBeDefined();
  if (json === undefined) throw new Error("no JSON summary line in CLI output");

  const runDir = dirname(json.responsePath);
  const transcriptPath = join(runDir, "transcript.jsonl");
  const decisions: PermissionDecisionEntry[] = [];
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = JSON.parse(trimmed) as { dir: string; message: PermissionDecisionEntry };
    if (entry.dir === "synthetic" && entry.message.type === "permission_decision") {
      decisions.push(entry.message);
    }
  }

  const resultsPath = join(runDir, "artifacts", "permission-results.json");
  const wireResults = existsSync(resultsPath)
    ? (JSON.parse(readFileSync(resultsPath, "utf8")) as PermissionResults)
    : undefined;

  return { result, json, runDir, decisions, wireResults };
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-permission-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "example-skill", "--json"], scratchDir).exitCode).toBe(0);

  const bundleDir = join(scratchDir, "skills", "example-skill");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Example Skill\n\nDoes a thing.\n");
  expect(
    runCli(["fixture", "add", "example-skill", "golden-basic", "--json"], scratchDir).exitCode,
  ).toBe(0);
  writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");

  // Point the claude-code provider at the permission-probing fake adapter.
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command: ["node", fakeAdapterPermissions] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("deny-by-default permission policy (issue #140)", () => {
  test("default run: in-sandbox write allowed, outside write denied, run completes, transcript + CLI record both decisions with reasons", () => {
    const { result, json, decisions, wireResults } = cliRun();

    // Denial is not a crash: the run still completes (exit 0).
    expect(json.status).toBe("completed");
    expect(result.exitCode).toBe(0);

    // What actually crossed the wire: allow for inside, reject for outside.
    expect(wireResults).toBeDefined();
    expect(wireResults?.inside).toBe("opt-allow-once");
    expect(wireResults?.outside).toBe("opt-reject-once");

    // The approved in-sandbox write really happened and was captured.
    expect(json.artifacts).toContain("inside-note.md");

    // Transcript: both decisions recorded, each with a verdict and reason.
    expect(decisions).toHaveLength(2);
    const [inside, outside] = decisions;
    expect(inside?.decision).toBe("allowed");
    expect(inside?.optionId).toBe("opt-allow-once");
    expect(inside?.reason).toContain("inside the sandbox");
    expect(outside?.decision).toBe("denied");
    expect(outside?.optionId).toBe("opt-reject-once");
    expect(outside?.reason).toContain("outside the sandbox");
    expect(outside?.reason).toContain("/etc/skillmaker-e2e-denied.txt");

    // CLI progress output: a visible denial line (and the allow, with reasons).
    expect(result.stderr).toContain("permission DENIED");
    expect(result.stderr).toContain("/etc/skillmaker-e2e-denied.txt");
    expect(result.stderr).toContain("permission allowed");
  }, 30000);

  test("the policy is deterministic: re-running the same fixture produces the same decisions", () => {
    const first = cliRun();
    const second = cliRun();
    expect(first.json.status).toBe("completed");
    expect(second.json.status).toBe("completed");
    const strip = (entries: ReadonlyArray<PermissionDecisionEntry>) =>
      entries.map(({ optionId, decision }) => ({ optionId, decision }));
    expect(strip(second.decisions)).toEqual(strip(first.decisions));
    expect(second.wireResults).toEqual(first.wireResults);
  }, 60000);

  test("--permissive restores approve-everything: both requests approved, decisions still recorded", () => {
    const { result, json, decisions, wireResults } = cliRun(["--permissive"]);

    expect(json.status).toBe("completed");
    expect(result.exitCode).toBe(0);

    expect(wireResults?.inside).toBe("opt-allow-once");
    expect(wireResults?.outside).toBe("opt-allow-once");

    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.decision).toBe("allowed");
      expect(decision.reason).toContain("permissive");
    }
    expect(result.stderr).not.toContain("permission DENIED");
    expect(result.stderr).toContain("permission allowed");
  }, 30000);
});
