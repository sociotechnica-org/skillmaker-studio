/**
 * End-to-end regression: Story 3 friction log F4 (sandbox auth preservation)
 * and its security amendment.
 *
 * Two things are regression-tested here, both against the REAL `skillmaker`
 * CLI (a fake ACP adapter stands in for the provider subprocess -- no real
 * LLM call, no real auth needed, CI-safe):
 *
 *  1. No credential-bearing path can ever land under `runs/<id>/artifacts/`.
 *     `fake-acp-credential-leak.cjs` deliberately writes
 *     `.credentials.json`, a nested `auth.json`, `some_token.txt`, and
 *     `identity.pem` directly into the sandbox `cwd` (simulating a
 *     misbehaving provider CLI or skill) alongside one legitimate output
 *     file. This asserts: the legitimate file is captured; every
 *     credential-shaped file is redacted (never copied, and listed in
 *     `run.json`'s `artifactsRedacted`); and no credential CONTENT
 *     ("leaked-token-should-never-be-copied" etc.) appears anywhere under
 *     `artifacts/` even under a different filename.
 *  2. The isolated provider config dir (where `AuthSeeding.ts` seeds real
 *     auth material) is a SIBLING temp directory outside the sandbox that
 *     gets diffed into `artifacts/` -- structural exclusion, not
 *     exclusion-by-filename-convention. This is checked by asserting no
 *     path under `artifacts/` (recursively) contains the
 *     "skillmaker-run-config-" prefix used for that directory.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterCredentialLeak = join(import.meta.dir, "fixtures", "fake-acp-credential-leak.cjs");

let scratchDir: string;
let bundleDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const setProviderCommand = (command: ReadonlyArray<string>): void => {
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly runId: string;
}

const cliRun = (slug: string, fixtureCase: string): { result: ReturnType<typeof runCli>; json?: RunCliOutput } => {
  const result = runCli(["run", slug, "--fixture", fixtureCase, "--provider", "claude-code", "--json"]);
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

/** Recursively lists every file under `dir`, relative to `dir` (posix-joined). */
const listFilesRecursive = (dir: string, prefix = ""): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
};

interface RunJson {
  readonly status: string;
  readonly artifactsRedacted?: ReadonlyArray<string>;
  readonly artifactsSkipped?: ReadonlyArray<string>;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase20-story3-fix3-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "example-skill", "--json"]).exitCode).toBe(0);
  bundleDir = join(scratchDir, "skills", "example-skill");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Example Skill\n\nDoes a thing.\n");
  expect(runCli(["fixture", "add", "example-skill", "golden-basic", "--json"]).exitCode).toBe(0);
  writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("Fix F4 security amendment: no credential-bearing path ever reaches artifacts/", () => {
  let runId: string;
  let runDir: string;
  let artifactFiles: string[];

  test("a run whose sandbox picks up credential-shaped files still completes, redacting them", () => {
    setProviderCommand(["node", fakeAdapterCredentialLeak]);
    const { result, json } = cliRun("example-skill", "golden-basic");
    expect(result.exitCode).toBe(0);
    expect(json?.status).toBe("completed");
    expect(json?.runId).toBeDefined();
    runId = String(json?.runId);
    runDir = join(bundleDir, "runs", runId);
  });

  test("the legitimate output file IS captured in artifacts/", () => {
    artifactFiles = listFilesRecursive(join(runDir, "artifacts"));
    expect(artifactFiles).toContain("fake-output.md");
  });

  test("none of the credential-shaped basenames appear anywhere under artifacts/", () => {
    const credentialLikeNames = [".credentials.json", "auth.json", "some_token.txt", "identity.pem"];
    for (const name of credentialLikeNames) {
      const hit = artifactFiles.find((relPath) => relPath.split("/").at(-1) === name);
      expect(hit).toBeUndefined();
    }
  });

  test("no leaked credential CONTENT appears anywhere under artifacts/, even under an unexpected filename", () => {
    const leakedSecrets = ["leaked-token-should-never-be-copied", "also-should-never-be-copied", "leaked-secret-token-value", "BEGIN PRIVATE KEY"];
    for (const relPath of artifactFiles) {
      const contents = readFileSync(join(runDir, "artifacts", relPath), "utf8");
      for (const secret of leakedSecrets) {
        expect(contents).not.toContain(secret);
      }
    }
  });

  test("run.json records exactly which paths were redacted, matching what the fake adapter planted", () => {
    const runJson = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunJson;
    expect(runJson.status).toBe("completed");
    const redacted = new Set(runJson.artifactsRedacted ?? []);
    expect(redacted.has(".credentials.json")).toBe(true);
    expect(redacted.has("nested/dir/auth.json")).toBe(true);
    expect(redacted.has("some_token.txt")).toBe(true);
    expect(redacted.has("identity.pem")).toBe(true);
    // The legitimate file was never redacted.
    expect(redacted.has("fake-output.md")).toBe(false);
  });

  test("the isolated provider config dir never appears anywhere under artifacts/ (structural exclusion, not just redaction)", () => {
    for (const relPath of artifactFiles) {
      expect(relPath).not.toContain("skillmaker-run-config-");
    }
  });
});
