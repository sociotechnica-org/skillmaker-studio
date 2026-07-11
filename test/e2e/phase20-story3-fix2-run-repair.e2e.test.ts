/**
 * End-to-end regression: Story 3 friction log F2 -- the workspace-diff ->
 * `artifacts/` copy step (`RunEngine.ts`'s `copyPreservingPath`) used to
 * crash with an uncaught ENOENT whenever a file present in the "after"
 * snapshot vanished from the sandbox before the copy ran (e.g. a provider
 * CLI's own transient shell-snapshot/lock churn) -- leaving `run.json`
 * permanently stuck at `status: "running"` with no `endedAt` (a "zombie
 * run"): ungradeable forever, since `grade` hard-refuses anything that
 * isn't `status: "completed"`.
 *
 * Two things are regression-tested here:
 *  1. `copyPreservingPath` (exercised indirectly via `_internal`) tolerates
 *     a file vanishing between snapshot and copy instead of throwing.
 *  2. `skillmaker run repair <slug> [runId]` terminal-states an
 *     already-stuck run (fabricated directly on disk, simulating a crash
 *     that happened before this fix existed, or any other process-died
 *     scenario): "completed" when the transcript shows `end_turn`,
 *     "failed" (reason "interrupted: artifact capture") otherwise -- and
 *     `grade` then behaves exactly as its normal status gate dictates for
 *     the resulting terminal status.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let bundleDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const write = (relativePath: string, content: string): void => {
  const full = join(scratchDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

/** Fabricates a "running" run.json + optional transcript.jsonl on disk directly -- simulating a crash mid-run, no ACP session actually driven (this fix's repair path must work purely from what's already persisted). */
const fabricateStuckRun = (runId: string, transcriptLines: ReadonlyArray<unknown> | undefined): void => {
  const runDir = join(bundleDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const runningRecord = {
    schemaVersion: 1,
    id: runId,
    bundle: "example-skill",
    kind: "eval",
    station: null,
    fixtureCase: "golden-basic",
    skillVersionHash: "sha256:deadbeef",
    provider: "claude-code",
    model: "",
    startedAt: new Date().toISOString(),
    status: "running",
    actor: { kind: "user", name: "e2e" },
    isolation: "sandbox-home",
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(runningRecord, null, 2)}\n`);
  if (transcriptLines !== undefined) {
    writeFileSync(runDir + "/transcript.jsonl", transcriptLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
};

interface RunJson {
  readonly status: string;
  readonly endedAt?: string;
  readonly repaired?: { readonly at: string; readonly reason: string };
}

const readRunJson = (runId: string): RunJson =>
  JSON.parse(readFileSync(join(bundleDir, "runs", runId, "run.json"), "utf8")) as RunJson;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase20-story3-fix2-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "example-skill", "--json"]).exitCode).toBe(0);
  bundleDir = join(scratchDir, "skills", "example-skill");
  write("skills/example-skill/output/SKILL.md", "# Example Skill\n\nDoes a thing.\n");
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("Fix F2: `run repair` terminal-states a stuck run so it becomes gradeable", () => {
  test("a stuck run whose transcript shows end_turn repairs to \"completed\"", () => {
    fabricateStuckRun("01REPAIR-ENDTURN", [
      { t: "2026-07-01T00:00:00.000Z", dir: "send", message: { jsonrpc: "2.0", id: 1, method: "session/prompt" } },
      {
        t: "2026-07-01T00:00:05.000Z",
        dir: "recv",
        message: { jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } },
      },
    ]);

    expect(readRunJson("01REPAIR-ENDTURN").status).toBe("running");

    const repair = runCli(["run", "repair", "example-skill", "01REPAIR-ENDTURN", "--json"]);
    expect(repair.exitCode).toBe(0);
    const repairJson = JSON.parse(repair.stdout) as {
      repaired: ReadonlyArray<{ runId: string; status: string; reason: string }>;
    };
    expect(repairJson.repaired).toHaveLength(1);
    expect(repairJson.repaired[0]?.status).toBe("completed");

    const after = readRunJson("01REPAIR-ENDTURN");
    expect(after.status).toBe("completed");
    expect(after.endedAt).toBeDefined();
    expect(after.repaired?.reason).toContain("end_turn");

    // Now gradeable -- the whole point of the fix.
    const grade = runCli(["grade", "example-skill", "01REPAIR-ENDTURN", "--verdict", "pass", "--json"]);
    expect(grade.exitCode).toBe(0);
  });

  test("a stuck run with NO end_turn evidence repairs to \"failed\" (interrupted: artifact capture), and stays refused by grade", () => {
    fabricateStuckRun("02REPAIR-NOENDTURN", [
      { t: "2026-07-01T00:00:00.000Z", dir: "send", message: { jsonrpc: "2.0", id: 1, method: "session/prompt" } },
      // No matching "recv" with stopReason: end_turn -- e.g. the process
      // died mid-session, exactly the crash this fix's ENOENT hardening
      // guards against for FUTURE runs; this run predates that hardening.
    ]);

    const repair = runCli(["run", "repair", "example-skill", "02REPAIR-NOENDTURN", "--json"]);
    expect(repair.exitCode).toBe(0);
    const repairJson = JSON.parse(repair.stdout) as {
      repaired: ReadonlyArray<{ runId: string; status: string; reason: string }>;
    };
    expect(repairJson.repaired[0]?.status).toBe("failed");
    expect(repairJson.repaired[0]?.reason).toBe("interrupted: artifact capture");

    const after = readRunJson("02REPAIR-NOENDTURN");
    expect(after.status).toBe("failed");

    // Still correctly refused: "failed" is a real terminal state (no longer
    // a zombie), but it's not "completed", so grade's hard gate still
    // applies -- repair never fabricates a pass verdict from nothing.
    const grade = runCli(["grade", "example-skill", "02REPAIR-NOENDTURN", "--verdict", "pass", "--json"]);
    expect(grade.exitCode).not.toBe(0);
    expect(grade.stderr).toContain("cannot be graded");
  });

  test("repairing a bundle with no stuck runs left is a clean, reported no-op failure (not a crash)", () => {
    const repair = runCli(["run", "repair", "example-skill", "--json"]);
    expect(repair.exitCode).not.toBe(0);
    expect(repair.stderr).toContain("no stuck");
  });

  test("repairing an already-terminal run by explicit id is refused, not silently re-terminal-stated", () => {
    const repair = runCli(["run", "repair", "example-skill", "01REPAIR-ENDTURN", "--json"]);
    expect(repair.exitCode).not.toBe(0);
    expect(repair.stderr).toContain("not stuck");
  });
});
