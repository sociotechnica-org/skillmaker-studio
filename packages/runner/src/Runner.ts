/**
 * The runner — `runCase()` drives one eval run's execution mechanics end to
 * end: sandbox workspace -> ACP session against the case's `prompt.md` ->
 * transcript streaming -> artifact extraction (workspace diff) -> final
 * `run.json`.
 *
 * THE BOUNDARY (docs/proposals/2026-08-11-architecture-review-runner.md §2):
 * this module is the bundled execution adapter. It knows NOTHING about
 * lifecycle core — no workspace service, no journal, no index. Everything it
 * needs arrives resolved in `RunCaseInput` (a case directory, a resolved
 * skill payload directory, a provider adapter command, an empty run
 * directory, the "running" `RunRecord` to finalize). If Studio disappeared,
 * this would still run a case — that invariant is enforced by the package
 * split (`@skillmaker/runner` depends on `effect` only) and exercised
 * literally by the standalone `sms-runner` bin (`bin.ts`) and its acid test.
 *
 * Failure taxonomy (unchanged from the original core RunEngine): the ACP
 * adapter is treated as an untrusted, possibly flaky subprocess, and
 * auth/sandbox/connection faults (`"infra-error"`) stay strictly separate
 * from genuine task failures (`"failed"`) so pass rates never get polluted
 * by infra noise.
 */
import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as nodeJoin } from "node:path";
import {
  type AcpError,
  AcpAuthError,
  AcpProtocolError,
  AcpSpawnError,
  AcpTimeoutError,
  makeSandboxPermissionPolicy,
  permissiveApprovePolicy,
  runAcpSession,
  type TranscriptEntry,
} from "./AcpClient.ts";
import { seedProviderAuth } from "./AuthSeeding.ts";
import { resolveProviderProfile } from "./ProviderProfile.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import { responseMarkdown } from "./RunResponse.ts";
import { didSkillActivate } from "./SkillActivation.ts";

