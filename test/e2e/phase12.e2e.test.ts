/**
 * End-to-end: codex provider parity, mocked (Phase 12,
 * spike-codex/FINDINGS.md re-validated). Drives the real `skillmaker` CLI's
 * `run` command with `--provider codex` against a fake `codex-acp`-flavored
 * adapter (`test/e2e/fixtures/fake-acp-codex-success.cjs`) -- no real LLM
 * call, so this suite is CI-safe and requires no auth.
 *
 * Unlike `test/e2e/phase8.e2e.test.ts` (claude-code, `.claude/skills`), this
 * exercises the codex `ProviderProfile`: skills installed under
 * `.agents/skills/<bundle>/`, `session/new`'s codex-shaped result carrying
 * both `models.currentModelId` and `configOptions`, and no
 * `session/request_permission` round trip for in-workspace writes.
 *
 * The guarded REAL e2e (against the real `codex-acp` adapter and this
 * machine's logged-in `codex` CLI) lives in
 * `test/e2e/phase12-real.e2e.test.ts`, gated on `SKILLMAKER_REAL_CODEX=1`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterCodex = join(import.meta.dir, "fixtures", "fake-acp-codex-success.cjs");

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

/** Points `skillmaker.config.json`'s `codex` provider at a fake adapter script. */
const setCodexProviderCommand = (command: ReadonlyArray<string>): void => {
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers.codex = { command };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly bundle: string;
  readonly runId: string;
  readonly skillVersionHash: string;
  readonly autoRecordedVersion: boolean;
  readonly model: string | null;
  readonly artifacts: ReadonlyArray<string>;
}

const cliRun = (slug: string, fixtureCase: string): { result: ReturnType<typeof runCli>; json?: RunCliOutput } => {
  const result = runCli(["run", slug, "--fixture", fixtureCase, "--provider", "codex", "--json"], scratchDir);
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
  return { result, json };
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase12-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "example-skill", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "example-skill");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Example Skill\n\nDoes a thing.\n");

  expect(runCli(["fixture", "add", "example-skill", "golden-basic", "--json"], scratchDir).exitCode).toBe(0);
  writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");

  setCodexProviderCommand(["node", fakeAdapterCodex]);
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker run --provider codex: mocked success path", () => {
  let output: RunCliOutput | undefined;
  let runDir: string;

  test("`skillmaker run --provider codex` against a fake codex-acp adapter completes with exit code 0", () => {
    const { result, json } = cliRun("example-skill", "golden-basic");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("completed");
    output = json;
  });

  test("the codex model is extracted via models.currentModelId", () => {
    runDir = join(bundleDir, "runs", String(output?.runId));
    const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as {
      readonly model: string;
      readonly provider: string;
    };
    expect(runRecord.provider).toBe("codex");
    expect(runRecord.model).toBe("gpt-5.6-sol[xhigh]");
    expect(output?.model).toBe("gpt-5.6-sol[xhigh]");
  });

  test("the skill was installed under the sandbox's .agents/skills/ layout, not .claude/skills/", () => {
    // The sandbox itself is torn down once the run ends, so the only way to
    // observe its layout is what the fake adapter recorded live at
    // handshake time -- see fake-acp-codex-success.cjs's session/new
    // handler, which writes skill-install-check.json before any prompt work.
    const checkPath = join(runDir, "artifacts", "skill-install-check.json");
    expect(existsSync(checkPath)).toBe(true);
    const check = JSON.parse(readFileSync(checkPath, "utf8")) as {
      readonly agentsSkillsFound: boolean;
      readonly claudeSkillsFound: boolean;
    };
    expect(check.agentsSkillsFound).toBe(true);
    expect(check.claudeSkillsFound).toBe(false);
  });

  test("the transcript records a codex-style read of .agents/skills/example-skill/SKILL.md", () => {
    const transcriptLines = readFileSync(join(runDir, "transcript.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(transcriptLines.length).toBeGreaterThan(0);
    expect(transcriptLines.some((line) => line.includes(".agents/skills/example-skill/SKILL.md"))).toBe(true);
  });

  test("fake-codex-output.md lands in artifacts/", () => {
    expect(existsSync(join(runDir, "artifacts", "fake-codex-output.md"))).toBe(true);
    expect(output?.artifacts).toContain("fake-codex-output.md");
  });

  test("no permission-request round trip was needed (codex auto mode) -- run still completed cleanly", () => {
    // Implicit in the "completed" status above: fake-acp-codex-success.cjs
    // never sends session/request_permission at all, and the run engine
    // does not block waiting for one, matching the real adapter's `auto`
    // approval mode observed live in the spike.
    expect(output?.status).toBe("completed");
  });
});
