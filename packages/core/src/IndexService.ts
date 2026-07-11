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
import { join } from "node:path";
import { BundleIdentity } from "./Bundle.ts";
import type { BundleStage, BundleSubstate } from "./Bundle.ts";
import { BundleState } from "./Bundle.ts";
import { IndexError, JournalReadError, WorkspaceIOError } from "./Errors.ts";
import { bundleForEvent, foldBundleStates } from "./Fold.ts";
import { compareTodos, foldTodos, isArchived } from "./FoldTodos.ts";
import { layer as JournalLayer, Journal } from "./JournalService.ts";
import type { Actor } from "./Actor.ts";
import type { JournalEvent } from "./Journal.ts";
import type { ChecklistItem, Todo, TodoKind, TodoStatus } from "./Todo.ts";
import { computeBundleHashes, computeDrift, foldSkillVersions, latestSkillVersion } from "./Versions.ts";
import type { Drift } from "./Versions.ts";

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

/** bun:sqlite's named-parameter binding shape. */
type SqliteBindings = Record<string, string | number | boolean | null>;

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

const isBundleStage = (value: string): value is BundleStage =>
  (BUNDLE_STAGES as ReadonlyArray<string>).includes(value);

const isBundleSubstate = (value: string): value is BundleSubstate =>
  (BUNDLE_SUBSTATES as ReadonlyArray<string>).includes(value);

const isDrift = (value: string): value is Drift => (DRIFT_VALUES as ReadonlyArray<string>).includes(value);

const isTodoKind = (value: string): value is TodoKind =>
  (TODO_KINDS as ReadonlyArray<string>).includes(value);

const isTodoStatus = (value: string): value is TodoStatus =>
  (TODO_STATUSES as ReadonlyArray<string>).includes(value);

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
  }
>()("IndexService") {}

/**
 * Builds the live IndexService layer for a workspace rooted at
 * `workspaceRoot`. A factory (like `JournalLayer`/`WorkspaceService` scoped
 * calls) because the workspace root is a genuine runtime parameter.
 */
export const layer = (
  workspaceRoot: string,
): Layer.Layer<IndexService, IndexError | JournalReadError, FileSystem | Path> => {
  const dbDir = join(workspaceRoot, ".skillmaker");
  const dbPath = join(dbDir, "studio.db");
  const skillsDir = join(workspaceRoot, "skills");
  const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");

  const base = Layer.effect(IndexService)(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const journal = yield* Journal;

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
       * Scans `skills/*\/bundle.json`, tolerating and reporting malformed
       * files as warnings rather than failing (ruling I). Keyed by directory
       * name, which is the canonical slug.
       */
      const scanBundleIdentities = Effect.fn("IndexService.scanBundleIdentities")(function* () {
        const identities = new Map<string, BundleIdentity>();
        const warnings: string[] = [];

        const skillsDirExists = yield* fs
          .exists(skillsDir)
          .pipe(Effect.mapError(toIndexError(`could not check ${skillsDir}`)));
        if (!skillsDirExists) {
          return { identities, warnings };
        }

        const entries = yield* fs
          .readDirectory(skillsDir)
          .pipe(Effect.mapError(toIndexError(`could not list ${skillsDir}`)));

        for (const entry of entries) {
          const bundleJsonPath = join(skillsDir, entry, "bundle.json");
          const bundleJsonExists = yield* fs
            .exists(bundleJsonPath)
            .pipe(Effect.mapError(toIndexError(`could not check ${bundleJsonPath}`)));
          if (!bundleJsonExists) {
            continue;
          }

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
            warnings.push(
              `skills/${entry}/bundle.json is malformed and was skipped: ${String(outcome.failure)}`,
            );
            continue;
          }
          identities.set(entry, outcome.success);
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
        });
        run();
      };

      const rebuild = Effect.fn("IndexService.rebuild")(function* () {
        const { identities, warnings } = yield* scanBundleIdentities();
        const events = yield* journal.readAll();
        const states = foldBundleStates(events);
        const todos = foldTodos(events);
        const versionsBySlug = foldSkillVersions(events);

        const slugs = new Set<string>([...identities.keys(), ...states.keys()]);
        const records: BundleRecord[] = [];
        const versionRecords: VersionRecord[] = [];
        for (const slug of slugs) {
          const identity = identities.get(slug);
          if (identity === undefined) {
            warnings.push(
              `bundle "${slug}" is recorded in the journal but has no skills/${slug}/bundle.json on disk`,
            );
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
          // has no skills/<slug>/ directory on disk.
          const bundleDir = join(skillsDir, slug);
          const hashes = yield* computeBundleHashes(bundleDir).pipe(
            Effect.provideService(FileSystem, fs),
            Effect.mapError((cause: WorkspaceIOError) => toIndexError(`could not hash bundle "${slug}"`)(cause)),
          );
          const drift = computeDrift(hashes, latest);

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
              populate(tempDb, records, todoRecords, events, versionRecords);
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

        return { bundles: records.length, todos: todoRecords.length, events: events.length, warnings };
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

      return { rebuild, listBundles, getBundle, listTodos, listVersions };
    }),
  );

  return Layer.provide(base, JournalLayer(journalPath));
};
