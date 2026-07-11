/**
 * The Index service: `.skillmaker/studio.db` (data-model.md §2.11), a
 * SQLite-backed, REBUILDABLE CACHE over the two canonical stores — files
 * (`skills/*\/bundle.json`) and the journal (`.skillmaker/events.jsonl`).
 * It is never a source of truth (data-model.md §1.3): `rebuild()` always
 * repopulates the Phase-2/5 subset of the schema (§2.11) — the `bundles`
 * table, the `todos` table, and the `events` journal mirror.
 *
 * `rebuild()` writes into a fresh temp db file in the same directory, then
 * renames it over `studio.db` (`renameSync`, same-filesystem, atomic on
 * POSIX). A concurrent reader that already has `studio.db` open by file
 * descriptor keeps reading its old, complete snapshot until it reopens —
 * it never observes a half-written database (queued follow-up from
 * Phase 4).
 *
 * Malformed `bundle.json` files and bundles that exist in the journal but
 * not on disk are tolerated and reported as warnings, never thrown
 * (data-model.md Part 3 ruling I).
 */
import { Database } from "bun:sqlite";
import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import { renameSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BundleIdentity } from "./Bundle.ts";
import type { BundleStage, BundleSubstate } from "./Bundle.ts";
import { BundleState } from "./Bundle.ts";
import { IndexError, JournalReadError, WorkspaceIOError } from "./Errors.ts";
import { checkCoverage, COVERAGE_VALUES, parseRiskMap } from "./RiskMap.ts";
import type { CoverageValue } from "./RiskMap.ts";
import { scanFixtures } from "./Fixtures.ts";
import type { FixtureCaseRecord } from "./Fixtures.ts";
import { bundleForEvent, foldBundleStates } from "./Fold.ts";
import { compareTodos, foldTodos, isArchived } from "./FoldTodos.ts";
import { layer as JournalLayer, Journal } from "./JournalService.ts";
import type { Actor } from "./Actor.ts";
import type { JournalEvent, RunVerdict } from "./Journal.ts";
import { RunRecord } from "./Run.ts";
import type { RunStatus } from "./Run.ts";
import type { ChecklistItem, Todo, TodoKind, TodoStatus } from "./Todo.ts";
import {
  ADOPT_MARKER_FILENAME,
  computeBundleHashes,
  computeDrift,
  foldSkillVersions,
  latestSkillVersion,
} from "./Versions.ts";
import type { BundleLayout, Drift } from "./Versions.ts";
import { DEFAULT_CONFIG_FILENAME, WorkspaceConfig } from "./Workspace.ts";
import { computeMeasurements } from "./Measurements.ts";
import {
  detectNonDiscriminatingChecks,
  formatSelfCritiqueWarning,
  type GradedRunChecks,
} from "./GraderSelfCritique.ts";
import type { GradedCheck } from "./Journal.ts";
import type { MeasurementRecord } from "./Measurements.ts";

export interface BundleRecord {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly created: string;
  readonly stage: BundleStage;
  readonly substate: BundleSubstate;
  readonly archived: boolean;
  /** Live sha256 of `design.md`, computed at the last `rebuild()`. */
  readonly designHash: string;
  /** Live sha256 of the `output/` tree, computed at the last `rebuild()`. */
  readonly outputHash: string;
  /** Drift between the live hashes above and the latest recorded version (data-model.md §2.7). */
  readonly drift: Drift;
}

/** A materialized `skill.version_recorded` row (data-model.md §2.7, §2.11). */
export interface VersionRecord {
  readonly bundle: string;
  readonly hash: string;
  readonly designHash: string;
  readonly label?: string;
  readonly recordedAt: string;
}

/** A materialized todo row (data-model.md §2.11), with `archived` derived at rebuild time. */
export interface TodoRecord {
  readonly id: string;
  readonly kind: TodoKind;
  readonly status: TodoStatus;
  readonly title: string;
  readonly detail?: string;
  readonly checklist?: ReadonlyArray<ChecklistItem>;
  readonly priority: number;
  readonly bundle?: string;
  readonly created: string;
  readonly terminalAt?: string;
  readonly pinned?: boolean;
  readonly archived: boolean;
  readonly source: Actor;
}

export interface ListTodosOptions {
  readonly bundle?: string;
  /** Include archived todos. Default false (archived todos are hidden). */
  readonly includeArchived?: boolean;
}

export interface RebuildResult {
  readonly bundles: number;
  readonly todos: number;
  readonly events: number;
  readonly warnings: ReadonlyArray<string>;
}

/** A materialized `evals/fixtures/<case>/case.json` row (data-model.md §2.5, §2.11). */
export interface FixtureRecord {
  readonly bundle: string;
  readonly caseName: string;
  readonly class: string;
  readonly risks: ReadonlyArray<string>;
  /** Whether `prompt.md` exists next to `case.json` (PROMPT.MD CHANGE); the Evals tab's prompt.md indicator. */
  readonly hasPromptMd: boolean;
}

/** A materialized `evals/risk-map.md` row (data-model.md §2.6, §2.11). No results column, ever. */
export interface RiskCoverageRecord {
  readonly bundle: string;
  readonly riskId: string;
  readonly family: string;
  readonly coverage: CoverageValue;
  readonly fixtureCase?: string;
}

/**
 * A materialized `runs/<id>/run.json` row (data-model.md §2.8, §2.11),
 * joined with the latest `run.graded` journal event for that run id (if
 * any) -- `verdict`/`gradedAt`/`gradedBy` are the grading columns, filled by
 * Phase 9's grading UI; created now so the schema is stable across phases.
 */
export interface RunIndexRecord {
  readonly id: string;
  readonly bundle: string;
  readonly fixtureCase?: string;
  readonly versionHash: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: RunStatus;
  readonly verdict?: RunVerdict;
  readonly gradedAt?: string;
  readonly gradedBy?: Actor;
}

/**
 * One reindex-time warning, persisted so it stays queryable after the
 * rebuild that produced it (Part 3 ruling I: warnings, never hard fails).
 * `source` distinguishes what was being scanned, e.g. `"bundle.json"`,
 * `"journal"`, `"fixtures"`, `"risk-map"`.
 */
export interface WarningRecord {
  readonly bundle?: string;
  readonly source: string;
  readonly message: string;
}