/** An I/O fault inside the runner (writing run.json / transcript / artifacts, creating the sandbox). The caller (core's dispatch wrapper, or the bin) decides how to surface it — core maps it onto its own `WorkspaceIOError`; the bin exits 3 (infra-error). */
export class RunnerIOError extends Schema.TaggedErrorClass<RunnerIOError>()("RunnerIOError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

/** Precondition failure at the runner's own boundary: the case has no `prompt.md`. Usage-shaped (the bin exits 2), distinct from I/O faults. */
export class RunnerPreconditionError extends Schema.TaggedErrorClass<RunnerPreconditionError>()(
  "RunnerPreconditionError",
  {
    message: Schema.String,
  },
) {}

export type RunProgressEvent =
  | { readonly type: "sandbox-ready" }
  | { readonly type: "session-update" }
  /** One permission request decided by the policy (issue #140): the verdict plus its reason, mirrored from the transcript's synthetic `permission_decision` entry. */
  | { readonly type: "permission-decision"; readonly decision: "allowed" | "denied"; readonly reason: string }
  | { readonly type: "install-warning"; readonly message: string }
  /** Fix F7: `didSkillActivate`'s transcript signal, surfaced for EVERY run (not just "trigger"-class fixtures) so CLI output always reports it. */
  | { readonly type: "done"; readonly status: RunStatus; readonly skillInvoked: boolean };

export interface RunCaseInput {
  /** The case directory: contains `prompt.md`, optionally `case.json` (whose `setup.files` names the files subdir) and `files/`. */
  readonly caseDir: string;
  /**
   * The RESOLVED skill payload directory — the version under test, already
   * layout-resolved by the caller (an `output/` dir, or an in-place bundle
   * dir paired with `excludeTopLevel`). The runner copies it into the
   * sandbox verbatim; it never does layout detection itself (that is
   * lifecycle-core knowledge).
   */
  readonly skillDir: string;
  /** The skill slug: names the sandbox install dir (`<skillInstallDir>/<skillName>`) and drives `didSkillActivate`'s transcript scan. */
  readonly skillName: string;
  /** Top-level names excluded from the skill install copy (an in-place bundle's studio-owned files). The caller supplies the set — the runner does not know what "adopted" means. */
  readonly excludeTopLevel?: ReadonlySet<string> | undefined;
  /** Provider id (e.g. `"claude-code"`) — resolves the `ProviderProfile` (skill install dir, config-dir env var, model extraction, infra stderr signatures) and the auth-seeding shape. */
  readonly providerId: string;
  /** The ACP adapter argv, resolved by the caller (from `skillmaker.config.json`'s `providers`, or the bin's defaults / `SMS_PROVIDER_CMD`). */
  readonly providerCommand: ReadonlyArray<string>;
  /** Caller-requested model id, threaded to `runAcpSession` as `requestedModel`. `undefined` leaves the adapter on its own default model. */
  readonly model?: string | undefined;
  /** The run directory the runner fills: `run.json`, `transcript.jsonl`, `response.md`, `artifacts/`, `stderr.txt` on failure. Created if missing. */
  readonly runDir: string;
  /**
   * The "running" `RunRecord` (status `"running"`, empty model) — written to
   * `run.json` at start and finalized (endedAt/status/model/skillInvoked)
   * at the end. The caller allocates the id and owns every lifecycle-core
   * field on it (bundle, actor, versionHash); the runner treats them as
   * opaque record content.
   */
  readonly record: RunRecord;
  /** Default 300_000ms (5 minutes), per `AcpClient`'s default. */
  readonly timeoutMs?: number | undefined;
  /** Issue #140's escape hatch: `true` restores approve-everything permissions. Default applies the deny-by-default sandbox policy. */
  readonly permissive?: boolean | undefined;
  /** Progress callback, e.g. for the CLI's stderr progress line. Never affects control flow. */
  readonly onProgress?: ((event: RunProgressEvent) => void) | undefined;
}

export interface RunCaseResult {
  readonly status: RunStatus;
  /** Model as reported by the provider ("" when the session never got far enough to report one). */
  readonly model: string;
  /** Relative paths (within `runs/<id>/artifacts/`) of every captured artifact. */
  readonly artifacts: ReadonlyArray<string>;
  /** `true` if at least one skill file was installed into the sandbox before the session ran. `false` means the agent ran naked (Fix F2's backstop signal). */
  readonly skillInstalled: boolean;
  /** Fix F7: `true` if the transcript shows evidence the agent invoked/read the skill (`didSkillActivate`), for EVERY run. */
  readonly skillInvoked: boolean;
  /** Absolute path to `runs/<id>/response.md` — the agent's final message, extracted from the transcript. */
  readonly responsePath: string;
  /** Set only when `status !== "completed"` — surfaced to the caller instead of requiring a `stderr.txt` read. */
  readonly errorMessage?: string;
  /** Relative paths under `artifacts/` that vanished between snapshot and copy and were skipped rather than crashing the run. */
  readonly artifactsSkipped: ReadonlyArray<string>;
  /** Relative paths redacted from `artifacts/` for matching a credential-shaped basename. */
  readonly artifactsRedacted: ReadonlyArray<string>;
  /** The finalized record as written to `run.json` (endedAt/status/model/skillInvoked set). */
  readonly record: RunRecord;
}

// ---------------------------------------------------------------------------
// Workspace-diff helpers (plain Node fs; the sandbox tree is scratch space
// that needs synchronous recursive walks).
// ---------------------------------------------------------------------------

const IGNORED_TOP_LEVEL = new Set([".git"]);

/** Recursively hashes every file under `root`, returning `relativePath -> sha256hex`. Skips `.git`. */
const snapshotTree = (root: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string, relPrefix: string): void => {
    let names: ReadonlyArray<string>;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (relPrefix === "" && IGNORED_TOP_LEVEL.has(name)) continue;
      const abs = nodeJoin(dir, name);
      const rel = relPrefix === "" ? name : `${relPrefix}/${name}`;
      const info = statSync(abs);
      if (info.isDirectory()) {
        walk(abs, rel);
      } else if (info.isFile()) {
        const bytes = readFileSync(abs);
        out.set(rel, createHash("sha256").update(bytes).digest("hex"));
      }
    }
  };
  walk(root, "");
  return out;
};

/** Paths present in `after` but absent from `before`, or present in both with a different hash. */
const diffTrees = (before: Map<string, string>, after: Map<string, string>): ReadonlyArray<string> => {
  const changed: string[] = [];
  for (const [relPath, hash] of after) {
    const previous = before.get(relPath);
    if (previous === undefined || previous !== hash) {
      changed.push(relPath);
    }
  }
  return changed.sort();
};

