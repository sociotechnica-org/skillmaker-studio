/**
 * The run dispatch wrapper — `runFixture()` is lifecycle core's thin shell
 * around `@skillmaker/runner`'s `runCase()` (THE MERGE tranche 2,
 * docs/proposals/2026-08-11-architecture-review-runner.md §2).
 *
 * What stays HERE (lifecycle core): preconditions against the workspace
 * (bundle exists, fixture has a prompt, provider is configured), the
 * skill-version drift check + implicit `skill.version_recorded`
 * (data-model.md §2.7), run-id allocation, run-dir creation, and the
 * `run.started`/`run.completed` journal events appended AROUND the runner
 * invocation.
 *
 * What moved to the runner (execution adapter): the sandbox -> ACP session
 * -> transcript -> artifact-diff mechanics, run.json writes, response.md,
 * infra-vs-task failure classification. The runner never knows the journal
 * exists; core passes it a resolved case dir, a resolved skill payload dir,
 * the adapter command, and the "running" record — nothing that requires
 * reaching back into workspace/journal/index machinery.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import {
  type RunCaseResult,
  RunRecord,
  runCase,
  writeRunRecord,
} from "@skillmaker/runner";
import type { RunProgressEvent } from "@skillmaker/runner";
import type { Actor } from "./Actor.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { Journal } from "./JournalService.ts";
import type { RunStatus } from "./Run.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  latestSkillVersion,
  recordSkillVersion,
} from "./Versions.ts";
import type { WorkspaceConfig } from "./Workspace.ts";

export type { RunProgressEvent } from "@skillmaker/runner";
export { FAILURE_CLASSIFICATION_TABLE } from "@skillmaker/runner";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** Precondition failure: bundle/fixture/provider missing or misconfigured. Distinct from `WorkspaceIOError` (I/O faults) so the CLI can report it as a usage-shaped problem. */
export class RunPreconditionError extends Schema.TaggedErrorClass<RunPreconditionError>()(
  "RunPreconditionError",
  {
    message: Schema.String,
  },
) {}

export interface RunFixtureInput {
  /** The resolved workspace root (`ResolvedWorkspace.root`). */
  readonly root: string;
  readonly config: WorkspaceConfig;
  /** Bundle slug. */
  readonly bundle: string;
  readonly fixtureCase: string;
  /** Provider id from `skillmaker.config.json` `providers`, e.g. `"claude-code"`. */
  readonly provider: string;
  /**
   * Fix 1 (Phase 20 Story 2 friction log F1): a caller-requested model id
   * (`skillmaker run --model <id>`, the server's run-trigger endpoint, or
   * the viewer's model field), threaded through to `runAcpSession` as
   * `requestedModel`. `undefined` leaves the adapter on its own default
   * model.
   */
  readonly model?: string;
  readonly actor: Actor;
  /** Default 300_000ms (5 minutes), per `AcpClient`'s default. */
  readonly timeoutMs?: number;
  /** Progress callback, e.g. for the CLI's `--` stderr progress line. Never affects control flow. */
  readonly onProgress?: (event: RunProgressEvent) => void;
  /**
   * Pre-generated run id, e.g. so a caller can return it to a client before
   * the run finishes (the server's "Run" button spawns this detached and
   * must hand back an id synchronously). Defaults to a fresh `crypto.randomUUID()`.
   */
  readonly runId?: string;
  /**
   * Issue #140's escape hatch: `true` restores the pre-#140 approve-
   * everything permission behavior (`skillmaker run --permissive`).
   * Default (false/undefined) applies the deny-by-default sandbox policy:
   * requests whose referenced paths stay inside the sandbox dir are
   * allowed, anything reaching outside it is denied.
   */
  readonly permissive?: boolean;
}

