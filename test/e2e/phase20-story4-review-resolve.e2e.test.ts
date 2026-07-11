/**
 * `skillmaker review resolve <slug> --decision approve|revise [--notes]`
 * (Phase 20 Story 4 friction log finding #3): a solo publisher must never
 * NEED the browser to resolve a review. This is the "two doors, one
 * journal" pair to the viewer's review panel POST -- both write the same
 * `review.resolved` event through the same server-side guard (Server.ts's
 * `review.resolved` check re-derives from `foldBundleStates`, this CLI
 * command re-derives the same way before appending).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
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

const bundleStatus = (slug: string): { stage: string; substate: string } => {
  const parsed = jsonFrom<{ stage: string; substate: string }>(runCli(["status", slug, "--json"]));
  return { stage: parsed?.stage ?? "unknown", substate: parsed?.substate ?? "unknown" };
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-review-resolve-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "solo-skill", "--json"]).exitCode).toBe(0);
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("skillmaker review resolve", () => {
  test("--decision without a pending review is rejected (not awaiting-review)", () => {
    const result = runCli(["review", "resolve", "solo-skill", "--decision", "approve", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not awaiting review");
  });

  test("missing --decision is a usage error", () => {
    const result = runCli(["review", "resolve", "solo-skill", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("missing --decision");
  });

  test("invalid --decision value is a usage error", () => {
    const result = runCli(["review", "resolve", "solo-skill", "--decision", "maybe", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --decision');
  });

  test("review request puts the bundle into awaiting-review", () => {
    expect(runCli(["review", "request", "solo-skill", "--json"]).exitCode).toBe(0);
    expect(bundleStatus("solo-skill")).toEqual({ stage: "idea", substate: "awaiting-review" });
  });

  test("review resolve --decision revise returns the bundle to working, journaled with notes", () => {
    const result = runCli([
      "review",
      "resolve",
      "solo-skill",
      "--decision",
      "revise",
      "--notes",
      "tighten the trigger phrase",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = jsonFrom<{ status: string; decision: string }>(result);
    expect(parsed?.status).toBe("resolved");
    expect(parsed?.decision).toBe("revise");
    expect(bundleStatus("solo-skill")).toEqual({ stage: "idea", substate: "working" });

    const journalLines = readFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload: { decision?: string; notes?: string } });
    const resolved = journalLines.filter((e) => e.type === "review.resolved").at(-1);
    expect(resolved?.payload.decision).toBe("revise");
    expect(resolved?.payload.notes).toBe("tighten the trigger phrase");
  });

  test("review resolve --decision approve is the same journal path as the viewer panel (solo loop, no browser)", () => {
    expect(runCli(["review", "request", "solo-skill", "--json"]).exitCode).toBe(0);
    expect(bundleStatus("solo-skill").substate).toBe("awaiting-review");

    const result = runCli(["review", "resolve", "solo-skill", "--decision", "approve", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(bundleStatus("solo-skill").substate).toBe("working");

    // The forward guard (checkTransition) now sees an approved review at
    // this stage, same as if the viewer's panel had appended it.
    const advanced = runCli(["advance", "solo-skill", "--to", "researching", "--json"]);
    expect(advanced.exitCode).toBe(0);
    expect(bundleStatus("solo-skill").stage).toBe("researching");
  });
});
