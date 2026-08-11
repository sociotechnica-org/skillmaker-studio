/**
 * THE ACID TEST, literally (docs/proposals/2026-08-11-architecture-review-
 * runner.md §2): `sms-runner` is a standalone executable — shelled here
 * against a fixture case dir with a fake ACP provider, with NO Studio
 * server, workspace, or journal anywhere in sight. Asserts the env-var
 * contract in, the run-dir shape out, and the exit-code semantics:
 * 0 completed · 1 task-failed · 2 usage · 3 infra-error.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecord } from "../src/Run.ts";

const BIN_PATH = join(import.meta.dir, "..", "src", "bin.ts");
const FAKE_SUCCESS = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");
const FAKE_TASK_FAIL = join(import.meta.dir, "fixtures", "fake-acp-task-fail.cjs");

interface CaseSetup {
  readonly root: string;
  readonly caseDir: string;
  readonly skillDir: string;
  readonly runDir: string;
}

/** Builds a self-contained fixture case dir + resolved skill payload + empty run dir — no workspace, no bundle.json, no journal. `SMS_CASE_DIR` is just a path; the runner must not care what its parent directories are named. */
const setUpCase = (): CaseSetup => {
  const root = mkdtempSync(join(tmpdir(), "sms-runner-acid-"));
  const caseDir = join(root, "some-arbitrary-layout", "nothing-worth-writing");
  mkdirSync(join(caseDir, "files"), { recursive: true });
  writeFileSync(join(caseDir, "prompt.md"), "Please do the thing.\n");
  writeFileSync(join(caseDir, "case.json"), JSON.stringify({ class: "golden" }));
  writeFileSync(join(caseDir, "files", "notes.md"), "# Pre-existing case material\n");

  const skillDir = join(root, "my-skill", "output");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n\nInstructions.\n");

  const runDir = join(root, "runs", "acid-run-1");
  mkdirSync(runDir, { recursive: true });

  return { root, caseDir, skillDir, runDir };
};

const baseEnv = (setup: CaseSetup, providerScript: string): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  SMS_CASE_DIR: setup.caseDir,
  SMS_CASE_NAME: "nothing-worth-writing",
  SMS_SKILL_DIR: setup.skillDir,
  SMS_VERSION_HASH: "sha256:acid-test-hash",
  SMS_PROVIDER: "claude-code",
  SMS_MODEL: "",
  SMS_RUN_DIR: setup.runDir,
  SMS_TIMEOUT: "60",
  SMS_PROVIDER_CMD: JSON.stringify(["node", providerScript]),
});

const runBin = (env: Record<string, string>) =>
  Bun.spawnSync({ cmd: ["bun", BIN_PATH], env, stdout: "pipe", stderr: "pipe" });

describe("sms-runner acid test (standalone bin, fake ACP provider, no Studio server)", () => {
  test("a completed run: exit 0, and the full run-dir shape (run.json / transcript.jsonl / response.md / artifacts/)", () => {
    const setup = setUpCase();
    try {
      const proc = runBin(baseEnv(setup, FAKE_SUCCESS));
      expect(proc.exitCode).toBe(0);

      // run.json: present, decodes against the shipped RunRecord schema
      // (shape unchanged — the contract's §1e guarantee), finalized.
      const runJsonRaw = JSON.parse(readFileSync(join(setup.runDir, "run.json"), "utf8"));
      const record = Schema.decodeUnknownSync(RunRecord)(runJsonRaw);
      expect(record.status).toBe("completed");
      expect(record.id).toBe("acid-run-1");
      expect(record.fixtureCase).toBe("nothing-worth-writing");
      expect(record.skillVersionHash).toBe("sha256:acid-test-hash");
      expect(record.provider).toBe("claude-code");
      expect(record.model).toBe("fake-model-1");
      expect(record.endedAt).toBeDefined();
      expect(record.isolation).toBe("sandbox-home");
      // The bin resolves the slug from .../my-skill/output -> "my-skill".
      expect(record.bundle).toBe("my-skill");

      // transcript.jsonl: non-empty ndjson.
      const transcriptLines = readFileSync(join(setup.runDir, "transcript.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(transcriptLines.length).toBeGreaterThan(0);
      for (const line of transcriptLines) JSON.parse(line);

      // response.md: the agent's streamed final message, concatenated.
      const response = readFileSync(join(setup.runDir, "response.md"), "utf8");
      expect(response).toContain("Working on it...");
      expect(response).toContain("Done.");

      // artifacts/: the workspace diff — the file the fake adapter wrote
      // into the sandbox, but NOT the pre-existing case material.
      expect(readFileSync(join(setup.runDir, "artifacts", "fake-output.md"), "utf8")).toContain("Fake output");
      expect(existsSync(join(setup.runDir, "artifacts", "notes.md"))).toBe(false);
    } finally {
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 20_000);

  test("a task failure (stopReason != end_turn): exit 1, run.json status 'failed', stderr.txt written", () => {
    const setup = setUpCase();
    try {
      const proc = runBin(baseEnv(setup, FAKE_TASK_FAIL));
      expect(proc.exitCode).toBe(1);

      const record = Schema.decodeUnknownSync(RunRecord)(
        JSON.parse(readFileSync(join(setup.runDir, "run.json"), "utf8")),
      );
      expect(record.status).toBe("failed");
      expect(existsSync(join(setup.runDir, "stderr.txt"))).toBe(true);
    } finally {
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 20_000);

  test("an infra fault (adapter exits before the handshake): exit 3, run kept with status 'infra-error' -- failed-run != failing-run", () => {
    const setup = setUpCase();
    try {
      const env = {
        ...baseEnv(setup, FAKE_SUCCESS),
        SMS_PROVIDER_CMD: JSON.stringify(["node", "-e", "process.exit(1)"]),
      };
      const proc = runBin(env);
      expect(proc.exitCode).toBe(3);

      // The run dir is KEPT (never deleted, never graded, never measured).
      const record = Schema.decodeUnknownSync(RunRecord)(
        JSON.parse(readFileSync(join(setup.runDir, "run.json"), "utf8")),
      );
      expect(record.status).toBe("infra-error");
    } finally {
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 20_000);

  test("usage: a missing required env var exits 2 without touching the run dir", () => {
    const setup = setUpCase();
    try {
      const env = baseEnv(setup, FAKE_SUCCESS);
      delete (env as Record<string, string | undefined>).SMS_CASE_DIR;
      const proc = runBin(env);
      expect(proc.exitCode).toBe(2);
      expect(new TextDecoder().decode(proc.stderr)).toContain("SMS_CASE_DIR");
      expect(existsSync(join(setup.runDir, "run.json"))).toBe(false);
    } finally {
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 20_000);

  test("usage: a case dir with no prompt.md exits 2", () => {
    const setup = setUpCase();
    try {
      rmSync(join(setup.caseDir, "prompt.md"));
      const proc = runBin(baseEnv(setup, FAKE_SUCCESS));
      expect(proc.exitCode).toBe(2);
      expect(new TextDecoder().decode(proc.stderr)).toContain("prompt.md");
    } finally {
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 20_000);
});
