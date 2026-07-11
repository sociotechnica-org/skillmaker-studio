/**
 * End-to-end: an agent station against the REAL `claude-code-acp` adapter,
 * driving William's actual `william-draft-skill-md` skill (data-model.md
 * §2.13, plan.md Phase 10). Unlike `test/e2e/phase10.e2e.test.ts` (mocked,
 * always-on, CI-safe), this suite makes a real LLM call and needs a real,
 * already-authenticated `claude` CLI on the machine running it -- it is
 * gated on `SKILLMAKER_REAL_ACP=1` and skipped entirely otherwise
 * (including in ordinary CI runs).
 *
 * Run it explicitly with:
 *   SKILLMAKER_REAL_ACP=1 bun test test/e2e/phase10-real.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_ACP = process.env.SKILLMAKER_REAL_ACP === "1";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const williamSkillSrc = join(repoRoot, "skills", "william-draft-skill-md");

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

interface StationRunOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly runId: string;
  readonly skill: string;
  readonly model: string | null;
  readonly changedPaths: ReadonlyArray<string>;
  readonly reviewRequested: boolean;
}

const parseJsonLine = (stream: string): StationRunOutput | undefined => {
  for (const line of stream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as StationRunOutput;
    } catch {
      // keep scanning
    }
  }
  return undefined;
};

describe.skipIf(!REAL_ACP)(
  "skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1)",
  () => {
    beforeAll(() => {
      if (!existsSync(williamSkillSrc)) {
        throw new Error(
          `william-draft-skill-md not found at ${williamSkillSrc} -- this test drives the repo's real self-hosted skill`,
        );
      }

      scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase10-real-"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
      Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
      Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

      expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);

      // Bring the repo's real william-draft-skill-md into this scratch
      // workspace as the station's skill bundle (StationEngine.runStation
      // resolves station.skill against a bundle in the SAME workspace).
      cpSync(williamSkillSrc, join(scratchDir, "skills", "william-draft-skill-md"), { recursive: true });

      expect(runCli(["new", "greeting-skill", "--json"], scratchDir).exitCode).toBe(0);
      bundleDir = join(scratchDir, "skills", "greeting-skill");
      writeFileSync(
        join(bundleDir, "design.md"),
        [
          "# Greeting Skill",
          "",
          "## Intent",
          "",
          "Writes a one-line greeting to greeting.txt.",
          "",
          "## The workflow",
          "",
          "1. Write exactly the text \"hello from skillmaker\" (no quotes) to a file",
          "   named greeting.txt in the current directory.",
          "2. Stop.",
          "",
          "## Failure hypotheses",
          "",
          "| # | Hypothesis | In/out |",
          "|---|---|---|",
          "| 1 | Writes the wrong text | IN |",
          "",
        ].join("\n"),
      );

      // The default stations.json template already points drafting at
      // "william-draft-skill-md" (Stations.ts) -- nothing to rewire.
      expect(
        runCli(["advance", "greeting-skill", "--to", "researching", "--override", "--json"], scratchDir)
          .exitCode,
      ).toBe(0);
      expect(
        runCli(["advance", "greeting-skill", "--to", "drafting", "--override", "--json"], scratchDir).exitCode,
      ).toBe(0);
    }, 30000);

    afterAll(() => {
      if (scratchDir !== undefined) {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    });

    test(
      "a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)",
      () => {
        const result = runCli(["station", "run", "greeting-skill", "--provider", "claude-code", "--json"], scratchDir);
        const json = parseJsonLine(result.stdout) ?? parseJsonLine(result.stderr);

        // eslint-disable-next-line no-console
        console.log(
          "[phase10-real e2e] exitCode:",
          result.exitCode,
          "json:",
          json,
          "\nstderr tail:",
          result.stderr.slice(-2000),
        );

        expect(json).toBeDefined();
        expect(["completed", "failed", "infra-error"]).toContain(json?.status);
        expect([0, 1, 3]).toContain(result.exitCode);

        if (json?.status === "completed") {
          expect(json.skill).toBe("william-draft-skill-md");
          const runDir = join(bundleDir, "runs", String(json.runId));
          expect(existsSync(join(runDir, "run.json"))).toBe(true);
          const runRecord = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as { model: string };
          expect(runRecord.model.length).toBeGreaterThan(0);

          // eslint-disable-next-line no-console
          console.log(
            "[phase10-real e2e] changedPaths:",
            json.changedPaths,
            "reviewRequested:",
            json.reviewRequested,
          );
          if (existsSync(join(bundleDir, "output", "SKILL.md"))) {
            // eslint-disable-next-line no-console
            console.log(
              "[phase10-real e2e] drafted output/SKILL.md:\n",
              readFileSync(join(bundleDir, "output", "SKILL.md"), "utf8"),
            );
          }
        }
      },
      // A real LLM call plus `npx` resolving the adapter package can take a
      // while; give this generous headroom well above the engine's own
      // 300s default prompt timeout.
      360_000,
    );
  },
);