interface BundleRow {
  readonly slug: string;
  readonly name: string;
  readonly one_liner: string;
  readonly tags_json: string;
  readonly created: string;
  readonly stage: string;
  readonly substate: string;
  readonly archived: number;
  readonly design_hash: string;
  readonly output_hash: string;
  readonly drift: string;
}

interface VersionRow {
  readonly bundle: string;
  readonly hash: string;
  readonly design_hash: string;
  readonly label: string | null;
  readonly recorded_at: string;
}

interface TodoRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  readonly detail: string | null;
  readonly checklist_json: string | null;
  readonly priority: number;
  readonly bundle: string | null;
  readonly created: string;
  readonly terminal_at: string | null;
  readonly pinned: number;
  readonly archived: number;
  readonly source_json: string;
}

interface FixtureRow {
  readonly bundle: string;
  readonly case_name: string;
  readonly class: string;
  readonly risks_json: string;
  readonly has_prompt_md: number;
}

interface RiskCoverageRow {
  readonly bundle: string;
  readonly risk_id: string;
  readonly family: string;
  readonly coverage: string;
  readonly fixture_case: string | null;
}

interface WarningRow {
  readonly bundle: string | null;
  readonly source: string;
  readonly message: string;
}

interface RunRow {
  readonly id: string;
  readonly bundle: string;
  readonly fixture_case: string | null;
  readonly version_hash: string;
  readonly provider: string;
  readonly model: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly status: string;
  readonly verdict: string | null;
  readonly graded_at: string | null;
  readonly graded_by_json: string | null;
}

/** bun:sqlite's named-parameter binding shape. */
type SqliteBindings = Record<string, string | number | boolean | null>;

/** One materialized bundle.json, with where it actually lives and how its output tree hashes. */
interface BundleIdentityLocation {
  readonly identity: BundleIdentity;
  readonly dir: string;
  readonly layout: BundleLayout;
}

/** Directory names never descended into while scanning for `bundle.json` (mirrors `Adopt.ts`'s discovery skip-list). */
const BUNDLE_SCAN_SKIP_DIR_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", ".skillmaker"]);

const BUNDLE_STAGES: ReadonlyArray<BundleStage> = [
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
];
const BUNDLE_SUBSTATES: ReadonlyArray<BundleSubstate> = ["working", "awaiting-review"];
const TODO_KINDS: ReadonlyArray<TodoKind> = ["task", "bug", "improvement", "eval"];
const TODO_STATUSES: ReadonlyArray<TodoStatus> = ["open", "in-progress", "done", "wont-do"];
const DRIFT_VALUES: ReadonlyArray<Drift> = [
  "no-version",
  "in-sync",
  "design-changed",
  "output-hand-edited",
  "both",
];
const RUN_STATUSES: ReadonlyArray<RunStatus> = ["running", "completed", "failed", "infra-error"];
const RUN_VERDICTS: ReadonlyArray<RunVerdict> = ["pass", "fail", "partial"];

const isBundleStage = (value: string): value is BundleStage =>
  (BUNDLE_STAGES as ReadonlyArray<string>).includes(value);

const isBundleSubstate = (value: string): value is BundleSubstate =>
  (BUNDLE_SUBSTATES as ReadonlyArray<string>).includes(value);

const isDrift = (value: string): value is Drift => (DRIFT_VALUES as ReadonlyArray<string>).includes(value);

const isTodoKind = (value: string): value is TodoKind =>
  (TODO_KINDS as ReadonlyArray<string>).includes(value);

const isTodoStatus = (value: string): value is TodoStatus =>
  (TODO_STATUSES as ReadonlyArray<string>).includes(value);

const isRunStatus = (value: string): value is RunStatus =>
  (RUN_STATUSES as ReadonlyArray<string>).includes(value);

const isRunVerdict = (value: string): value is RunVerdict =>
  (RUN_VERDICTS as ReadonlyArray<string>).includes(value);

const toIndexError = (message: string) => (cause: unknown) => IndexError.make({ message, cause });