export interface RunFixtureResult {
  readonly runId: string;
  readonly runDir: string;
  readonly status: RunStatus;
  readonly skillVersionHash: string;
  /** True if a `skill.version_recorded` event was appended implicitly before the run (data-model.md §2.7 "implicit before a run"). */
  readonly autoRecordedVersion: boolean;
  /** Relative paths (within `runs/<id>/artifacts/`) of every captured artifact. */
  readonly artifacts: ReadonlyArray<string>;
  readonly model: string;
  /** `true` if at least one skill file was installed into the sandbox before the session ran. `false` means the agent ran naked (Fix F2's backstop signal). */
  readonly skillInstalled: boolean;
  /** Fix F7: `true` if the transcript shows evidence the agent invoked/read the bundle's skill (`SkillActivation.ts`'s `didSkillActivate`), for EVERY run -- not just "trigger"-class fixtures (the previous, narrower `handleRunDetail`-only exposure). */
  readonly skillInvoked: boolean;
  /** Fix (finding #5): absolute path to `runs/<id>/response.md` -- the agent's final message, extracted from the transcript, so grading against an answer key never requires reading raw `transcript.jsonl`. */
  readonly responsePath: string;
  /** Fix 1: set only when `status !== "completed"`, e.g. an unknown `--model` request's "advertised models: ..." message -- surfaced to the CLI/server caller instead of requiring a `stderr.txt` read to discover why a run failed. */
  readonly errorMessage?: string;
  /** Fix (Phase 20 Story 3 friction log F2): relative paths under `artifacts/` that vanished between snapshot and copy and were skipped rather than crashing the run. Empty when nothing was skipped. */
  readonly artifactsSkipped: ReadonlyArray<string>;
  /** Security amendment on F4: relative paths redacted from `artifacts/` for matching a credential-shaped basename. Empty when nothing was redacted. */
  readonly artifactsRedacted: ReadonlyArray<string>;
}

