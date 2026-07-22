/**
 * The station engine — `runStation()` drives one production-state-machine
 * station's work end to end (data-model.md §2.13, plan.md Phase 10): read
 * the bundle's `stations.json` for a state, resolve the station's `skill`
 * (a bundle slug in the SAME workspace whose `output/` is installed into the
 * sandbox as the skill), build the station prompt (station instructions +
 * the bundle's `design.md` + the latest `revise` notes, if any), run it via
 * `AcpClient` (`Run.kind: "station"`, `station: state`), copy the produced
 * files back into the bundle dir (only paths listed in the station's
 * `produces`), and append `station.started` + `run.started`/`run.completed`
 * + `review.requested` — the bundle enters `awaiting-review` via the
 * existing journal fold (Fold.ts).
 *
 * Deliberately mirrors `RunEngine.ts`'s shape (sandbox lifecycle, ACP
 * session, infra-vs-task classification, artifact diffing) rather than
 * factoring out a shared abstraction — the two engines diverge in exactly
 * the "what gets copied in/out" step, and RunEngine's own doc comment notes
 * it treats the ACP adapter as untrusted, possibly-flaky I/O; duplicating
 * that small amount of sandbox plumbing keeps each engine readable on its
 * own rather than introducing a premature shared base.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import type { Actor } from "./Actor.ts";
import { seedProviderAuth } from "./AuthSeeding.ts";
import type { BundleStage } from "./Bundle.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { foldBundleStates } from "./Fold.ts";
import { Journal } from "./JournalService.ts";
import { resolveProviderProfile } from "./ProviderProfile.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import { didSkillActivate } from "./SkillActivation.ts";
import { Station, StationsFile } from "./Stations.ts";
import { ADOPT_EXCLUDED_NAMES, detectBundleLayout } from "./Versions.ts";
import type { WorkspaceConfig } from "./Workspace.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** Precondition failure: bundle/state/station/skill missing or misconfigured. Distinct from `WorkspaceIOError` (I/O faults) so the CLI can report it as a usage-shaped problem, exactly like `RunEngine.ts`'s `RunPreconditionError`. */
export class StationPreconditionError extends Schema.TaggedErrorClass<StationPreconditionError>()(
  "StationPreconditionError",
  {
    message: Schema.String,
  },
) {}

export interface RunStationInput {
  /** The resolved workspace root (`ResolvedWorkspace.root`). */
  readonly root: string;
  readonly config: WorkspaceConfig;
  /** Bundle slug whose station is being run. */
  readonly bundle: string;
  /** Defaults to the bundle's current folded stage (journal fold). */
  readonly state?: BundleStage;
  /** Provider id from `skillmaker.config.json` `providers`. Defaults to `"claude-code"`. */
  readonly provider?: string;
  readonly actor: Actor;
  /** Default 300_000ms (5 minutes), per `AcpClient`'s default. */
  readonly timeoutMs?: number;
  readonly onProgress?: (event: StationProgressEvent) => void;
  /** Pre-generated run id, same rationale as `RunEngine.ts`'s `RunFixtureInput.runId`. */
  readonly runId?: string;
  /** Issue #140's escape hatch (`skillmaker station run --permissive`): `true` restores the pre-#140 approve-everything behavior; default applies the deny-by-default sandbox policy, same as `RunEngine.ts`. */
  readonly permissive?: boolean;
}

export type StationProgressEvent =
  | { readonly type: "sandbox-ready" }
  | { readonly type: "session-update" }
  /** One permission request decided by the policy (issue #140), mirrored from the transcript's synthetic `permission_decision` entry. */
  | { readonly type: "permission-decision"; readonly decision: "allowed" | "denied"; readonly reason: string }
  | { readonly type: "install-warning"; readonly message: string }
  /** Fix F7: `didSkillActivate`'s transcript signal, surfaced for every station run, same as RunEngine.ts. */
  | { readonly type: "done"; readonly status: RunStatus; readonly skillInvoked: boolean };

export interface RunStationResult {
  readonly runId: string;
  readonly runDir: string;
  readonly status: RunStatus;
  readonly state: BundleStage;
  readonly skill: string;
  /** Paths (relative to the bundle) actually copied back — a subset of the station's `produces`. */
  readonly changedPaths: ReadonlyArray<string>;
  readonly model: string;
  /** Whether `review.requested` was appended (only on a `"completed"` run). */
  readonly reviewRequested: boolean;
  /** `true` if at least one skill file was installed into the sandbox before the session ran (Fix F2's backstop signal). */
  readonly skillInstalled: boolean;
  /** Fix F7: `true` if the transcript shows evidence the station's agent invoked/read the referenced skill (`SkillActivation.ts`'s `didSkillActivate`). */
  readonly skillInvoked: boolean;
}