const rowToBundleRecord = (row: BundleRow): Effect.Effect<BundleRecord, IndexError> =>
  Effect.gen(function* () {
    if (!isBundleStage(row.stage)) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: bundle "${row.slug}" has invalid stage "${row.stage}"` }),
      );
    }
    if (!isBundleSubstate(row.substate)) {
      return yield* Effect.fail(
        IndexError.make({
          message: `studio.db: bundle "${row.slug}" has invalid substate "${row.substate}"`,
        }),
      );
    }
    const tags = yield* Effect.try({
      try: () => JSON.parse(row.tags_json) as unknown,
      catch: toIndexError(`studio.db: bundle "${row.slug}" has invalid tags_json`),
    });
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: bundle "${row.slug}" has non-array tags_json` }),
      );
    }
    if (!isDrift(row.drift)) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: bundle "${row.slug}" has invalid drift "${row.drift}"` }),
      );
    }
    return {
      slug: row.slug,
      name: row.name,
      oneLiner: row.one_liner,
      tags,
      created: row.created,
      stage: row.stage,
      substate: row.substate,
      archived: row.archived !== 0,
      designHash: row.design_hash,
      outputHash: row.output_hash,
      drift: row.drift,
    };
  });

const rowToVersionRecord = (row: VersionRow): VersionRecord => ({
  bundle: row.bundle,
  hash: row.hash,
  designHash: row.design_hash,
  ...(row.label !== null ? { label: row.label } : {}),
  recordedAt: row.recorded_at,
});

const rowToTodoRecord = (row: TodoRow): Effect.Effect<TodoRecord, IndexError> =>
  Effect.gen(function* () {
    if (!isTodoKind(row.kind)) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: todo "${row.id}" has invalid kind "${row.kind}"` }),
      );
    }
    if (!isTodoStatus(row.status)) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: todo "${row.id}" has invalid status "${row.status}"` }),
      );
    }
    const checklist = yield* Effect.try({
      try: () =>
        row.checklist_json === null ? undefined : (JSON.parse(row.checklist_json) as ReadonlyArray<ChecklistItem>),
      catch: toIndexError(`studio.db: todo "${row.id}" has invalid checklist_json`),
    });
    const source = yield* Effect.try({
      try: () => JSON.parse(row.source_json) as Actor,
      catch: toIndexError(`studio.db: todo "${row.id}" has invalid source_json`),
    });
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      ...(row.detail !== null ? { detail: row.detail } : {}),
      ...(checklist !== undefined ? { checklist } : {}),
      priority: row.priority,
      ...(row.bundle !== null ? { bundle: row.bundle } : {}),
      created: row.created,
      ...(row.terminal_at !== null ? { terminalAt: row.terminal_at } : {}),
      ...(row.pinned !== 0 ? { pinned: true } : {}),
      archived: row.archived !== 0,
      source,
    };
  });

const isCoverageValue = (value: string): value is CoverageValue =>
  (COVERAGE_VALUES as ReadonlyArray<string>).includes(value);

const rowToFixtureRecord = (row: FixtureRow): Effect.Effect<FixtureRecord, IndexError> =>
  Effect.gen(function* () {
    const risks = yield* Effect.try({
      try: () => JSON.parse(row.risks_json) as unknown,
      catch: toIndexError(`studio.db: fixture "${row.bundle}/${row.case_name}" has invalid risks_json`),
    });
    if (!Array.isArray(risks) || !risks.every((risk) => typeof risk === "string")) {
      return yield* Effect.fail(
        IndexError.make({
          message: `studio.db: fixture "${row.bundle}/${row.case_name}" has non-array risks_json`,
        }),
      );
    }
    return {
      bundle: row.bundle,
      caseName: row.case_name,
      class: row.class,
      risks,
      hasPromptMd: row.has_prompt_md !== 0,
    };
  });

const rowToRiskCoverageRecord = (row: RiskCoverageRow): Effect.Effect<RiskCoverageRecord, IndexError> =>
  Effect.gen(function* () {
    if (!isCoverageValue(row.coverage)) {
      return yield* Effect.fail(
        IndexError.make({
          message: `studio.db: risk_coverage "${row.bundle}/${row.risk_id}" has invalid coverage "${row.coverage}"`,
        }),
      );
    }
    return {
      bundle: row.bundle,
      riskId: row.risk_id,
      family: row.family,
      coverage: row.coverage,
      ...(row.fixture_case !== null ? { fixtureCase: row.fixture_case } : {}),
    };
  });

const rowToWarningRecord = (row: WarningRow): WarningRecord => ({
  ...(row.bundle !== null ? { bundle: row.bundle } : {}),
  source: row.source,
  message: row.message,
});

const rowToRunIndexRecord = (row: RunRow): Effect.Effect<RunIndexRecord, IndexError> =>
  Effect.gen(function* () {
    if (!isRunStatus(row.status)) {
      return yield* Effect.fail(
        IndexError.make({ message: `studio.db: run "${row.id}" has invalid status "${row.status}"` }),
      );
    }
    let verdict: RunVerdict | undefined;
    if (row.verdict !== null) {
      if (!isRunVerdict(row.verdict)) {
        return yield* Effect.fail(
          IndexError.make({ message: `studio.db: run "${row.id}" has invalid verdict "${row.verdict}"` }),
        );
      }
      verdict = row.verdict;
    }
    let gradedBy: Actor | undefined;
    if (row.graded_by_json !== null) {
      gradedBy = yield* Effect.try({
        try: () => JSON.parse(row.graded_by_json as string) as Actor,
        catch: toIndexError(`studio.db: run "${row.id}" has invalid graded_by_json`),
      });
    }
    return {
      id: row.id,
      bundle: row.bundle,
      ...(row.fixture_case !== null ? { fixtureCase: row.fixture_case } : {}),
      versionHash: row.version_hash,
      provider: row.provider,
      model: row.model,
      startedAt: row.started_at,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      status: row.status,
      ...(verdict !== undefined ? { verdict } : {}),
      ...(row.graded_at !== null ? { gradedAt: row.graded_at } : {}),
      ...(gradedBy !== undefined ? { gradedBy } : {}),
    };
  });

const createSchema = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS bundles (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      one_liner TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      created TEXT NOT NULL,
      stage TEXT NOT NULL,
      substate TEXT NOT NULL,
      archived INTEGER NOT NULL,
      design_hash TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      drift TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_versions (
      bundle TEXT NOT NULL,
      hash TEXT NOT NULL,
      design_hash TEXT NOT NULL,
      label TEXT,
      recorded_at TEXT NOT NULL,
      -- "hash" is the output/ tree hash alone: a design-only edit between
      -- two recordings can leave "hash" unchanged while design_hash differs
      -- (data-model.md §2.7 idempotency is keyed on BOTH -- see Version.ts),
      -- so the key must include design_hash too or two legitimate versions
      -- collide.
      PRIMARY KEY (bundle, hash, design_hash)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      checklist_json TEXT,
      priority INTEGER NOT NULL,
      bundle TEXT,
      created TEXT NOT NULL,
      terminal_at TEXT,
      pinned INTEGER NOT NULL,
      archived INTEGER NOT NULL,
      source_json TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      at TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      bundle TEXT,
      payload_json TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS fixtures (
      bundle TEXT NOT NULL,
      case_name TEXT NOT NULL,
      class TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      has_prompt_md INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bundle, case_name)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS risk_coverage (
      bundle TEXT NOT NULL,
      risk_id TEXT NOT NULL,
      family TEXT NOT NULL,
      coverage TEXT NOT NULL,
      fixture_case TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS warnings (
      bundle TEXT,
      source TEXT NOT NULL,
      message TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      bundle TEXT NOT NULL,
      fixture_case TEXT,
      version_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      verdict TEXT,
      graded_at TEXT,
      graded_by_json TEXT
    )
  `);
};

export class IndexService extends Context.Service<
  IndexService,
  {
    readonly rebuild: () => Effect.Effect<RebuildResult, IndexError | JournalReadError>;
    readonly listBundles: () => Effect.Effect<ReadonlyArray<BundleRecord>, IndexError>;
    readonly getBundle: (
      slug: string,
    ) => Effect.Effect<BundleRecord | undefined, IndexError>;
    readonly listTodos: (
      options?: ListTodosOptions,
    ) => Effect.Effect<ReadonlyArray<TodoRecord>, IndexError>;
    /** All recorded versions for a bundle, newest first (data-model.md §2.7). */
    readonly listVersions: (slug: string) => Effect.Effect<ReadonlyArray<VersionRecord>, IndexError>;
    /** All scanned fixture cases for a bundle (data-model.md §2.5, §2.11). */
    readonly listFixtures: (slug: string) => Effect.Effect<ReadonlyArray<FixtureRecord>, IndexError>;
    /** The authored risk-map coverage axis for a bundle (data-model.md §2.6, §2.11). */
    readonly listRiskCoverage: (slug: string) => Effect.Effect<ReadonlyArray<RiskCoverageRecord>, IndexError>;
    /** Reindex-time warnings, optionally filtered to one bundle; app-level warnings have `bundle: undefined`. */
    readonly listWarnings: (slug?: string) => Effect.Effect<ReadonlyArray<WarningRecord>, IndexError>;
    /** Fixture count per bundle (board-card indicator; only bundles with >= 1 fixture appear). */
    readonly listFixtureCounts: () => Effect.Effect<ReadonlyMap<string, number>, IndexError>;
    /** All runs for a bundle, newest first (data-model.md §2.8, §2.11). */
    readonly listRuns: (slug: string) => Effect.Effect<ReadonlyArray<RunIndexRecord>, IndexError>;
    /** Aggregated measurement cells for a bundle, never pooled (data-model.md §2.11, §1.1 laws 5-6). */
    readonly listMeasurements: (
      slug: string,
    ) => Effect.Effect<ReadonlyArray<MeasurementRecord>, IndexError>;
  }
