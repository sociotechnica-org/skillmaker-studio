#!/usr/bin/env bun
/**
 * `sms-runner` — the runner contract's standalone executable face
 * (docs/proposals/2026-08-11-architecture-review-runner.md §2).
 *
 * In (env vars, smevals-shaped):
 *
 *   SMS_CASE_DIR      required  the case directory (prompt.md, case.json, files/)
 *   SMS_CASE_NAME     required  the case name recorded on run.json
 *   SMS_SKILL_DIR     required  the resolved skill payload (the version under test)
 *   SMS_VERSION_HASH  required  recorded on run.json as skillVersionHash
 *   SMS_PROVIDER      required  provider id (e.g. "claude-code", "codex")
 *   SMS_MODEL         optional  requested model id (adapter default when unset)
 *   SMS_RUN_DIR       required  empty dir the runner fills (run.json, transcript.jsonl,
 *                               response.md, artifacts/)
 *   SMS_TIMEOUT       optional  seconds for the session budget (AcpClient default when unset)
 *   SMS_PROVIDER_CMD  optional  JSON array overriding the adapter argv (CI / fake adapters)
 *   SMS_SKILL_NAME    optional  skill slug (defaults to SMS_SKILL_DIR's basename,
 *                               or its parent's when the basename is "output")
 *
 * Out: SMS_RUN_DIR filled, and an exit code — 0 completed · 1 task-failed ·
 * 2 usage · 3 infra-error. Infra-error runs are kept, never graded, never
 * measured (failed-run != failing-run).
 *
 * The acid test invariant: this executable has NO lifecycle-core imports —
 * no journal, no workspace service, no index. If Studio disappeared, it
 * would still run a case.
 */
import { Effect } from "effect";
import { basename, dirname, resolve } from "node:path";
import { Actor } from "./Actor.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import { runCase } from "./Runner.ts";

const EXIT_COMPLETED = 0;
const EXIT_TASK_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_INFRA_ERROR = 3;

const usageFail = (message: string): never => {
  process.stderr.write(`sms-runner: ${message}\n`);
  process.exit(EXIT_USAGE);
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    return usageFail(`missing required env var ${name}`);
  }
  return value;
};

/** Mirrors `Workspace.ts`'s default provider commands — the bundled adapters a standalone invocation gets without a `skillmaker.config.json` in sight. `SMS_PROVIDER_CMD` overrides. */
const DEFAULT_PROVIDER_COMMANDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "claude-code": ["npx", "-y", "@agentclientprotocol/claude-agent-acp@latest"],
  codex: ["npx", "-y", "@agentclientprotocol/codex-acp@latest"],
};

const resolveProviderCommand = (providerId: string): ReadonlyArray<string> => {
  const override = process.env.SMS_PROVIDER_CMD;
  if (override !== undefined && override.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(override);
    } catch {
      return usageFail(`SMS_PROVIDER_CMD is not valid JSON: ${override}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((x) => typeof x === "string")) {
      return usageFail("SMS_PROVIDER_CMD must be a non-empty JSON array of strings");
    }
    return parsed;
  }
  const known = DEFAULT_PROVIDER_COMMANDS[providerId];
  if (known === undefined) {
    return usageFail(
      `unknown provider "${providerId}" and no SMS_PROVIDER_CMD given (known: ${Object.keys(DEFAULT_PROVIDER_COMMANDS).join(", ")})`,
    );
  }
  return known;
};

/** The skill slug: `SMS_SKILL_NAME`, or the payload dir's basename — with the `output/` convention peeled off so `.../my-skill/output` names `my-skill`, not `output`. */
const resolveSkillName = (skillDir: string): string => {
  const explicit = process.env.SMS_SKILL_NAME;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const base = basename(skillDir);
  return base === "output" ? basename(dirname(skillDir)) : base;
};

const exitCodeFor = (status: RunStatus): number => {
  switch (status) {
    case "completed":
      return EXIT_COMPLETED;
    case "failed":
      return EXIT_TASK_FAILED;
    case "infra-error":
      return EXIT_INFRA_ERROR;
    default:
      // "running" is not a terminal status runCase can return.
      return EXIT_INFRA_ERROR;
  }
};

const main = async (): Promise<number> => {
  const caseDir = resolve(requireEnv("SMS_CASE_DIR"));
  const caseName = requireEnv("SMS_CASE_NAME");
  const skillDir = resolve(requireEnv("SMS_SKILL_DIR"));
  const versionHash = requireEnv("SMS_VERSION_HASH");
  const providerId = requireEnv("SMS_PROVIDER");
  const runDir = resolve(requireEnv("SMS_RUN_DIR"));

  // Empty string means "unset" — the adapter's own default model.
  const model = process.env.SMS_MODEL === "" ? undefined : process.env.SMS_MODEL;
  const timeoutRaw = process.env.SMS_TIMEOUT;
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined && timeoutRaw.length > 0) {
    const seconds = Number(timeoutRaw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return usageFail(`SMS_TIMEOUT must be a positive number of seconds, got "${timeoutRaw}"`);
    }
    timeoutMs = seconds * 1000;
  }

  const providerCommand = resolveProviderCommand(providerId);
  const skillName = resolveSkillName(skillDir);

  // Run-id allocation is lifecycle core's job when core dispatches; standalone,
  // the run's identity IS its directory (the contract's `runs/<id>/` shape).
  const runId = basename(runDir);

  const record = RunRecord.make({
    schemaVersion: 1,
    id: runId,
    bundle: skillName,
    kind: "eval",
    station: null,
    fixtureCase: caseName,
    skillVersionHash: versionHash,
    provider: providerId,
    model: "",
    startedAt: new Date().toISOString(),
    status: "running",
    actor: Actor.make({ kind: "process", name: "sms-runner" }),
    isolation: "sandbox-home",
  });

  const result = await Effect.runPromise(
    Effect.result(
      runCase({
        caseDir,
        skillDir,
        skillName,
        providerId,
        providerCommand,
        model,
        runDir,
        record,
        timeoutMs,
        onProgress: (event) => {
          if (event.type === "done") {
            process.stderr.write(`sms-runner: done status=${event.status} skillInvoked=${event.skillInvoked}\n`);
          }
        },
      }),
    ),
  );

  if (result._tag === "Failure") {
    const failure = result.failure;
    if (failure._tag === "RunnerPreconditionError") {
      return usageFail(failure.message);
    }
    process.stderr.write(`sms-runner: infra-error: ${failure.message}\n`);
    return EXIT_INFRA_ERROR;
  }

  if (result.success.errorMessage !== undefined) {
    process.stderr.write(`sms-runner: ${result.success.errorMessage}\n`);
  }
  return exitCodeFor(result.success.status);
};

process.exit(await main());