const DEFAULT_STATION_PROVIDER = "claude-code";

// ---------------------------------------------------------------------------
// Sandbox helpers (plain Node fs, same rationale as RunEngine.ts).
// ---------------------------------------------------------------------------

const dirExists = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const fileExists = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
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

/** Recursively lists every file under `root` (relative paths), or `[]` if `root` doesn't exist. Empty-install-set backstop (Fix F2). */
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

const copyFile = (src: string, dest: string): void => {
  mkdirSync(nodeJoin(dest, ".."), { recursive: true });
  writeFileSync(dest, readFileSync(src));
};

/** Copies one `produces` entry (file or `dir/`-suffixed directory) from `srcRoot` into `destRoot`, tolerating a missing source (the agent may be creating it fresh). */
const seedProducesPath = (srcRoot: string, destRoot: string, relPath: string): void => {
  const src = nodeJoin(srcRoot, relPath);
  const dest = nodeJoin(destRoot, relPath);
  if (relPath.endsWith("/")) {
    if (dirExists(src)) copyDirRecursive(src, dest);
    return;
  }
  if (fileExists(src)) {
    copyFile(src, dest);
  } else if (dirExists(src)) {
    // Tolerate a produces entry without a trailing slash that is actually a
    // directory (e.g. "output/") -- copy recursively either way.
    copyDirRecursive(src, dest);
  }
};

/**
 * Every path seeded into a station's sandbox: the read-only upstream context
 * (`seeds`, friction #16 -- e.g. drafting sees the researching station's
 * `research/`) plus the station's own `produces`. Seeding-only: copyback is
 * still filtered to `produces` alone (`filterToProduces`), so a station can
 * read its seeds but never write them back.
 */
const stationSeedPaths = (station: Station): ReadonlyArray<string> => [
  ...(station.seeds ?? []),
  ...station.produces,
];

/** Whether `relPath` (a changed sandbox path, POSIX-separated) falls under one of the station's `produces` entries -- a file match is exact, a directory match ("research/") is a prefix match. */
const matchesProduces = (relPath: string, produces: ReadonlyArray<string>): boolean =>
  produces.some((entry) => {
    if (entry.endsWith("/")) {
      return relPath === entry.slice(0, -1) || relPath.startsWith(entry);
    }
    return relPath === entry;
  });

/** Filters `changedPaths` down to the ones the station is actually allowed to report/copy back -- the produces-copyback path filter (task scope A/E). */
const filterToProduces = (
  changedPaths: ReadonlyArray<string>,
  produces: ReadonlyArray<string>,
): ReadonlyArray<string> => changedPaths.filter((p) => matchesProduces(p, produces));

/** `.claude` (claude-code) and `.agents` (codex) -- both provider skill-install dirs, so a snapshot taken after the skill is installed (as StationEngine's `before` snapshot always is) never trips a false "changed" diff regardless of which provider ran. */
const IGNORED_TOP_LEVEL = new Set([".git", ".claude", ".agents"]);

/** Recursively hashes every file under `root` (relPath -> content), skipping `.git` and the installed skill dir. Deliberately a plain content map (not a hash) -- stations copy small text files, and this doubles as the "what did the agent write" source for copyback, no need for a second read pass. */
const snapshotFiles = (root: string): Map<string, Buffer> => {
  const out = new Map<string, Buffer>();
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
        out.set(rel, readFileSync(abs));
      }
    }
  };
  walk(root, "");
  return out;
};

const diffFileSnapshots = (before: Map<string, Buffer>, after: Map<string, Buffer>): ReadonlyArray<string> => {
  const changed: string[] = [];
  for (const [relPath, content] of after) {
    const previous = before.get(relPath);
    if (previous === undefined || !previous.equals(content)) {
      changed.push(relPath);
    }
  }
  return changed.sort();
};

// ---------------------------------------------------------------------------
// Failure classification (identical policy to RunEngine.ts).
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

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Finds the latest `review.resolved` event for `(bundle, state)`, if any --
 * used to fold `revise` notes into the next station run's prompt (data-model.md
 * §2.13's non-blocking review pair: "revise notes become the agent's next
 * instruction"). Returns `undefined` when there is none, or when the latest
 * one is an `approve` (nothing to carry forward).
 */
