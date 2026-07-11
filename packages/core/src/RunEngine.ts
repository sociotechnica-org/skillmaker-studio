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
import { WorkspaceIOError } from "./Errors.ts";
import { Journal } from "./JournalService.ts";
import { resolveProviderProfile } from "./ProviderProfile.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  latestSkillVersion,
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
  | { readonly type: "done"; readonly status: RunStatus };

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

const copyPreservingPath = (srcRoot: string, destRoot: string, relPath: string): void => {
  const src = nodeJoin(srcRoot, relPath);
  const dest = nodeJoin(destRoot, relPath);
  mkdirSync(nodeJoin(dest, ".."), { recursive: true });
  writeFileSync(dest, readFileSync(src));
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
    yield* journal.append({
      actor: input.actor,
      type: "skill.version_recorded",
      payload: { bundle: input.bundle, hash: hashes.outputHash, designHash: hashes.designHash },
    });
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
    const onTranscript = (entry: TranscriptEntry): void => {
      entryCount++;
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
        ...(input.timeoutMs !== undefined ? { promptTimeoutMs: input.timeoutMs } : {}),
        onTranscript,
        providerProfile,
      }),
    );

    void entryCount; // retained for a future progress summary; currently only feeds onProgress live.

    const endedAt = new Date().toISOString();
    let status: RunStatus;
    let model = "";
    let stderr = "";
    if (outcome._tag === "Success") {
      model = outcome.success.model ?? "";
      stderr = outcome.success.stderr;
      status = outcome.success.stopReason === "end_turn" ? "completed" : "failed";
    } else {
      const classified = classifyAcpError(outcome.failure);
      status = classified.status;
      stderr = classified.stderr;
    }

    if (status !== "completed") {
      const stderrPath = path.join(runDir, "stderr.txt");
      yield* fs
        .writeFileString(stderrPath, stderr)
        .pipe(Effect.mapError(toIOError(`could not write ${stderrPath}`)));
    }

    // --- Workspace diff -> artifacts/. ---
    const after = snapshotTree(sandboxDir);
    const changedPaths = diffTrees(before, after);
    const artifactsDir = path.join(runDir, "artifacts");
    if (changedPaths.length > 0) {
      yield* fs
        .makeDirectory(artifactsDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${artifactsDir}`)));
      for (const relPath of changedPaths) {
        copyPreservingPath(sandboxDir, artifactsDir, relPath);
      }
    }

    const finalRecord = RunRecord.make({
      ...runningRecord,
      endedAt,
      status,
      model,
    });
    yield* fs
      .writeFileString(runJsonPath, `${JSON.stringify(finalRecord, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${runJsonPath}`)));

    yield* journal.append({
      actor: input.actor,
      type: "run.completed",
      payload: { id: runId, status, endedAt },
    });

    input.onProgress?.({ type: "done", status });

    return {
      runId,
      runDir,
      status,
      skillVersionHash,
      autoRecordedVersion,
      artifacts: changedPaths,
      model,
      skillInstalled,
    } satisfies RunFixtureResult;
  } finally {
    // Sandbox cleanup happens on both the success and failure paths --
    // records under runs/<id>/ are never deleted, only the scratch sandbox.
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

export const _internal = {
  snapshotTree,
  diffTrees,
  resolveFixtureFilesDir,
  classifyAcpError,
  installSkill,
  listFilesRecursive,
};
