/**
 * End-to-end: the eval run engine against the REAL `claude-code-acp`
 * adapter (data-model.md §2.8, plan.md Phase 8). Unlike
 * `test/e2e/phase8.e2e.test.ts` (mocked, always-on, CI-safe), this suite
 * makes a real LLM call through `npx -y @zed-industries/claude-code-acp` and
 * needs a real, already-authenticated `claude` CLI on the machine running
 * it -- it is gated on `SKILLMAKER_REAL_ACP=1` and skipped entirely
 * otherwise (including in ordinary CI runs).
 *
 * Run it explicitly with:
 *   SKILLMAKER_REAL_ACP=1 bun test test/e2e/phase8-real.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_ACP = process.env.SKILLMAKER_REAL_ACP === "1";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let bundleDir: string;

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
  readonly model: string | null;
  readonly artifacts: ReadonlyArray<string>;
}

const parseJsonLine = (stream: string): RunCliOutput | undefined => {
  for (const line of stream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as RunCliOutput;
    } catch {
      // keep scanning
    }
  }
  return undefined;
};

describe.skipIf(!REAL_ACP)("skillmaker run: REAL claude-code-acp adapter (SKILLMAKER_REAL_ACP=1)", () => {
  beforeAll(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase8-real-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
    Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
    Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

    expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
    expect(runCli(["new", "say-hello", "--json"], scratchDir).exitCode).toBe(0);

    bundleDir = join(scratchDir, "skills", "say-hello");
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      "---\nname: say-hello\ndescription: Writes a one-line greeting to greeting.txt.\n---\n\nWhen asked to say hello, write exactly the text \"hello from skillmaker\" (no quotes) to a file named greeting.txt in the current directory, then stop.\n",
    );

    expect(
      runCli(["fixture", "add", "say-hello", "golden-basic", "--json"], scratchDir).exitCode,
    ).toBe(0);
    writeFileSync(
      join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"),
      "Say hello using the say-hello skill.\n",
    );
  }, 30000);

  afterAll(() => {
    if (scratchDir !== undefined) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test(
    "a real run against claude-code-acp completes (or reports a classified failure, but never hangs)",
    () => {
      const result = runCli(
        ["run", "say-hello", "--fixture", "golden-basic", "--provider", "claude-code", "--json"],
        scratchDir,
      );
      const json = parseJsonLine(result.stdout) ?? parseJsonLine(result.stderr);

      // eslint-disable-next-line no-console
      console.log("[phase8-real e2e] exitCode:", result.exitCode, "json:", json, "\nstderr tail:", result.stderr.slice(-2000));

      expect(json).toBeDefined();
      expect(["completed", "failed", "infra-error"]).toContain(json?.status);
      expect([0, 1, 3]).toContain(result.exitCode);

      if (json?.status === "completed") {
        const runDir = join(bundleDir, "runs", String(json.runId));
        expect(existsSync(join(runDir, "run.json"))).toBe(true);
        const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as { model: string };
        expect(runRecord.model.length).toBeGreaterThan(0);
      }
    },
    // A real LLM call plus `npx` resolving the adapter package can take a
    // while; give this generous headroom well above the engine's own
    // 300s default prompt timeout.
    360_000,
  );
});