export const runFixture = Effect.fn("RunEngine.runFixture")(function* (input: RunFixtureInput) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const journal = yield* Journal;

  const bundleDir = path.join(input.root, input.config.skillsDir, input.bundle);
  const bundleJsonPath = path.join(bundleDir, "bundle.json");
  const bundleExists = yield* fs
    .exists(bundleJsonPath)
    .pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));
  if (!bundleExists) {
    return yield* Effect.fail(
      RunPreconditionError.make({ message: `no such bundle "${input.bundle}"` }),
    );
  }

  const caseDir = path.join(bundleDir, "evals", "fixtures", input.fixtureCase);
  const promptPath = path.join(caseDir, "prompt.md");
  const promptExists = yield* fs
    .exists(promptPath)
    .pipe(Effect.mapError(toIOError(`could not check ${promptPath}`)));
  if (!promptExists) {
    return yield* Effect.fail(
      RunPreconditionError.make({
        message: `fixture "${input.fixtureCase}" has no prompt.md (bundle "${input.bundle}")`,
      }),
    );
  }

  const providerConfig = input.config.providers[input.provider];
  if (providerConfig === undefined) {
    return yield* Effect.fail(
      RunPreconditionError.make({
        message: `provider "${input.provider}" is not configured in skillmaker.config.json`,
      }),
    );
  }

  // --- Precondition: a skill version recorded whose hash matches current
  // output/ (data-model.md §2.7 "implicit before a run"). ---
  const events = yield* journal.readAll();
  const versionsBySlug = foldSkillVersions(events);
  const latest = latestSkillVersion(versionsBySlug.get(input.bundle));
  const bundleLayout = yield* detectBundleLayout(bundleDir);
  const hashes = yield* computeBundleHashes(bundleDir, bundleLayout);
  const drift = computeDrift(hashes, latest);

  let skillVersionHash: string;
  let autoRecordedVersion = false;
  if (drift === "in-sync" && latest !== undefined) {
    skillVersionHash = latest.hash;
  } else {
    // Fix F3: route through the SAME idempotency-keyed recordSkillVersion
    // path `version record`/`adopt` use, instead of appending directly with
    // no idempotencyKey. A same-content repeat is a clean no-op; a
    // different-content repeat under the same (bundle, hash, designHash)
    // triple is a catchable conflict, never a raw duplicate write that
    // could brick IndexService's skill_versions table.
    yield* recordSkillVersion(input.bundle, input.actor, hashes.designHash, hashes.outputHash, {
      bundleDir,
      layout: bundleLayout,
    }).pipe(Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void));
    skillVersionHash = hashes.outputHash;
    autoRecordedVersion = true;
  }

  // --- The layout inversion: resolve the skill payload dir HERE, so the
  // runner never needs to know what "adopted"/"in-place" means. ---
  const skillDir = bundleLayout === "in-place" ? bundleDir : path.join(bundleDir, "output");
  const excludeTopLevel = bundleLayout === "in-place" ? ADOPT_EXCLUDED_NAMES : undefined;

  // --- Run-id allocation + run-dir creation: lifecycle core's job. ---
  const runId = input.runId ?? crypto.randomUUID();
  const runDir = path.join(bundleDir, "runs", runId);
  yield* fs
    .makeDirectory(runDir, { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${runDir}`)));

  const runningRecord = RunRecord.make({
    schemaVersion: 1,
    id: runId,
    bundle: input.bundle,
    kind: "eval",
    station: null,
    fixtureCase: input.fixtureCase,
    skillVersionHash,
    provider: input.provider,
    model: "",
    startedAt: new Date().toISOString(),
    status: "running",
    actor: input.actor,
    isolation: "sandbox-home",
  });

  // Preserve the shipped observable ordering: `run.json` (status "running")
  // exists on disk BEFORE the `run.started` event is appended. The runner
  // re-writes the identical record as its own first act (the standalone bin
  // path needs that), which is a harmless idempotent overwrite here.
  const runJsonPath = path.join(runDir, "run.json");
  yield* Effect.try({
    try: () => writeRunRecord(runJsonPath, runningRecord),
    catch: toIOError(`could not write ${runJsonPath}`),
  });

  yield* journal.append({
    actor: input.actor,
    type: "run.started",
    payload: { run: runningRecord },
  });

  // --- Dispatch to the runner. The runner writes run.json (running, then
  // final), transcript.jsonl, response.md, artifacts/ into runDir; core only
  // wraps journal events around it. ---
  const result: RunCaseResult = yield* runCase({
    caseDir,
    skillDir,
    skillName: input.bundle,
    excludeTopLevel,
    providerId: input.provider,
    providerCommand: providerConfig.command,
    model: input.model,
    runDir,
    record: runningRecord,
    timeoutMs: input.timeoutMs,
    permissive: input.permissive,
    onProgress: input.onProgress,
  }).pipe(
    Effect.catchTag("RunnerIOError", (error) =>
      Effect.fail(WorkspaceIOError.make({ message: error.message, cause: error.cause })),
    ),
    Effect.catchTag("RunnerPreconditionError", (error) =>
      Effect.fail(RunPreconditionError.make({ message: error.message })),
    ),
  );

  yield* journal.append({
    actor: input.actor,
    type: "run.completed",
    payload: {
      id: runId,
      status: result.status,
      // The finalized record always carries endedAt; the fallback only
      // defends the type (optionalKey on the schema).
      endedAt: result.record.endedAt ?? new Date().toISOString(),
    },
  });

  return {
    runId,
    runDir,
    status: result.status,
    skillVersionHash,
    autoRecordedVersion,
    artifacts: result.artifacts,
    model: result.model,
    skillInstalled: result.skillInstalled,
    skillInvoked: result.skillInvoked,
    responsePath: result.responsePath,
    artifactsSkipped: result.artifactsSkipped,
    artifactsRedacted: result.artifactsRedacted,
    ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
  } satisfies RunFixtureResult;
});