/**
 * Fix (Phase 20 Story 3 friction log F2): the snapshot/diff/copy sequence is
 * not atomic against the sandbox's own filesystem — a provider CLI can
 * delete its own transient files (shell snapshots, lock files) between the
 * "after" snapshot and this copy. Tolerates exactly that race: an ENOENT on
 * the read means the file is gone, not that anything is broken, so it's
 * skipped (never crashes the run). Any other error (permissions, I/O) still
 * throws — those are real faults the caller should see.
 */
const copyPreservingPath = (srcRoot: string, destRoot: string, relPath: string): "copied" | "skipped" => {
  const src = nodeJoin(srcRoot, relPath);
  const dest = nodeJoin(destRoot, relPath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(src);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "skipped";
    }
    throw error;
  }
  mkdirSync(nodeJoin(dest, ".."), { recursive: true });
  writeFileSync(dest, bytes);
  return "copied";
};

/**
 * Belt-and-suspenders (Phase 20 Story 3 friction log, security amendment on
 * F4): the isolated config dir lives structurally outside `sandboxDir`, so
 * it can never appear in the workspace diff at all — but this redaction
 * guards the artifact-capture path itself against any credential-shaped
 * file that ends up inside the sandbox by some OTHER means. Matched on the
 * file's basename only, case-insensitively.
 */
const CREDENTIAL_LIKE_BASENAME = /^(\.credentials\.json|auth\.json|.*_token.*|.*\.pem)$/i;

const isCredentialLikePath = (relPath: string): boolean => {
  const basename = relPath.split("/").at(-1) ?? relPath;
  return CREDENTIAL_LIKE_BASENAME.test(basename);
};

