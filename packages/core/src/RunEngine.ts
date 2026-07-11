/**
 * The run engine — `runFixture()` drives one eval run end to end
 * (data-model.md §2.8): sandbox workspace -> ACP session against the
 * fixture's `prompt.md` -> artifact extraction -> `run.json` +
 * `run.started`/`run.completed` journal events. The first LLM-touching
 * phase; everything here treats the ACP adapter as an untrusted, possibly
 * flaky subprocess and keeps auth/sandbox/connection faults
 * (`"infra-error"`) strictly separate from genuine task failures
 * (`"failed"`) so pass rates never get polluted by infra noise (§2.8).
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
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
  runAcpSession,
  type TranscriptEntry,
} from "./AcpClient.ts";
import type { Actor } from "./Actor.ts";
import { seedProviderAuth } from "./AuthSeeding.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { Journal } from "./JournalService.ts";
import { resolveProviderProfile } from "./ProviderProfile.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import { responseMarkdown } from "./RunResponse.ts";
import { didSkillActivate } from "./SkillActivation.ts";
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
}

export type RunProgressEvent =
  | { readonly type: "sandbox-ready" }
  | { readonly type: "session-update" }
  | { readonly type: "permission-decision" }
  | { readonly type: "install-warning"; readonly message: string }
  /** Fix F7: `didSkillActivate`'s transcript signal, surfaced for EVERY run (not just "trigger"-class fixtures) so CLI output always reports it. */
  | { readonly type: "done"; readonly status: RunStatus; readonly skillInvoked: boolean };

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