export const latestReviseNotes = (
  events: ReadonlyArray<{
    readonly type: string;
    readonly payload: unknown;
  }>,
  bundle: string,
  state: BundleStage,
): string | undefined => {
  let notes: string | undefined;
  for (const event of events) {
    if (event.type !== "review.resolved") continue;
    const payload = event.payload as {
      readonly bundle?: unknown;
      readonly state?: unknown;
      readonly decision?: unknown;
      readonly notes?: unknown;
    };
    if (payload.bundle !== bundle || payload.state !== state) continue;
    notes = payload.decision === "revise" && typeof payload.notes === "string" ? payload.notes : undefined;
  }
  return notes;
};

export interface BuildStationPromptInput {
  readonly bundle: string;
  readonly state: BundleStage;
  readonly station: Station;
  readonly designMd: string | undefined;
  readonly reviseNotes: string | undefined;
}

/**
 * Assembles the prompt a station's agent runs with: what it's being asked to
 * do (the state + its `produces` list), the bundle's design context
 * (`design.md`, when present), and — the review-pair loop (task scope B) —
 * any outstanding `revise` notes from the most recent `review.resolved` for
 * this exact station, so a re-run picks up exactly where the human left off.
 */
export const buildStationPrompt = (input: BuildStationPromptInput): string => {
  const lines: string[] = [];
  lines.push(`You are running the "${input.state}" production station for the skill bundle "${input.bundle}".`);
  lines.push("");
  lines.push(
    `Your job: produce ${input.station.produces.length === 0 ? "this station's work" : input.station.produces.join(", ")}, then stop.`,
  );
  lines.push("Work directly in the current directory -- it is a sandbox seeded with the bundle's current source files.");
  lines.push("Do not touch any file outside of what this station produces.");

  const seeds = input.station.seeds ?? [];
  if (seeds.length > 0) {
    lines.push("");
    lines.push(
      `Upstream context seeded into this sandbox (read it, do not modify it): ${seeds.join(", ")}.`,
    );
  }

  if (input.reviseNotes !== undefined && input.reviseNotes.trim().length > 0) {
    lines.push("");
    lines.push("A human reviewer sent this station back with revise notes -- address them directly:");
    lines.push("");
    lines.push(`REVISE NOTES: ${input.reviseNotes.trim()}`);
  }

  if (input.designMd !== undefined && input.designMd.trim().length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("The bundle's design.md (source of the skill's logic):");
    lines.push("");
    lines.push(input.designMd);
  }

  return `${lines.join("\n")}\n`;
};

/** A short, deterministic one-liner for `review.requested`'s `question` (task scope A: "a generated one-liner"). Templated, not LLM-generated -- grounded in exactly what changed. */
export const buildReviewQuestion = (state: BundleStage, changedPaths: ReadonlyArray<string>): string =>
  changedPaths.length === 0
    ? `Review the "${state}" station's run -- no files changed.`
    : `Review the "${state}" station's changes to ${changedPaths.join(", ")}.`;

// ---------------------------------------------------------------------------
// runStation
// ---------------------------------------------------------------------------