>()("IndexService") {}

/**
 * Builds the live IndexService layer for a workspace rooted at
 * `workspaceRoot`. A factory (like `JournalLayer`/`WorkspaceService` scoped
 * calls) because the workspace root is a genuine runtime parameter.
 */
/**
 * Per-workspace-root serialization: every `GET /api/*` handler in the CLI
 * server opens its OWN `IndexService` layer (its own `bun:sqlite`
 * connection to `studio.db`) and calls `rebuild()` -- there is no shared,
 * long-lived index session. `rebuild()`'s atomic-rename trick
 * (temp-file-then-`renameSync`-over-`studio.db`) is safe against a single
 * concurrent READER on POSIX, but NOT against a second concurrent WRITER
 * doing its own rename of the same path: on macOS/APFS, one connection's
 * `renameSync` over a path another connection still has open can leave that
 * other connection's `bun:sqlite` handle pointing at an invalidated vnode,
 * surfacing as `SQLiteError: disk I/O error (SQLITE_IOERR_VNODE)` on its
 * next query. This is exactly what a real browser session triggers: the
 * viewer's initial page load fires several `/api/*` requests concurrently
 * (bundles, state, todos, skillbook, the events SSE stream), each spinning
 * up its own layer instance and rebuilding at the same time -- so
 * `GET /api/skillbook` intermittently 500s right after startup, while a
 * later, uncontended `curl` succeeds. This queue makes the whole
 * open-connection -> rebuild -> query -> close-connection lifecycle of one
 * `IndexService` layer instance run to completion before the next one (for
 * the same workspace root) is allowed to start, which removes the
 * concurrent-writer case entirely rather than trying to make `bun:sqlite`
 * tolerate it.
 */
const workspaceLocks = new Map<string, Promise<void>>();

const acquireWorkspaceLock = (workspaceRoot: string): Effect.Effect<() => void> =>
  Effect.callback<() => void>((resume) => {
    const previous = workspaceLocks.get(workspaceRoot) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    workspaceLocks.set(
      workspaceRoot,
      previous.then(() => held),
    );
    void previous.then(() => resume(Effect.succeed(release)));
  });