// ---------------------------------------------------------------------------
// Workspace-diff helpers (plain Node fs; the sandbox tree is scratch space
// outside the Effect-managed workspace, and needs synchronous recursive
// walks that would be awkward to express through the FileSystem service).
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
 * not atomic against the sandbox's own filesystem -- a provider CLI can
 * delete its own transient files (shell snapshots, lock files) between the
 * "after" snapshot and this copy. Tolerates exactly that race: an ENOENT on
 * the read means the file is gone, not that anything is broken, so it's
 * skipped (never crashes the run). Any other error (permissions, I/O) still
 * throws -- those are real faults the caller should see.
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
 * F4): the isolated config dir now lives structurally outside `sandboxDir`
 * (see `runFixture`'s `isolatedConfigDir`), so it can never appear in the
 * workspace diff at all -- but this redaction guards the artifact-capture
 * path itself against any credential-shaped file that ends up inside the
 * sandbox by some OTHER means (a fixture's own files/, a provider CLI
 * writing state somewhere unexpected inside cwd, a future isolation
 * regression). Matched on the file's basename only, case-insensitively.
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

/** Recursively lists every file under `root` (relative paths), or `[]` if `root` doesn't exist. Used to check whether an install actually produced any files -- the empty-install-set backstop (Fix F2). */
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
 * Resolves which files get installed into the sandbox as "the skill" for a
 * run, layout-aware (Fix F2 -- adopted/in-place bundles have no `output/`,
 * so the old `output/`-only install silently ran a naked agent with no
 * skill at all). `"in-place"` bundles install `bundleDir` itself, minus the
 * same `ADOPT_EXCLUDED_NAMES` studio-owned-file exclusion set
 * `Versions.computeBundleHashes` already uses for hashing in-place bundles
 * -- one exclusion list, shared, not reinvented here.
 */
const installSkill = (
  bundleDir: string,
  skillInstallDir: string,
  layout: "output-dir" | "in-place",
): ReadonlyArray<string> => {
  if (layout === "in-place") {
    copyDirRecursive(bundleDir, skillInstallDir, ADOPT_EXCLUDED_NAMES);
  } else {
    const outputDir = nodeJoin(bundleDir, "output");
    if (dirExists(outputDir)) {
      copyDirRecursive(outputDir, skillInstallDir);
    }
  }
  return listFilesRecursive(skillInstallDir);
};

/** The `files` subdirectory a fixture case's `setup.files` points at, defaulting to `"files"` (FixtureAdd's scaffold convention) when unset or unparsable -- tolerant by design, matching `Fixtures.ts`'s scan philosophy. */
const resolveFixtureFilesDir = (caseDir: string): string => {
  const caseJsonPath = nodeJoin(caseDir, "case.json");
  let filesRelDir = "files";
  try {
    const raw = readFileSync(caseJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { readonly setup?: { readonly files?: unknown } };
    if (typeof parsed.setup?.files === "string" && parsed.setup.files.length > 0) {
      filesRelDir = parsed.setup.files;
    }
  } catch {
    // Tolerate a missing/malformed case.json here -- the precondition check
    // upstream already verified prompt.md exists; a bad case.json just
    // falls back to the "files" convention.
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
// runFixture
// ---------------------------------------------------------------------------

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
  const prompt = yield* fs
    .readFileString(promptPath)
    .pipe(Effect.mapError(toIOError(`could not read ${promptPath}`)));

  const providerConfig = input.config.providers[input.provider];
  if (providerConfig === undefined) {
    return yield* Effect.fail(
      RunPreconditionError.make({
        message: `provider "${input.provider}" is not configured in skillmaker.config.json`,
      }),
    );
  }
  const providerProfile = resolveProviderProfile(input.provider);

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
    yield* recordSkillVersion(input.bundle, input.actor, hashes.designHash, hashes.outputHash).pipe(
      Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void),
    );
    skillVersionHash = hashes.outputHash;
    autoRecordedVersion = true;
  }

  // --- Sandbox: mkdtemp -> git init -> copy fixture files -> install output/ as the skill. ---
  const sandboxDir = mkdtempSync(nodeJoin(tmpdir(), "skillmaker-run-"));
  const runId = input.runId ?? crypto.randomUUID();
  const runDir = path.join(bundleDir, "runs", runId);
  const transcriptPath = path.join(runDir, "transcript.jsonl");
  const runJsonPath = path.join(runDir, "run.json");
  const startedAt = new Date().toISOString();
  // Declared here (not inside `try`) so `finally` can clean it up -- `try`
  // and `finally` are separate block scopes; a `const` declared inside
  // `try` is NOT visible inside `finally`, unlike `sandboxDir` above.
  let isolatedConfigDir: string | undefined;

  try {
    Bun.spawnSync({ cmd: ["git", "init", "--quiet"], cwd: sandboxDir, stdout: "ignore", stderr: "ignore" });

    const fixtureFilesDir = nodeJoin(caseDir, resolveFixtureFilesDir(caseDir));
    if (dirExists(fixtureFilesDir)) {
      copyDirRecursive(fixtureFilesDir, sandboxDir);
    }

    const skillInstallDir = nodeJoin(sandboxDir, providerProfile.skillInstallDir, input.bundle);
    const installedFiles = installSkill(bundleDir, skillInstallDir, bundleLayout);
    const skillInstalled = installedFiles.length > 0;
    if (!skillInstalled) {
      const warning = `no skill files were installed for bundle "${input.bundle}" (layout: ${bundleLayout}) -- this run's agent has NO skill installed and is running naked`;
      // Belt-and-suspenders backstop (Fix F2): loud regardless of caller,
      // not just routed through onProgress, which callers can ignore.
      process.stderr.write(`skillmaker run: WARNING: ${warning}\n`);
      input.onProgress?.({ type: "install-warning", message: warning });
    }

    // Fix F6: point the ACP adapter subprocess's config directory at a
    // fresh, empty, run-scoped directory via the provider profile's
    // `configDirEnvVar`. Without this, the subprocess inherits the
    // operator's real $HOME and the underlying CLI reads the operator's own
    // `~/.claude/skills` (or provider equivalent) in ADDITION to the
    // bundle's skill installed above -- contaminating what this run
    // actually measures.
    //
    // Fix (Phase 20 Story 3 friction log, security amendment on F4): this
    // directory used to live INSIDE `sandboxDir` (`.skillmaker-sandbox-
    // config/`), which put it squarely inside the before/after workspace
    // diff that becomes `runs/<id>/artifacts/`. A provider CLI's config dir
    // routinely contains live credential material (Fix F4 seeds it with
    // exactly that, below) -- so every seeded run risked committing
    // `.credentials.json`/`auth.json` into `artifacts/` under
    // `trackRuns: true`. It's a SIBLING temp directory now, structurally
    // outside `sandboxDir` -- `snapshotTree(sandboxDir)` can never see it,
    // not "excluded by convention" but excluded by construction. This is
    // also the direct fix for F2's "codex sweeps ~60 junk provider files
    // into every run's artifacts/" report: those files were codex's own
    // config-dir churn (`.codex-global-state.json`, session caches, etc.)
    // landing inside the old nested path and getting diffed as "changed".
    isolatedConfigDir = mkdtempSync(nodeJoin(tmpdir(), "skillmaker-run-config-"));
    const sessionEnv: Record<string, string> = { [providerProfile.configDirEnvVar]: isolatedConfigDir };

    // Fix F4: seed ONLY the auth material this provider's CLI reads (never
    // skills/settings) so a sandboxed session authenticates the same way
    // the operator's real shell would, instead of failing with an opaque
    // "Authentication required" that F4's friction log had to dig out of
    // stderr.txt by hand. Best-effort -- a provider authenticated some
    // other way (an env-var API key, a CI fake adapter that never checks
    // auth at all) is never blocked by a failed seed; `authSeed.missingHint`
    // is kept only to enrich the error message if the session later fails
    // with an auth-shaped signal (see below).
    const authSeed = seedProviderAuth(input.provider, isolatedConfigDir);

    input.onProgress?.({ type: "sandbox-ready" });

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
      startedAt,
      status: "running",
      actor: input.actor,
      isolation: "sandbox-home",
    });
    yield* fs
      .writeFileString(runJsonPath, `${JSON.stringify(runningRecord, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${runJsonPath}`)));

    yield* journal.append({
      actor: input.actor,
      type: "run.started",
      payload: { run: runningRecord },
    });

    // --- Snapshot the sandbox after setup, before the agent touches it. ---
    const before = snapshotTree(sandboxDir);

    // --- Drive the ACP session, streaming the transcript incrementally. ---
    let entryCount = 0;
    // Fix F7: kept alongside the incremental file write so `didSkillActivate`
    // can be computed once the session ends without a redundant re-read/
    // re-parse of transcript.jsonl from disk.
    const transcriptEntries: TranscriptEntry[] = [];
    const onTranscript = (entry: TranscriptEntry): void => {
      entryCount++;
      transcriptEntries.push(entry);
      try {
        writeFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
      } catch {
        // Best-effort: a transcript-write failure must never abort a
        // running agent session.
      }
      if (entry.dir === "synthetic") {
        input.onProgress?.({ type: "permission-decision" });
      } else if (entry.dir === "recv") {
        input.onProgress?.({ type: "session-update" });
      }
    };
    // Ensure the file exists even if the session produces zero updates.
    writeFileSync(transcriptPath, "");

    const outcome = yield* Effect.result(
      runAcpSession({
        command: providerConfig.command,
        cwd: sandboxDir,
        prompt,
        env: sessionEnv,
        ...(input.timeoutMs !== undefined ? { promptTimeoutMs: input.timeoutMs } : {}),
        ...(input.model !== undefined ? { requestedModel: input.model } : {}),
        onTranscript,
        providerProfile,
      }),
    );

    void entryCount; // retained for a future progress summary; currently only feeds onProgress live.

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
      // -- keep it out of run.json's terse status/model fields and surface
      // it explicitly so a caller doesn't have to grep stderr.txt.
      errorMessage = outcome.failure.message;
      // Fix F4: when the provider itself reports an auth fault (a distinct
      // `AcpAuthError`, not a generic protocol/spawn/timeout fault) AND this
      // run's sandbox had no credential material to seed, replace the
      // opaque "Authentication required" with the EXACT thing that's
      // missing -- this is the "clear preflight-shaped error naming the
      // exact missing thing" the fix promises, surfaced at the moment auth
      // actually turns out to matter rather than as a blind precondition
      // that would also block providers that don't need this seeding at
      // all (e.g. env-var API keys, CI's fake ACP adapter).
      if (outcome.failure._tag === "AcpAuthError" && !authSeed.seeded && authSeed.missingHint !== undefined) {
        errorMessage = `${errorMessage}\n\nsandbox auth: ${authSeed.missingHint}`;
      }
    }

    if (status !== "completed") {
      const stderrPath = path.join(runDir, "stderr.txt");
      const stderrContent = errorMessage !== undefined ? `${errorMessage}\n\n${stderr}` : stderr;
      yield* fs
        .writeFileString(stderrPath, stderrContent)
        .pipe(Effect.mapError(toIOError(`could not write ${stderrPath}`)));
    }

    // --- Workspace diff -> artifacts/. ---
    const after = snapshotTree(sandboxDir);
    const changedPaths = diffTrees(before, after);
    const artifactsDir = path.join(runDir, "artifacts");
    // Fix F2: files that vanished between the "after" snapshot and this copy
    // (e.g. a provider CLI's own transient churn) -- skipped, not crashed,
    // and noted on the final run.json rather than silently dropped.
    const skippedArtifacts: string[] = [];
    // Security amendment on F4: credential-pattern basenames never make it
    // into artifacts/, no matter how they got into the sandbox.
    const redactedArtifacts: string[] = [];
    const copiedArtifacts: string[] = [];
    if (changedPaths.length > 0) {
      yield* fs
        .makeDirectory(artifactsDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${artifactsDir}`)));
      for (const relPath of changedPaths) {
        if (isCredentialLikePath(relPath)) {
          redactedArtifacts.push(relPath);
          continue;
        }
        if (copyPreservingPath(sandboxDir, artifactsDir, relPath) === "skipped") {
          skippedArtifacts.push(relPath);
        } else {
          copiedArtifacts.push(relPath);
        }
      }
    }

    // Fix F7: `didSkillActivate` used to be computed only for "trigger"-
    // class fixtures (Server.ts's `handleRunDetail`, a narrow viewer-only
    // path). Every run's transcript carries the same evidence regardless of
    // fixture class, so it's computed here unconditionally and persisted on
    // run.json -- available to every caller (viewer, `run` CLI output,
    // future consumers) without re-deriving it, and without depending on
    // the fixture even having a case.json at all.
    const skillInvoked = didSkillActivate(transcriptEntries, input.bundle);

    // Fix (Phase 20 Story 4 finding #5): write the agent's final message out
    // as its own file so grading a run against an answer key never requires
    // reading raw `transcript.jsonl` protocol frames by hand. Best-effort --
    // `responseMarkdown` always returns *something* (an explicit
    // empty-with-note fallback when the transcript carries no
    // `agent_message_chunk` text), so this file always exists for a run
    // that reached this point.
    const responsePath = path.join(runDir, "response.md");
    yield* fs
      .writeFileString(responsePath, responseMarkdown(transcriptEntries))
      .pipe(Effect.mapError(toIOError(`could not write ${responsePath}`)));

    const finalRecord = RunRecord.make({
      ...runningRecord,
      endedAt,
      status,
      model,
      skillInvoked,
      ...(skippedArtifacts.length > 0 ? { artifactsSkipped: skippedArtifacts } : {}),
      ...(redactedArtifacts.length > 0 ? { artifactsRedacted: redactedArtifacts } : {}),
    });
    yield* fs
      .writeFileString(runJsonPath, `${JSON.stringify(finalRecord, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${runJsonPath}`)));

    yield* journal.append({
      actor: input.actor,
      type: "run.completed",
      payload: { id: runId, status, endedAt },
    });

    input.onProgress?.({ type: "done", status, skillInvoked });

    return {
      runId,
      runDir,
      status,
      skillVersionHash,
      autoRecordedVersion,
      artifacts: copiedArtifacts,
      model,
      skillInstalled,
      skillInvoked,
      responsePath,
      artifactsSkipped: skippedArtifacts,
      artifactsRedacted: redactedArtifacts,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    } satisfies RunFixtureResult;
  } finally {
    // Sandbox cleanup happens on both the success and failure paths --
    // records under runs/<id>/ are never deleted, only the scratch sandbox.
    rmSync(sandboxDir, { recursive: true, force: true });
    // The isolated config dir is a sibling of sandboxDir now (Fix F4
    // security amendment), not nested inside it, so it needs its own
    // cleanup -- never left behind holding seeded auth material. Guarded
    // for undefined: it's only assigned once the try body reaches that
    // point, so an early failure before assignment must not throw here.
    if (isolatedConfigDir !== undefined) {
      rmSync(isolatedConfigDir, { recursive: true, force: true });
    }
  }
});

export const _internal = {
  snapshotTree,
  diffTrees,
  copyPreservingPath,
  resolveFixtureFilesDir,
  classifyAcpError,
  installSkill,
  listFilesRecursive,
};