export const runStation = Effect.fn("StationEngine.runStation")(function* (input: RunStationInput) {
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
      StationPreconditionError.make({ message: `no such bundle "${input.bundle}"` }),
    );
  }

  const events = yield* journal.readAll();
  const state: BundleStage = input.state ?? foldBundleStates(events).get(input.bundle)?.stage ?? "idea";

  const stationsJsonPath = path.join(bundleDir, "stations.json");
  const stationsJsonExists = yield* fs
    .exists(stationsJsonPath)
    .pipe(Effect.mapError(toIOError(`could not check ${stationsJsonPath}`)));
  if (!stationsJsonExists) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `bundle "${input.bundle}" has no stations.json`,
      }),
    );
  }
  const stationsRaw = yield* fs
    .readFileString(stationsJsonPath)
    .pipe(Effect.mapError(toIOError(`could not read ${stationsJsonPath}`)));
  const stationsParsed = yield* Effect.try({
    try: () => JSON.parse(stationsRaw) as unknown,
    catch: toIOError(`invalid JSON in ${stationsJsonPath}`),
  });
  const stationsFile = yield* Schema.decodeUnknownEffect(StationsFile)(stationsParsed).pipe(
    Effect.mapError((cause) =>
      StationPreconditionError.make({ message: `invalid stations.json for "${input.bundle}": ${String(cause)}` }),
    ),
  );

  const station = stationsFile.stations[state];
  if (station === undefined) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `bundle "${input.bundle}" has no station configured for state "${state}"`,
      }),
    );
  }
  if (station.doer !== "agent") {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `the "${state}" station for "${input.bundle}" has doer "${station.doer}" -- only "agent" stations run through the station engine`,
      }),
    );
  }
  if (station.skill === undefined) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `the "${state}" station for "${input.bundle}" has no configured skill`,
      }),
    );
  }
  const skillSlug = station.skill;

  const skillBundleDir = path.join(input.root, input.config.skillsDir, skillSlug);
  const skillBundleJsonExists = yield* fs
    .exists(path.join(skillBundleDir, "bundle.json"))
    .pipe(Effect.mapError(toIOError(`could not check ${skillBundleDir}`)));
  if (!skillBundleJsonExists) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `the "${state}" station for "${input.bundle}" references skill "${skillSlug}", which does not exist as a bundle in this workspace (expected ${input.config.skillsDir}/${skillSlug}/bundle.json)`,
      }),
    );
  }
  const skillBundleLayout = yield* detectBundleLayout(skillBundleDir);
  const skillOutputDir = path.join(skillBundleDir, "output");
  const skillOutputExists = yield* fs
    .exists(skillOutputDir)
    .pipe(Effect.mapError(toIOError(`could not check ${skillOutputDir}`)));
  if (skillBundleLayout === "output-dir" && !skillOutputExists) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `the "${state}" station for "${input.bundle}" references skill "${skillSlug}", which has no output/ to install (it has not been drafted yet)`,
      }),
    );
  }

  const provider = input.provider ?? DEFAULT_STATION_PROVIDER;
  const providerConfig = input.config.providers[provider];
  if (providerConfig === undefined) {
    return yield* Effect.fail(
      StationPreconditionError.make({
        message: `provider "${provider}" is not configured in skillmaker.config.json`,
      }),
    );
  }
  const providerProfile = resolveProviderProfile(provider);

  const designMdPath = path.join(bundleDir, "design.md");
  const designMdExists = yield* fs
    .exists(designMdPath)
    .pipe(Effect.mapError(toIOError(`could not check ${designMdPath}`)));
  const designMd = designMdExists
    ? yield* fs.readFileString(designMdPath).pipe(Effect.mapError(toIOError(`could not read ${designMdPath}`)))
    : undefined;

  const reviseNotes = latestReviseNotes(events, input.bundle, state);
  const prompt = buildStationPrompt({ bundle: input.bundle, state, station, designMd, reviseNotes });

  // --- Sandbox: mkdtemp -> git init -> seed CURRENT source per `seeds` + `produces` (stationSeedPaths) -> install the station's skill. ---
  const sandboxDir = mkdtempSync(nodeJoin(tmpdir(), "skillmaker-station-"));
  const runId = input.runId ?? crypto.randomUUID();
  const runDir = path.join(bundleDir, "runs", runId);
  const transcriptPath = path.join(runDir, "transcript.jsonl");
  const runJsonPath = path.join(runDir, "run.json");
  const startedAt = new Date().toISOString();

  try {
    Bun.spawnSync({ cmd: ["git", "init", "--quiet"], cwd: sandboxDir, stdout: "ignore", stderr: "ignore" });

    for (const relPath of stationSeedPaths(station)) {
      seedProducesPath(bundleDir, sandboxDir, relPath);
    }
    // design.md is always seeded too, even when not itself in `produces` --
    // a drafting station's SKILL.md still needs to read it, and copyback is
    // filtered to `produces` regardless (matchesProduces), so this never
    // widens what gets written back.
    if (designMdExists) {
      copyFile(designMdPath, nodeJoin(sandboxDir, "design.md"));
    }

    const skillInstallDir = nodeJoin(sandboxDir, providerProfile.skillInstallDir, skillSlug);
    if (skillBundleLayout === "in-place") {
      copyDirRecursive(skillBundleDir, skillInstallDir, ADOPT_EXCLUDED_NAMES);
    } else {
      copyDirRecursive(skillOutputDir, skillInstallDir);
    }
    const skillInstalled = listFilesRecursive(skillInstallDir).length > 0;
    if (!skillInstalled) {
      const warning = `no skill files were installed for skill "${skillSlug}" (layout: ${skillBundleLayout}) -- this station's agent has NO skill installed and is running naked`;
      process.stderr.write(`skillmaker station: WARNING: ${warning}\n`);
      input.onProgress?.({ type: "install-warning", message: warning });
    }

    // Fix F6: isolate the ACP adapter subprocess's config directory the
    // same way RunEngine.ts does -- a fresh, empty, run-scoped directory
    // via the provider profile's `configDirEnvVar`, so the subprocess never
    // sees the operator's real `~/.claude/skills` (or provider equivalent)
    // alongside the station's own skill installed above.
    const isolatedConfigDir = nodeJoin(sandboxDir, ".skillmaker-sandbox-config");
    mkdirSync(isolatedConfigDir, { recursive: true });
    const sessionEnv: Record<string, string> = { [providerProfile.configDirEnvVar]: isolatedConfigDir };

    // Seed ONLY the provider's auth material into the isolated config dir, the
    // same way RunEngine.ts does. Without this the freshly-emptied config dir
    // also hides the operator's login, so every sandboxed station run fails
    // with an opaque "Authentication required" (F4). Best-effort: a provider
    // authenticated some other way (env-var API key, CI fake adapter) is never
    // blocked by a failed seed.
    seedProviderAuth(provider, isolatedConfigDir);

    input.onProgress?.({ type: "sandbox-ready" });

    yield* fs
      .makeDirectory(runDir, { recursive: true })
      .pipe(Effect.mapError(toIOError(`could not create ${runDir}`)));

    const runningRecord = RunRecord.make({
      schemaVersion: 1,
      id: runId,
      bundle: input.bundle,
      kind: "station",
      station: state,
      skillVersionHash: "",
      provider,
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
      type: "station.started",
      payload: { bundle: input.bundle, state, runId },
    });
    yield* journal.append({
      actor: input.actor,
      type: "run.started",
      payload: { run: runningRecord },
    });

    const before = snapshotFiles(sandboxDir);

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
        // running agent session (same policy as RunEngine.ts).
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
    writeFileSync(transcriptPath, "");

    const outcome = yield* Effect.result(
      runAcpSession({
        command: providerConfig.command,
        cwd: sandboxDir,
        prompt,
        env: sessionEnv,
        ...(input.timeoutMs !== undefined ? { promptTimeoutMs: input.timeoutMs } : {}),
        onTranscript,
        providerProfile,
        // Issue #140: deny-by-default sandbox policy unless --permissive.
        permissionPolicy:
          input.permissive === true ? permissiveApprovePolicy : makeSandboxPermissionPolicy(sandboxDir),
      }),
    );
    void entryCount;

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

    // --- Copyback: diff the sandbox, keep only paths under `produces`, write them into the bundle dir, mirror into artifacts/. ---
    const after = snapshotFiles(sandboxDir);
    const allChanged = diffFileSnapshots(before, after);
    const changedPaths = filterToProduces(allChanged, station.produces);

    const artifactsDir = path.join(runDir, "artifacts");
    if (changedPaths.length > 0) {
      yield* fs
        .makeDirectory(artifactsDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${artifactsDir}`)));
      for (const relPath of changedPaths) {
        copyFile(nodeJoin(sandboxDir, relPath), nodeJoin(artifactsDir, relPath));
        copyFile(nodeJoin(sandboxDir, relPath), nodeJoin(bundleDir, relPath));
      }
    }

    // Fix F7: `didSkillActivate` used to be computed only for "trigger"-
    // class eval fixtures (Server.ts's `handleRunDetail`); station runs
    // reference a skill too (`skillSlug`, not `input.bundle` -- a station's
    // "bundle" is the production state-machine subject, while `skillSlug` is
    // the actual skill installed/exercised), so it's computed here
    // unconditionally and persisted on run.json.
    const skillInvoked = didSkillActivate(transcriptEntries, skillSlug);

    const finalRecord = RunRecord.make({
      ...runningRecord,
      endedAt,
      status,
      model,
      skillInvoked,
    });
    yield* fs
      .writeFileString(runJsonPath, `${JSON.stringify(finalRecord, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${runJsonPath}`)));

    yield* journal.append({
      actor: input.actor,
      type: "run.completed",
      payload: { id: runId, status, endedAt },
    });

    let reviewRequested = false;
    if (status === "completed") {
      yield* journal.append({
        actor: input.actor,
        type: "review.requested",
        payload: {
          bundle: input.bundle,
          state,
          artifacts: changedPaths,
          question: buildReviewQuestion(state, changedPaths),
        },
      });
      reviewRequested = true;
    }

    input.onProgress?.({ type: "done", status, skillInvoked });

    return {
      runId,
      runDir,
      status,
      state,
      skill: skillSlug,
      changedPaths,
      model,
      reviewRequested,
      skillInstalled,
      skillInvoked,
    } satisfies RunStationResult;
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

export const _internal = {
  seedProducesPath,
  stationSeedPaths,
  matchesProduces,
  filterToProduces,
  snapshotFiles,
  diffFileSnapshots,
  classifyAcpError,
  listFilesRecursive,
};