const copyDirRecursive = (src: string, dest: string, excludeTopLevel?: ReadonlySet<string>): void => {
  let names: ReadonlyArray<string>;
  try {
    names = readdirSync(src);
  } catch {
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const name of names) {
    if (excludeTopLevel?.has(name)) continue;
    const s = nodeJoin(src, name);
    const d = nodeJoin(dest, name);
    const info = statSync(s);
    if (info.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (info.isFile()) {
      writeFileSync(d, readFileSync(s));
    }
  }
};

const dirExists = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Recursively lists every file under `root` (relative paths), or `[]` if `root` doesn't exist. Used to check whether an install actually produced any files — the empty-install-set backstop (Fix F2). */
const listFilesRecursive = (root: string): ReadonlyArray<string> => {
  const out: string[] = [];
  const walk = (dir: string, relPrefix: string): void => {
    let names: ReadonlyArray<string>;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = nodeJoin(dir, name);
      const rel = relPrefix === "" ? name : `${relPrefix}/${name}`;
      const info = statSync(abs);
      if (info.isDirectory()) {
        walk(abs, rel);
      } else if (info.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out;
};

/**
 * Copies the resolved skill payload (`skillDir`) into the sandbox's
 * `skillInstallDir`, minus `excludeTopLevel` (an in-place bundle's
 * studio-owned files — the caller supplies the exclusion set; the runner
 * never does layout detection). Returns the installed file list so the
 * caller can detect the naked-agent case (Fix F2).
 */
const installSkill = (
  skillDir: string,
  skillInstallDir: string,
  excludeTopLevel?: ReadonlySet<string>,
): ReadonlyArray<string> => {
  if (dirExists(skillDir)) {
    copyDirRecursive(skillDir, skillInstallDir, excludeTopLevel);
  }
  return listFilesRecursive(skillInstallDir);
};

/** The `files` subdirectory a case's `setup.files` points at, defaulting to `"files"` when unset or unparsable — tolerant by design. */
const resolveCaseFilesDir = (caseDir: string): string => {
  const caseJsonPath = nodeJoin(caseDir, "case.json");
  let filesRelDir = "files";
  try {
    const raw = readFileSync(caseJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { readonly setup?: { readonly files?: unknown } };
    if (typeof parsed.setup?.files === "string" && parsed.setup.files.length > 0) {
      filesRelDir = parsed.setup.files;
    }
  } catch {
    // Tolerate a missing/malformed case.json — a bad case.json just falls
    // back to the "files" convention.
  }
  return filesRelDir;
};

// ---------------------------------------------------------------------------
// Failure classification (spike/FINDINGS.md's infra-vs-task table)
// ---------------------------------------------------------------------------

interface Classified {
  readonly status: "completed" | "failed" | "infra-error";
  readonly stderr: string;
}

const classifyAcpError = (err: AcpError): Classified => {
  if (err instanceof AcpSpawnError) return { status: "infra-error", stderr: err.stderr };
  if (err instanceof AcpAuthError) return { status: "infra-error", stderr: err.stderr };
  if (err instanceof AcpTimeoutError) return { status: "infra-error", stderr: err.stderr };
  if (err instanceof AcpProtocolError) {
    return { status: err.likelyInfra ? "infra-error" : "failed", stderr: err.stderr };
  }
  return { status: "failed", stderr: "" };
};

/** As implemented (task requirement: report this table). */
export const FAILURE_CLASSIFICATION_TABLE: ReadonlyArray<{
  readonly signal: string;
  readonly status: RunStatus;
}> = [
  { signal: "adapter spawn failure / exits before handshake", status: "infra-error" },
  { signal: "JSON-RPC -32000 (auth required)", status: "infra-error" },
  { signal: "session/prompt exceeds the timeout budget", status: "infra-error" },
  { signal: "connection dropped mid-session", status: "infra-error" },
  { signal: "ambiguous JSON-RPC error, stderr matches an infra signature", status: "infra-error" },
  { signal: "ambiguous JSON-RPC error, stderr does not match an infra signature", status: "failed" },
  { signal: "session completes with stopReason != \"end_turn\"", status: "failed" },
  { signal: "session completes with stopReason == \"end_turn\"", status: "completed" },
];

// ---------------------------------------------------------------------------
// runCase
// ---------------------------------------------------------------------------

const tryIO = <A>(message: string, thunk: () => A) =>
  Effect.try({
    try: thunk,
    catch: (cause) => RunnerIOError.make({ message, cause }),
  });

/** Serializes a `RunRecord` to `runs/<id>/run.json`'s on-disk form (the shipped shape, unchanged). Exported so the bin and core's dispatch wrapper share one writer. */
export const writeRunRecord = (runJsonPath: string, record: RunRecord): void => {
  writeFileSync(runJsonPath, `${JSON.stringify(record, null, 2)}\n`);
};

/**
 * Drives one case run's execution mechanics: sandbox -> skill install ->
 * isolated provider config (+ auth seed) -> one ACP session against the
 * case's `prompt.md` -> workspace diff into `artifacts/` -> `response.md`
 * -> finalized `run.json`. No lifecycle-core knowledge: journal events,
 * run-id allocation, and version bookkeeping are the CALLER's concern,
 * appended around this invocation.
 */
export const runCase = Effect.fn("Runner.runCase")(function* (input: RunCaseInput) {
  const promptPath = nodeJoin(input.caseDir, "prompt.md");
  let prompt: string;
  try {
    prompt = readFileSync(promptPath, "utf8");
  } catch {
    return yield* Effect.fail(
      RunnerPreconditionError.make({ message: `case at ${input.caseDir} has no readable prompt.md` }),
    );
  }

  const providerProfile = resolveProviderProfile(input.providerId);
  const runDir = input.runDir;
  const runJsonPath = nodeJoin(runDir, "run.json");
  const transcriptPath = nodeJoin(runDir, "transcript.jsonl");

  yield* tryIO(`could not create ${runDir}`, () => mkdirSync(runDir, { recursive: true }));
  yield* tryIO(`could not write ${runJsonPath}`, () => writeRunRecord(runJsonPath, input.record));

  // --- Sandbox: mkdtemp -> git init -> copy case files -> install the skill. ---
  const sandboxDir = yield* tryIO("could not create sandbox directory", () =>
    mkdtempSync(nodeJoin(tmpdir(), "skillmaker-run-")),
  );
  // Declared here (not inside `try`) so `finally` can clean it up — `try`
  // and `finally` are separate block scopes; a `const` declared inside
  // `try` is NOT visible inside `finally`, unlike `sandboxDir` above.
  let isolatedConfigDir: string | undefined;

  try {
    Bun.spawnSync({ cmd: ["git", "init", "--quiet"], cwd: sandboxDir, stdout: "ignore", stderr: "ignore" });

    const caseFilesDir = nodeJoin(input.caseDir, resolveCaseFilesDir(input.caseDir));
    if (dirExists(caseFilesDir)) {
      copyDirRecursive(caseFilesDir, sandboxDir);
    }

    const skillInstallDir = nodeJoin(sandboxDir, providerProfile.skillInstallDir, input.skillName);
    const installedFiles = installSkill(input.skillDir, skillInstallDir, input.excludeTopLevel);
    const skillInstalled = installedFiles.length > 0;
    if (!skillInstalled) {
      const warning = `no skill files were installed for skill "${input.skillName}" -- this run's agent has NO skill installed and is running naked`;
      // Belt-and-suspenders backstop (Fix F2): loud regardless of caller,
      // not just routed through onProgress, which callers can ignore.
      process.stderr.write(`skillmaker run: WARNING: ${warning}\n`);
      input.onProgress?.({ type: "install-warning", message: warning });
    }

    // Fix F6: point the ACP adapter subprocess's config directory at a
    // fresh, empty, run-scoped directory via the provider profile's
    // `configDirEnvVar` — a SIBLING temp directory, structurally outside
    // `sandboxDir`, so `snapshotTree(sandboxDir)` can never see it (the
    // security amendment on F4: seeded credential material must never land
    // in `artifacts/`).
    isolatedConfigDir = mkdtempSync(nodeJoin(tmpdir(), "skillmaker-run-config-"));
    const sessionEnv: Record<string, string> = { [providerProfile.configDirEnvVar]: isolatedConfigDir };

    // Fix F4: seed ONLY the auth material this provider's CLI reads (never
    // skills/settings). Best-effort — a provider authenticated some other
    // way (an env-var API key, a CI fake adapter) is never blocked by a
    // failed seed; `authSeed.missingHint` only enriches an auth-shaped
    // session failure below.
    const authSeed = seedProviderAuth(input.providerId, isolatedConfigDir);

    input.onProgress?.({ type: "sandbox-ready" });

    // --- Snapshot the sandbox after setup, before the agent touches it. ---
    const before = snapshotTree(sandboxDir);

    // --- Drive the ACP session, streaming the transcript incrementally. ---
    // Fix F7: kept alongside the incremental file write so `didSkillActivate`
    // can be computed once the session ends without a redundant re-read/
    // re-parse of transcript.jsonl from disk.
    const transcriptEntries: TranscriptEntry[] = [];
    const onTranscript = (entry: TranscriptEntry): void => {
      transcriptEntries.push(entry);
      try {
        writeFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
      } catch {
        // Best-effort: a transcript-write failure must never abort a
        // running agent session.
      }
      if (entry.dir === "synthetic") {
        const message = entry.message as { readonly decision?: unknown; readonly reason?: unknown };
        input.onProgress?.({
          type: "permission-decision",
          decision: message.decision === "denied" ? "denied" : "allowed",
          reason: typeof message.reason === "string" ? message.reason : "",
        });
      } else if (entry.dir === "recv") {
        input.onProgress?.({ type: "session-update" });
      }
    };
    // Ensure the file exists even if the session produces zero updates.
    yield* tryIO(`could not write ${transcriptPath}`, () => writeFileSync(transcriptPath, ""));

    const outcome = yield* Effect.result(
      runAcpSession({
        command: input.providerCommand,
        cwd: sandboxDir,
        prompt,
        env: sessionEnv,
        ...(input.timeoutMs !== undefined ? { promptTimeoutMs: input.timeoutMs } : {}),
        ...(input.model !== undefined ? { requestedModel: input.model } : {}),
        onTranscript,
        providerProfile,
        // Issue #140: deny-by-default sandbox policy unless the caller asked
        // for the --permissive escape hatch.
        permissionPolicy:
          input.permissive === true ? permissiveApprovePolicy : makeSandboxPermissionPolicy(sandboxDir),
      }),
    );

    const endedAt = new Date().toISOString();
    let status: RunStatus;
    let model = "";
    let stderr = "";
    let errorMessage: string | undefined;
    if (outcome._tag === "Success") {
      model = outcome.success.model ?? "";
      stderr = outcome.success.stderr;
      status = outcome.success.stopReason === "end_turn" ? "completed" : "failed";
    } else {
      const classified = classifyAcpError(outcome.failure);
      status = classified.status;
      stderr = classified.stderr;
      // Fix 1: e.g. an unknown `--model` id's "advertised models: ..." list
      // — keep it out of run.json's terse status/model fields and surface
      // it explicitly so a caller doesn't have to grep stderr.txt.
      errorMessage = outcome.failure.message;
      // Fix F4: when the provider itself reports an auth fault AND this
      // run's sandbox had no credential material to seed, replace the
      // opaque "Authentication required" with the EXACT thing that's
      // missing.
      if (outcome.failure._tag === "AcpAuthError" && !authSeed.seeded && authSeed.missingHint !== undefined) {
        errorMessage = `${errorMessage}\n\nsandbox auth: ${authSeed.missingHint}`;
      }
    }

    if (status !== "completed") {
      const stderrPath = nodeJoin(runDir, "stderr.txt");
      const stderrContent = errorMessage !== undefined ? `${errorMessage}\n\n${stderr}` : stderr;
      yield* tryIO(`could not write ${stderrPath}`, () => writeFileSync(stderrPath, stderrContent));
    }

    // --- Workspace diff -> artifacts/. ---
    const after = snapshotTree(sandboxDir);
    const changedPaths = diffTrees(before, after);
    const artifactsDir = nodeJoin(runDir, "artifacts");
    // Fix F2: files that vanished between the "after" snapshot and this copy
    // — skipped, not crashed, and noted on the final run.json.
    const skippedArtifacts: string[] = [];
    // Security amendment on F4: credential-pattern basenames never make it
    // into artifacts/, no matter how they got into the sandbox.
    const redactedArtifacts: string[] = [];
    const copiedArtifacts: string[] = [];
    if (changedPaths.length > 0) {
      yield* tryIO(`could not create ${artifactsDir}`, () => mkdirSync(artifactsDir, { recursive: true }));
      for (const relPath of changedPaths) {
        if (isCredentialLikePath(relPath)) {
          redactedArtifacts.push(relPath);
          continue;
        }
        const copyResult = yield* tryIO(`could not copy artifact ${relPath}`, () =>
          copyPreservingPath(sandboxDir, artifactsDir, relPath),
        );
        if (copyResult === "skipped") {
          skippedArtifacts.push(relPath);
        } else {
          copiedArtifacts.push(relPath);
        }
      }
    }

    // Fix F7: computed unconditionally for every run and persisted on
    // run.json — available to every caller without re-deriving it.
    const skillInvoked = didSkillActivate(transcriptEntries, input.skillName);

    // Fix (Phase 20 Story 4 finding #5): the agent's final message as its
    // own file so grading never requires reading raw `transcript.jsonl`.
    const responsePath = nodeJoin(runDir, "response.md");
    yield* tryIO(`could not write ${responsePath}`, () =>
      writeFileSync(responsePath, responseMarkdown(transcriptEntries)),
    );

    const finalRecord = RunRecord.make({
      ...input.record,
      endedAt,
      status,
      model,
      skillInvoked,
      ...(skippedArtifacts.length > 0 ? { artifactsSkipped: skippedArtifacts } : {}),
      ...(redactedArtifacts.length > 0 ? { artifactsRedacted: redactedArtifacts } : {}),
    });
    yield* tryIO(`could not write ${runJsonPath}`, () => writeRunRecord(runJsonPath, finalRecord));

    input.onProgress?.({ type: "done", status, skillInvoked });

    return {
      status,
      model,
      artifacts: copiedArtifacts,
      skillInstalled,
      skillInvoked,
      responsePath,
      artifactsSkipped: skippedArtifacts,
      artifactsRedacted: redactedArtifacts,
      record: finalRecord,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    } satisfies RunCaseResult;
  } finally {
    // Sandbox cleanup happens on both the success and failure paths —
    // records under runs/<id>/ are never deleted, only the scratch sandbox.
    rmSync(sandboxDir, { recursive: true, force: true });
    // The isolated config dir is a sibling of sandboxDir, not nested inside
    // it, so it needs its own cleanup — never left behind holding seeded
    // auth material. Guarded for undefined: it's only assigned once the try
    // body reaches that point.
    if (isolatedConfigDir !== undefined) {
      rmSync(isolatedConfigDir, { recursive: true, force: true });
    }
  }
});

export const _internal = {
  snapshotTree,
  diffTrees,
  copyPreservingPath,
  resolveCaseFilesDir,
  classifyAcpError,
  installSkill,
  listFilesRecursive,
};