export const layer = (
  workspaceRoot: string,
): Layer.Layer<IndexService, IndexError | JournalReadError, FileSystem | Path> => {
  const dbDir = join(workspaceRoot, ".skillmaker");
  const dbPath = join(dbDir, "studio.db");
  const configPath = join(workspaceRoot, DEFAULT_CONFIG_FILENAME);
  const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");

  const base = Layer.effect(IndexService)(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const journal = yield* Journal;

      // Single source of truth for where bundles live: `config.skillsDir`
      // (data-model.md §2.2), read the same way `WorkspaceService.resolve`
      // does, not a hardcoded "skills" (the flagged inconsistency this
      // phase fixes). Falls back to the documented default "skills" if the
      // config is missing/malformed -- IndexService tolerates that rather
      // than failing the whole index (ruling I), since a missing config at
      // this point is itself surfaced elsewhere (Workspace.resolve).
      const configExists = yield* fs
        .exists(configPath)
        .pipe(Effect.mapError(toIndexError(`could not check ${configPath}`)));
      const skillsDirOutcome = configExists
        ? yield* Effect.result(
            fs.readFileString(configPath).pipe(
              Effect.flatMap((raw) =>
                Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (cause) => cause }),
              ),
              Effect.flatMap((parsed) => Schema.decodeUnknownEffect(WorkspaceConfig)(parsed)),
            ),
          )
        : undefined;
      const skillsDirName: string =
        skillsDirOutcome !== undefined && skillsDirOutcome._tag === "Success"
          ? skillsDirOutcome.success.skillsDir
          : "skills";
      const skillsDir = join(workspaceRoot, skillsDirName);

      // Wait our turn on `workspaceLocks` (see the comment above
      // `acquireWorkspaceLock`) BEFORE even checking `dbExisted`, and don't
      // release until this whole layer instance's db connection is closed
      // (the release below runs LIFO, after the handle's own release) --
      // so no two layer instances for the SAME workspace root ever have a
      // `studio.db` connection open, or a stale `dbExisted` read, at the
      // same time.
      yield* Effect.acquireRelease(acquireWorkspaceLock(workspaceRoot), (release) => Effect.sync(release));

      const dbExisted = yield* fs
        .exists(dbPath)
        .pipe(Effect.mapError(toIndexError(`could not check ${dbPath}`)));

      // Held in a mutable box (not a plain `let` closed over by
      // acquireRelease's *acquire* result) so that `rebuild()` can swap the
      // live connection out from under a scope-scoped release that must
      // close whatever the CURRENT connection is when the layer tears down.
      const handle: { current: Database } = yield* Effect.acquireRelease(
        Effect.try({
          try: (): { current: Database } => ({ current: new Database(dbPath, { create: true }) }),
          catch: toIndexError(`could not open ${dbPath}`),
        }),
        (h) => Effect.sync(() => h.current.close()),
      );

      yield* Effect.try({
        try: () => createSchema(handle.current),
        catch: toIndexError(`could not initialize schema in ${dbPath}`),
      });

      /**
       * Recursively scans the whole workspace for `bundle.json` files
       * (tolerating and reporting malformed ones as warnings, never failing
       * -- ruling I), not just one level under `config.skillsDir`: an
       * in-place-adopted bundle (`Adopt.ts`, strategy-skills-repo-mode.md
       * §3B.8) is never moved into `skillsDir`, so it can live anywhere in
       * the tree. A directory carrying the `.skillmaker-adopt.json` marker
       * alongside its `bundle.json` is layout `"in-place"`; every other
       * `bundle.json` (including ones under `skillsDir`, the normal case)
       * is layout `"output-dir"`. Keyed by the identity's own `slug` field,
       * not the directory name, since an adopted directory's basename need
       * not equal its (slugified) bundle slug.
       */
      const scanBundleIdentities = Effect.fn("IndexService.scanBundleIdentities")(function* () {
        const identities = new Map<string, BundleIdentityLocation>();
        const warnings: WarningRecord[] = [];

        const rootExists = yield* fs
          .exists(workspaceRoot)
          .pipe(Effect.mapError(toIndexError(`could not check ${workspaceRoot}`)));
        if (!rootExists) {
          return { identities, warnings };
        }

        const stack: string[] = [workspaceRoot];
        while (stack.length > 0) {
          const dir = stack.pop();
          if (dir === undefined) {
            continue;
          }

          const entries = yield* fs
            .readDirectory(dir)
            .pipe(Effect.mapError(toIndexError(`could not list ${dir}`)));

          let hasBundleJson = false;
          for (const entry of entries) {
            const full = join(dir, entry);
            const info = yield* fs.stat(full).pipe(Effect.mapError(toIndexError(`could not stat ${full}`)));
            if (info.type === "Directory") {
              if (BUNDLE_SCAN_SKIP_DIR_NAMES.has(entry)) {
                continue;
              }
              stack.push(full);
              continue;
            }
            if (info.type === "File" && entry === "bundle.json") {
              hasBundleJson = true;
            }
          }

          if (!hasBundleJson) {
            continue;
          }

          const bundleJsonPath = join(dir, "bundle.json");
          const relativeLabel = relative(workspaceRoot, bundleJsonPath).split(sep).join("/");

          const attempt = Effect.gen(function* () {
            const raw = yield* fs.readFileString(bundleJsonPath);
            const parsed = yield* Effect.try({
              try: () => JSON.parse(raw) as unknown,
              catch: (cause) => cause,
            });
            return yield* Schema.decodeUnknownEffect(BundleIdentity)(parsed);
          });

          const outcome = yield* Effect.result(attempt);
          if (outcome._tag === "Failure") {
            warnings.push({
              source: "bundle.json",
              message: `${relativeLabel} is malformed and was skipped: ${String(outcome.failure)}`,
            });
            continue;
          }

          const identity = outcome.success;
          const markerExists = yield* fs
            .exists(join(dir, ADOPT_MARKER_FILENAME))
            .pipe(Effect.mapError(toIndexError(`could not check ${join(dir, ADOPT_MARKER_FILENAME)}`)));
          const layout: BundleLayout = markerExists ? "in-place" : "output-dir";

          const existing = identities.get(identity.slug);
          if (existing !== undefined) {
            warnings.push({
              bundle: identity.slug,
              source: "bundle.json",
              message: `duplicate bundle.json for slug "${identity.slug}" at ${relativeLabel} (already found at ${relative(workspaceRoot, existing.dir).split(sep).join("/")}) was skipped`,
            });
            continue;
          }
          identities.set(identity.slug, { identity, dir, layout });
        }

        return { identities, warnings };
      });

      const buildTodoRecords = (todos: ReadonlyMap<string, Todo>, now: Date): TodoRecord[] =>
        [...todos.values()].sort(compareTodos).map((todo) => ({
          id: todo.id,
          kind: todo.kind,
          status: todo.status,
          title: todo.title,
          ...(todo.detail !== undefined ? { detail: todo.detail } : {}),
          ...(todo.checklist !== undefined ? { checklist: todo.checklist } : {}),
          priority: todo.priority,
          ...(todo.bundle !== undefined ? { bundle: todo.bundle } : {}),
          created: todo.created,
          ...(todo.terminalAt !== undefined ? { terminalAt: todo.terminalAt } : {}),
          ...(todo.pinned !== undefined ? { pinned: todo.pinned } : {}),
          archived: isArchived(todo, now),
          source: todo.source,
        }));

      const populate = (
        db: Database,
        records: ReadonlyArray<BundleRecord>,
        todoRecords: ReadonlyArray<TodoRecord>,
        events: ReadonlyArray<JournalEvent>,
        versionRecords: ReadonlyArray<VersionRecord>,
        fixtureRecords: ReadonlyArray<FixtureRecord>,
        riskCoverageRecords: ReadonlyArray<RiskCoverageRecord>,
        warningRecords: ReadonlyArray<WarningRecord>,
        runRecords: ReadonlyArray<RunIndexRecord>,
      ): void => {
        const run = db.transaction(() => {
          const insertBundle = db.query(
            "INSERT INTO bundles (slug, name, one_liner, tags_json, created, stage, substate, archived, design_hash, output_hash, drift) VALUES ($slug, $name, $oneLiner, $tags, $created, $stage, $substate, $archived, $designHash, $outputHash, $drift)",
          );
          for (const record of records) {
            insertBundle.run({
              $slug: record.slug,
              $name: record.name,
              $oneLiner: record.oneLiner,
              $tags: JSON.stringify(record.tags),
              $created: record.created,
              $stage: record.stage,
              $substate: record.substate,
              $archived: record.archived ? 1 : 0,
              $designHash: record.designHash,
              $outputHash: record.outputHash,
              $drift: record.drift,
            });
          }

          const insertVersion = db.query(
            "INSERT INTO skill_versions (bundle, hash, design_hash, label, recorded_at) VALUES ($bundle, $hash, $designHash, $label, $recordedAt)",
          );
          for (const version of versionRecords) {
            insertVersion.run({
              $bundle: version.bundle,
              $hash: version.hash,
              $designHash: version.designHash,
              $label: version.label ?? null,
              $recordedAt: version.recordedAt,
            });
          }

          const insertTodo = db.query(
            "INSERT INTO todos (id, kind, status, title, detail, checklist_json, priority, bundle, created, terminal_at, pinned, archived, source_json) VALUES ($id, $kind, $status, $title, $detail, $checklist, $priority, $bundle, $created, $terminalAt, $pinned, $archived, $source)",
          );
          for (const todo of todoRecords) {
            insertTodo.run({
              $id: todo.id,
              $kind: todo.kind,
              $status: todo.status,
              $title: todo.title,
              $detail: todo.detail ?? null,
              $checklist: todo.checklist !== undefined ? JSON.stringify(todo.checklist) : null,
              $priority: todo.priority,
              $bundle: todo.bundle ?? null,
              $created: todo.created,
              $terminalAt: todo.terminalAt ?? null,
              $pinned: todo.pinned === true ? 1 : 0,
              $archived: todo.archived ? 1 : 0,
              $source: JSON.stringify(todo.source),
            });
          }

          const insertEvent = db.query(
            "INSERT INTO events (id, type, at, actor_json, bundle, payload_json) VALUES ($id, $type, $at, $actor, $bundle, $payload)",
          );
          for (const event of events) {
            insertEvent.run({
              $id: event.id,
              $type: event.type,
              $at: event.at,
              $actor: JSON.stringify(event.actor),
              $bundle: bundleForEvent(event) ?? null,
              $payload: JSON.stringify(event.payload),
            });
          }

          const insertFixture = db.query(
            "INSERT INTO fixtures (bundle, case_name, class, risks_json, has_prompt_md) VALUES ($bundle, $caseName, $class, $risks, $hasPromptMd)",
          );
          for (const fixture of fixtureRecords) {
            insertFixture.run({
              $bundle: fixture.bundle,
              $caseName: fixture.caseName,
              $class: fixture.class,
              $risks: JSON.stringify(fixture.risks),
              $hasPromptMd: fixture.hasPromptMd ? 1 : 0,
            });
          }

          const insertRiskCoverage = db.query(
            "INSERT INTO risk_coverage (bundle, risk_id, family, coverage, fixture_case) VALUES ($bundle, $riskId, $family, $coverage, $fixtureCase)",
          );
          for (const row of riskCoverageRecords) {
            insertRiskCoverage.run({
              $bundle: row.bundle,
              $riskId: row.riskId,
              $family: row.family,
              $coverage: row.coverage,
              $fixtureCase: row.fixtureCase ?? null,
            });
          }

          const insertWarning = db.query(
            "INSERT INTO warnings (bundle, source, message) VALUES ($bundle, $source, $message)",
          );
          for (const warning of warningRecords) {
            insertWarning.run({
              $bundle: warning.bundle ?? null,
              $source: warning.source,
              $message: warning.message,
            });
          }

          const insertRun = db.query(
            "INSERT INTO runs (id, bundle, fixture_case, version_hash, provider, model, started_at, ended_at, status, verdict, graded_at, graded_by_json) VALUES ($id, $bundle, $fixtureCase, $versionHash, $provider, $model, $startedAt, $endedAt, $status, $verdict, $gradedAt, $gradedBy)",
          );
          for (const runRecord of runRecords) {
            insertRun.run({
              $id: runRecord.id,
              $bundle: runRecord.bundle,
              $fixtureCase: runRecord.fixtureCase ?? null,
              $versionHash: runRecord.versionHash,
              $provider: runRecord.provider,
              $model: runRecord.model,
              $startedAt: runRecord.startedAt,
              $endedAt: runRecord.endedAt ?? null,
              $status: runRecord.status,
              $verdict: runRecord.verdict ?? null,
              $gradedAt: runRecord.gradedAt ?? null,
              $gradedBy: runRecord.gradedBy !== undefined ? JSON.stringify(runRecord.gradedBy) : null,
            });
          }
        });
        run();
      };

      const rebuild = Effect.fn("IndexService.rebuild")(function* () {
        const { identities, warnings } = yield* scanBundleIdentities();
        const events = yield* journal.readAll();
        const states = foldBundleStates(events);
        const todos = foldTodos(events);
        const versionsBySlug = foldSkillVersions(events);

        // Latest `run.graded` event per run id -- the grading columns
        // joined onto each `runs` row below (data-model.md §2.11's
        // "-- latest run.graded" comment). Events are already in append
        // order, so a later event for the same run id overwrites an
        // earlier one, leaving the latest grade.
        const gradeByRunId = new Map<
          string,
          {
            readonly verdict: RunVerdict;
            readonly gradedAt: string;
            readonly gradedBy: Actor;
            readonly checks: ReadonlyArray<GradedCheck> | undefined;
          }
        >();
        for (const event of events) {
          if (event.type !== "run.graded") continue;
          gradeByRunId.set(event.payload.id, {
            verdict: event.payload.verdict,
            gradedAt: event.at,
            gradedBy: event.actor,
            checks: event.payload.checks,
          });
        }
        // Grader self-critique input (Phase 10 fold-in #3): one entry per
        // graded run that carries checks, gathered as run.json files are
        // scanned below (so it only includes checks tied to a run that
        // still exists on disk, not an orphaned run.graded event).
        const gradedRunsForSelfCritique: GradedRunChecks[] = [];

        const slugs = new Set<string>([...identities.keys(), ...states.keys()]);
        const records: BundleRecord[] = [];
        const versionRecords: VersionRecord[] = [];
        const fixtureRecords: FixtureRecord[] = [];
        const riskCoverageRecords: RiskCoverageRecord[] = [];
        const runRecords: RunIndexRecord[] = [];
        for (const slug of slugs) {
          const located = identities.get(slug);
          const identity = located?.identity;
          if (identity === undefined) {
            warnings.push({
              bundle: slug,
              source: "journal",
              message: `bundle "${slug}" is recorded in the journal but has no ${skillsDirName}/${slug}/bundle.json on disk`,
            });
          }
          const state = states.get(slug) ?? BundleState.make({
            slug,
            stage: "idea",
            substate: "working",
            archived: false,
          });

          const versions = versionsBySlug.get(slug);
          for (const version of versions ?? []) {
            versionRecords.push({
              bundle: slug,
              hash: version.hash,
              designHash: version.designHash,
              ...(version.label !== undefined ? { label: version.label } : {}),
              recordedAt: version.recordedAt,
            });
          }
          const latest = latestSkillVersion(versions);

          // `hashDesign`/`hashOutputTree` both tolerate a missing path
          // (treating it as empty), so this is safe even for a journal-only
          // "ghost" bundle (identity undefined, see the warning above) that
          // has no directory on disk at all -- it falls back to the default
          // `skillsDir/<slug>/` location, `output-dir` layout. A located
          // bundle uses its actual directory and layout (`"in-place"` for an
          // adopted bundle, `Adopt.ts`).
          const bundleDir = located?.dir ?? join(skillsDir, slug);
          const layout = located?.layout ?? "output-dir";
          const hashes = yield* computeBundleHashes(bundleDir, layout).pipe(
            Effect.provideService(FileSystem, fs),
            Effect.mapError((cause: WorkspaceIOError) => toIndexError(`could not hash bundle "${slug}"`)(cause)),
          );
          const drift = computeDrift(hashes, latest);

          // Fixtures + risk-map: the honesty layer (data-model.md §2.5/§2.6,
          // plan.md Phase 7). Both tolerate missing directories/files (an
          // "idea"-stage or journal-only ghost bundle has neither) and
          // report defects as warnings, never failures (ruling I).
          const fixtureScan = yield* scanFixtures(bundleDir).pipe(
            Effect.provideService(FileSystem, fs),
            Effect.mapError((cause: WorkspaceIOError) => toIndexError(`could not scan fixtures for "${slug}"`)(cause)),
          );
          for (const warning of fixtureScan.warnings) {
            warnings.push({ bundle: slug, source: "fixtures", message: warning });
          }
          for (const fixtureCase of fixtureScan.cases) {
            fixtureRecords.push({ bundle: slug, ...fixtureCase });
          }

          const riskMapScan = yield* parseRiskMap(join(bundleDir, "evals", "risk-map.md")).pipe(
            Effect.provideService(FileSystem, fs),
            Effect.mapError((cause: WorkspaceIOError) => toIndexError(`could not parse risk-map for "${slug}"`)(cause)),
          );
          for (const warning of riskMapScan.warnings) {
            warnings.push({ bundle: slug, source: "risk-map", message: warning });
          }
          for (const row of riskMapScan.rows) {
            riskCoverageRecords.push({ bundle: slug, ...row });
          }
          for (const warning of checkCoverage(riskMapScan.rows, fixtureScan.cases)) {
            warnings.push({ bundle: slug, source: "risk-map", message: warning });
          }

          // Runs: scan `runs/<id>/run.json` files (data-model.md §2.8,
          // §2.11) -- populated from files, NOT folded from `run.started`/
          // `run.completed` journal events, since `run.json` is the
          // immutable-once-finalized record and is what a run's own
          // directory presence means. Malformed run.json is tolerated and
          // reported as a warning, never a hard failure (ruling I).
          const runsDir = join(bundleDir, "runs");
          const runsDirExists = yield* fs
            .exists(runsDir)
            .pipe(Effect.mapError(toIndexError(`could not check ${runsDir}`)));
          if (runsDirExists) {
            const runEntries = yield* fs
              .readDirectory(runsDir)
              .pipe(Effect.mapError(toIndexError(`could not list ${runsDir}`)));
            for (const runEntry of runEntries) {
              const runEntryDir = join(runsDir, runEntry);
              const runEntryInfo = yield* fs
                .stat(runEntryDir)
                .pipe(Effect.mapError(toIndexError(`could not stat ${runEntryDir}`)));
              if (runEntryInfo.type !== "Directory") {
                continue;
              }
              const runJsonPath = join(runEntryDir, "run.json");
              const runJsonExists = yield* fs
                .exists(runJsonPath)
                .pipe(Effect.mapError(toIndexError(`could not check ${runJsonPath}`)));
              if (!runJsonExists) {
                continue;
              }
              const attempt = Effect.gen(function* () {
                const raw = yield* fs.readFileString(runJsonPath);
                const parsed = yield* Effect.try({
                  try: () => JSON.parse(raw) as unknown,
                  catch: (cause) => cause,
                });
                return yield* Schema.decodeUnknownEffect(RunRecord)(parsed);
              });
              const outcome = yield* Effect.result(attempt);
              if (outcome._tag === "Failure") {
                warnings.push({
                  bundle: slug,
                  source: "runs",
                  message: `runs/${runEntry}/run.json is malformed and was skipped: ${String(outcome.failure)}`,
                });
                continue;
              }
              const runRecord = outcome.success;
              const grade = gradeByRunId.get(runRecord.id);
              if (grade?.checks !== undefined && grade.checks.length > 0 && runRecord.fixtureCase !== undefined) {
                gradedRunsForSelfCritique.push({
                  bundle: slug,
                  fixtureCase: runRecord.fixtureCase,
                  checks: grade.checks,
                });
              }
              runRecords.push({
                id: runRecord.id,
                bundle: slug,
                ...(runRecord.fixtureCase !== undefined ? { fixtureCase: runRecord.fixtureCase } : {}),
                versionHash: runRecord.skillVersionHash,
                provider: runRecord.provider,
                model: runRecord.model,
                startedAt: runRecord.startedAt,
                ...(runRecord.endedAt !== undefined ? { endedAt: runRecord.endedAt } : {}),
                status: runRecord.status,
                ...(grade !== undefined
                  ? { verdict: grade.verdict, gradedAt: grade.gradedAt, gradedBy: grade.gradedBy }
                  : {}),
              });
            }
          }

          records.push({
            slug,
            name: identity?.name ?? slug,
            oneLiner: identity?.oneLiner ?? "",
            tags: identity?.tags ?? [],
            created: identity?.created ?? "",
            stage: state.stage,
            substate: state.substate,
            archived: state.archived,
            designHash: hashes.designHash,
            outputHash: hashes.outputHash,
            drift,
          });
        }

        // Grader self-critique (Phase 10 fold-in #3): across ALL graded
        // runs of a fixture (not per-bundle-loop-iteration, since a check
        // needs the full picture across every run to judge whether it ever
        // discriminates), flag any check that passed every time or failed
        // every time.
        for (const flag of detectNonDiscriminatingChecks(gradedRunsForSelfCritique)) {
          warnings.push({
            bundle: flag.bundle,
            source: "grader-self-critique",
            message: formatSelfCritiqueWarning(flag),
          });
        }

        const todoRecords = buildTodoRecords(todos, new Date());

        yield* fs
          .makeDirectory(dbDir, { recursive: true })
          .pipe(Effect.mapError(toIndexError(`could not create ${dbDir}`)));

        // Atomic rebuild: populate a fresh temp db file, then rename it
        // over `studio.db`. A concurrent process with `studio.db` already
        // open by file descriptor keeps its old, complete snapshot
        // (POSIX rename semantics) -- it never observes a half-written
        // database. Only after a successful rename do we close and reopen
        // this process's own handle.
        const tempPath = join(dbDir, `studio.db.tmp-${crypto.randomUUID()}`);

        yield* Effect.try({
          try: () => {
            const tempDb = new Database(tempPath, { create: true });
            try {
              createSchema(tempDb);
              populate(
                tempDb,
                records,
                todoRecords,
                events,
                versionRecords,
                fixtureRecords,
                riskCoverageRecords,
                warnings,
                runRecords,
              );
            } finally {
              tempDb.close();
            }

            renameSync(tempPath, dbPath);

            handle.current.close();
            handle.current = new Database(dbPath, { create: true });
          },
          catch: (cause) => {
            try {
              unlinkSync(tempPath);
            } catch {
              // Best-effort cleanup; the temp file is harmless orphaned
              // state and never observed by any reader.
            }
            return toIndexError(`could not write ${dbPath}`)(cause);
          },
        });

        return {
          bundles: records.length,
          todos: todoRecords.length,
          events: events.length,
          warnings: warnings.map((warning) => warning.message),
        };
      });

      // The index is a cache: rebuild once up front if the file didn't
      // exist yet, so listBundles/getBundle/listTodos never read an empty
      // index.
      if (!dbExisted) {
        yield* rebuild();
      }

      const listBundles = Effect.fn("IndexService.listBundles")(function* () {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<BundleRow, []>("SELECT * FROM bundles ORDER BY created ASC, slug ASC")
              .all(),
          catch: toIndexError("could not query bundles"),
        });
        const records: BundleRecord[] = [];
        for (const row of rows) {
          records.push(yield* rowToBundleRecord(row));
        }
        return records;
      });

      const getBundle = Effect.fn("IndexService.getBundle")(function* (slug: string) {
        const row = yield* Effect.try({
          try: () =>
            handle.current
              .query<BundleRow, SqliteBindings>("SELECT * FROM bundles WHERE slug = $slug")
              .get({ $slug: slug }),
          catch: toIndexError(`could not query bundle "${slug}"`),
        });
        if (row === null) {
          return undefined;
        }
        return yield* rowToBundleRecord(row);
      });

      const listTodos = Effect.fn("IndexService.listTodos")(function* (options?: ListTodosOptions) {
        const conditions: string[] = [];
        const bindings: SqliteBindings = {};
        if (options?.bundle !== undefined) {
          conditions.push("bundle = $bundle");
          bindings["$bundle"] = options.bundle;
        }
        if (options?.includeArchived !== true) {
          conditions.push("archived = 0");
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<TodoRow, SqliteBindings>(
                `SELECT * FROM todos${where} ORDER BY priority ASC, created ASC, id ASC`,
              )
              .all(bindings),
          catch: toIndexError("could not query todos"),
        });
        const records: TodoRecord[] = [];
        for (const row of rows) {
          records.push(yield* rowToTodoRecord(row));
        }
        return records;
      });

      const listVersions = Effect.fn("IndexService.listVersions")(function* (slug: string) {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<VersionRow, SqliteBindings>(
                "SELECT * FROM skill_versions WHERE bundle = $bundle ORDER BY recorded_at DESC, hash DESC",
              )
              .all({ $bundle: slug }),
          catch: toIndexError(`could not query versions for "${slug}"`),
        });
        return rows.map(rowToVersionRecord);
      });

      const listFixtures = Effect.fn("IndexService.listFixtures")(function* (slug: string) {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<FixtureRow, SqliteBindings>(
                "SELECT * FROM fixtures WHERE bundle = $bundle ORDER BY case_name ASC",
              )
              .all({ $bundle: slug }),
          catch: toIndexError(`could not query fixtures for "${slug}"`),
        });
        const records: FixtureRecord[] = [];
        for (const row of rows) {
          records.push(yield* rowToFixtureRecord(row));
        }
        return records;
      });

      const listRiskCoverage = Effect.fn("IndexService.listRiskCoverage")(function* (slug: string) {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<RiskCoverageRow, SqliteBindings>(
                "SELECT * FROM risk_coverage WHERE bundle = $bundle ORDER BY risk_id ASC",
              )
              .all({ $bundle: slug }),
          catch: toIndexError(`could not query risk_coverage for "${slug}"`),
        });
        const records: RiskCoverageRecord[] = [];
        for (const row of rows) {
          records.push(yield* rowToRiskCoverageRecord(row));
        }
        return records;
      });

      const listWarnings = Effect.fn("IndexService.listWarnings")(function* (slug?: string) {
        const where = slug !== undefined ? " WHERE bundle = $bundle" : "";
        const bindings: SqliteBindings = slug !== undefined ? { $bundle: slug } : {};
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<WarningRow, SqliteBindings>(`SELECT * FROM warnings${where} ORDER BY source ASC, message ASC`)
              .all(bindings),
          catch: toIndexError("could not query warnings"),
        });
        return rows.map(rowToWarningRecord);
      });

      const listFixtureCounts = Effect.fn("IndexService.listFixtureCounts")(function* () {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<{ readonly bundle: string; readonly n: number }, []>(
                "SELECT bundle, COUNT(*) as n FROM fixtures GROUP BY bundle",
              )
              .all(),
          catch: toIndexError("could not query fixture counts"),
        });
        return new Map(rows.map((row) => [row.bundle, row.n] as const));
      });

      /** All runs for a bundle, newest first (data-model.md §2.8, §2.11). */
      const listRuns = Effect.fn("IndexService.listRuns")(function* (slug: string) {
        const rows = yield* Effect.try({
          try: () =>
            handle.current
              .query<RunRow, SqliteBindings>(
                "SELECT * FROM runs WHERE bundle = $bundle ORDER BY started_at DESC, id DESC",
              )
              .all({ $bundle: slug }),
          catch: toIndexError(`could not query runs for "${slug}"`),
        });
        const records: RunIndexRecord[] = [];
        for (const row of rows) {
          records.push(yield* rowToRunIndexRecord(row));
        }
        return records;
      });

      /** Aggregated measurement cells for a bundle, computed from `listRuns` (never pooled -- see Measurements.ts). */
      const listMeasurements = Effect.fn("IndexService.listMeasurements")(function* (slug: string) {
        const runs = yield* listRuns(slug);
        return computeMeasurements(runs);
      });

      return {
        rebuild,
        listBundles,
        getBundle,
        listTodos,
        listVersions,
        listFixtures,
        listRiskCoverage,
        listWarnings,
        listFixtureCounts,
        listRuns,
        listMeasurements,
      };
    }),
  );

  return Layer.provide(base, JournalLayer(journalPath));
};
