/**
 * The Index service: `.skillmaker/studio.db` (data-model.md §2.11), a
 * SQLite-backed, REBUILDABLE CACHE over the two canonical stores — files
 * (`skills/*\/bundle.json`) and the journal (`.skillmaker/events.jsonl`).
 * It is never a source of truth (data-model.md §1.3): `rebuild()` always
 * drops and repopulates the Phase-2 subset of the schema (§2.11) — the
 * `bundles` table and the `events` journal mirror.
 *
 * Malformed `bundle.json` files and bundles that exist in the journal but
 * not on disk are tolerated and reported as warnings, never thrown
 * (data-model.md Part 3 ruling I).
 */
import { Database } from "bun:sqlite";
import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import { join } from "node:path";
import { BundleIdentity } from "./Bundle.ts";
import type { BundleStage, BundleSubstate } from "./Bundle.ts";
import { BundleState } from "./Bundle.ts";
import { IndexError, JournalReadError } from "./Errors.ts";
import { bundleForEvent, foldBundleStates } from "./Fold.ts";
import { layer as JournalLayer, Journal } from "./JournalService.ts";

export interface BundleRecord {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly created: string;
  readonly stage: BundleStage;
  readonly substate: BundleSubstate;
  readonly archived: boolean;
}

export interface RebuildResult {
  readonly bundles: number;
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

const isBundleStage = (value: string): value is BundleStage =>
  (BUNDLE_STAGES as ReadonlyArray<string>).includes(value);

const isBundleSubstate = (value: string): value is BundleSubstate =>
  (BUNDLE_SUBSTATES as ReadonlyArray<string>).includes(value);

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
    return {
      slug: row.slug,
      name: row.name,
      oneLiner: row.one_liner,
      tags,
      created: row.created,
      stage: row.stage,
      substate: row.substate,
      archived: row.archived !== 0,
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
      archived INTEGER NOT NULL
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
  const dbPath = join(workspaceRoot, ".skillmaker", "studio.db");
  const skillsDir = join(workspaceRoot, "skills");
  const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");

  const base = Layer.effect(IndexService)(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const journal = yield* Journal;

      const dbExisted = yield* fs
        .exists(dbPath)
        .pipe(Effect.mapError(toIndexError(`could not check ${dbPath}`)));

      const db = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Database(dbPath, { create: true }),
          catch: toIndexError(`could not open ${dbPath}`),
        }),
        (database) => Effect.sync(() => database.close()),
      );

      yield* Effect.try({
        try: () => createSchema(db),
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

      const rebuild = Effect.fn("IndexService.rebuild")(function* () {
        const { identities, warnings } = yield* scanBundleIdentities();
        const events = yield* journal.readAll();
        const states = foldBundleStates(events);

        const slugs = new Set<string>([...identities.keys(), ...states.keys()]);
        const records: BundleRecord[] = [];
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
          records.push({
            slug,
            name: identity?.name ?? slug,
            oneLiner: identity?.oneLiner ?? "",
            tags: identity?.tags ?? [],
            created: identity?.created ?? "",
            stage: state.stage,
            substate: state.substate,
            archived: state.archived,
          });
        }

        yield* Effect.try({
          try: () => {
            const run = db.transaction(() => {
              db.run("DROP TABLE IF EXISTS bundles");
              db.run("DROP TABLE IF EXISTS events");
              createSchema(db);

              const insertBundle = db.query(
                "INSERT INTO bundles (slug, name, one_liner, tags_json, created, stage, substate, archived) VALUES ($slug, $name, $oneLiner, $tags, $created, $stage, $substate, $archived)",
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
          },
          catch: toIndexError(`could not write ${dbPath}`),
        });

        return { bundles: records.length, events: events.length, warnings };
      });

      // The index is a cache: rebuild once up front if the file didn't
      // exist yet, so listBundles/getBundle never read an empty index.
      if (!dbExisted) {
        yield* rebuild();
      }

      const listBundles = Effect.fn("IndexService.listBundles")(function* () {
        const rows = yield* Effect.try({
          try: () =>
            db
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
            db
              .query<BundleRow, SqliteBindings>("SELECT * FROM bundles WHERE slug = $slug")
              .get({ $slug: slug }),
          catch: toIndexError(`could not query bundle "${slug}"`),
        });
        if (row === null) {
          return undefined;
        }
        return yield* rowToBundleRecord(row);
      });

      return { rebuild, listBundles, getBundle };
    }),
  );

  return Layer.provide(base, JournalLayer(journalPath));
};
