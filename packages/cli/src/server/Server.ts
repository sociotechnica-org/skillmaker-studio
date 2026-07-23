/**
 * `skillmaker start`'s server: one `Bun.serve` on one origin serving
 * `/api/*` plus the statically built viewer (`packages/cli/src/server/`,
 * plan.md Phase 3). No CORS, no second origin -- the viewer's runtime
 * client hits same-origin `/api/*` paths.
 */
import {
  bundleForEvent,
  checkTransition,
  computeBundleHashes,
  computeMeasurements,
  custodyEventsFor,
  deriveIntakeVerdict,
  detectBundleLayout,
  didSkillActivate,
  foldBundleStates,
  foldTodos,
  gatherIntakeRegistry,
  guardStatus,
  hashReceivedCrate,
  isIdentityGrantingDisposition,
  isTerminalStatus,
  isUnverified,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  JournalEvent,
  listUndisposedCrates,
  parseDossier,
  publishBundle,
  runFixture,
  runStation,
  scanFixtures,
  Workspace,
  WorkspaceLayer,
  type Actor,
  type BundleLayout,
  type BundleLocation,
  type BundleStage,
  type BundleRecord,
  type DossierSections,
  type IntakeStakes,
  type FixtureCaseRecord,
  type FixtureRecord,
  type MeasurementRecord,
  type RiskCoverageRecord,
  type RunIndexRecord,
  type SkillRoutedEvent,
  type Todo,
  type TodoRecord,
  type VersionRecord,
  type WarningRecord,
  type WorkspaceConfig,
} from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve as resolvePath, sep } from "node:path";
import { resolveUserActor } from "../ActorResolver.ts";
import { loadSkillbook } from "../Skillbook.ts";
import { ChatSessionManager } from "./ChatSessions.ts";
import { watchJournal, type JournalWatcherHandle } from "./JournalWatcher.ts";
import { contentTypeFor, resolveStaticPath } from "./StaticFiles.ts";

const HEARTBEAT_MS = 15_000;

/**
 * The v1 event catalog (data-model.md §2.9) is much larger than this --
 * `POST /api/events` only ever accepts the subset a human/agent can
 * meaningfully cause from outside the CLI's own scaffolding commands.
 * Everything else (`bundle.created`, `skill.version_recorded`/`published`/
 * `shipped`, `run.*`, `station.started`) stays CLI/engine-only. `todo.*`
 * joined the allowlist in Phase 5 -- the viewer's todos panel writes
 * directly through this path, same as bundle stage/review actions.
 * `skill.field_report` is the one `skill.*` exception (issue #67): unlike
 * the rest of the `skill.*` family, a field report has no CLI-side
 * computation to protect (no receipts snapshot, no version resolution
 * required) -- it is deliberately "the manually pasted channel, verbatim."
 */
const ALLOWED_API_EVENT_TYPES = new Set([
  "bundle.stage_changed",
  "review.requested",
  "review.resolved",
  "bundle.gate_decided",
  "bundle.archived",
  "bundle.restored",
  "todo.opened",
  "todo.updated",
  "todo.status_changed",
  // Phase 9's grading panel writes directly through this path -- a regrade
  // is a brand-new event (no idempotencyKey), latest wins at fold time
  // (data-model.md §2.9).
  "run.graded",
  // Receive's paste form (issue #67) -- "the manually pasted channel,
  // verbatim." No idempotencyKey, no guard: a field report never fails to
  // append once its payload shape is valid.
  "skill.field_report",
]);

const MAX_BUNDLE_DETAIL_EVENTS = 20;

const DEFAULT_EVENTS_PAGE_SIZE = 50;
const MAX_EVENTS_PAGE_SIZE = 200;

/** `GET /api/intake`'s "recently routed" tail (issue #91): a handful of the most recent dispositions, not the full history -- the dock's own attention queue (`crates`) is the point, this is just enough context that a disposed crate doesn't vanish without a trace. */
const RECENTLY_ROUTED_LIMIT = 10;

export interface StartServerOptions {
  readonly root: string;
  readonly config: WorkspaceConfig;
  readonly port: number;
  readonly viewerDist: string;
  readonly version: string;
}

export interface ServerHandle {
  readonly port: number;
  readonly stop: () => Promise<void>;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const runIndexEffect = <A>(
  root: string,
  program: Effect.Effect<A, unknown, IndexService>,
): Promise<A> =>
  Effect.runPromise(
    program.pipe(Effect.provide(Layer.provide(IndexServiceLayer(root), BunServices.layer))),
  );

const listBundleRecords = (root: string): Promise<ReadonlyArray<BundleRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listBundles();
    }),
  );

/** bundle slug -> fixture count, for the board's subtle fixture-count indicator. */
const listFixtureCounts = (root: string): Promise<Readonly<Record<string, number>>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      const counts = yield* index.listFixtureCounts();
      return Object.fromEntries(counts);
    }),
  );

const getBundleRecord = (root: string, slug: string): Promise<BundleRecord | undefined> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.getBundle(slug);
    }),
  );

/** Every discovered bundle's actual directory + layout (seam pass over #108/#109): the rebuild's own identity scan (`RebuildResult.locations`), the one source that knows where an in-place-adopted bundle really lives. */
const fetchBundleLocations = (root: string): Promise<ReadonlyMap<string, BundleLocation>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      const rebuildResult = yield* index.rebuild();
      return rebuildResult.locations;
    }),
  );

/**
 * The given bundles' actual directories (seam pass over #108/#109): the
 * `<skillsDir>/<slug>` convention when a `bundle.json` actually sits there
 * (the normal case, checked first -- no index work), otherwise ONE
 * `fetchBundleLocations` rebuild shared by every slug that needs the scan.
 * Falls back to the conventional path when the scan knows nothing either
 * (a journal-only bundle has no directory), which then fails naturally on
 * whatever file the caller reads next.
 */
const resolveBundleDirs = async (
  root: string,
  config: WorkspaceConfig,
  slugs: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> => {
  const dirs = new Map<string, string>();
  const unresolved: string[] = [];
  for (const slug of slugs) {
    const conventionalDir = join(root, config.skillsDir, slug);
    if (existsSync(join(conventionalDir, "bundle.json"))) {
      dirs.set(slug, conventionalDir);
    } else {
      unresolved.push(slug);
    }
  }
  if (unresolved.length > 0) {
    const locations = await fetchBundleLocations(root);
    for (const slug of unresolved) {
      dirs.set(slug, locations.get(slug)?.dir ?? join(root, config.skillsDir, slug));
    }
  }
  return dirs;
};

/** One bundle's actual directory -- `resolveBundleDirs` for a single slug. */
const resolveBundleDir = async (root: string, config: WorkspaceConfig, slug: string): Promise<string> => {
  const dirs = await resolveBundleDirs(root, config, [slug]);
  return dirs.get(slug) ?? join(root, config.skillsDir, slug);
};

const listTodoRecords = (root: string, includeSwept: boolean): Promise<ReadonlyArray<TodoRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listTodos({ includeSwept });
    }),
  );

const runJournalEffect = <A>(
  root: string,
  program: Effect.Effect<A, unknown, Journal>,
): Promise<A> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provide(JournalLayer(join(root, ".skillmaker", "events.jsonl")), BunServices.layer)),
    ),
  );

const readJournalEvents = (root: string): Promise<ReadonlyArray<JournalEvent>> =>
  runJournalEffect(
    root,
    Effect.gen(function* () {
      const journal = yield* Journal;
      return yield* journal.readAll();
    }),
  );

/**
 * `GET /api/events[?limit=&before=]` -- the Activity page's journal feed
 * (Phase 17, ui-pass-spec.md §3.1: "new top-level route"). Additive-only:
 * reads the same journal every other endpoint already reads in full
 * (`readJournalEvents`), just paginated newest-first with a cursor. `before`
 * is an event id -- the page returned starts strictly after that event in
 * newest-first order, matching "load older" pagination.
 */
const handleListEvents = async (root: string, url: URL): Promise<Response> => {
  const rawLimit = url.searchParams.get("limit");
  let limit = DEFAULT_EVENTS_PAGE_SIZE;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return jsonResponse({ error: "limit must be a positive integer" }, 400);
    }
    limit = Math.min(parsed, MAX_EVENTS_PAGE_SIZE);
  }

  const before = url.searchParams.get("before");
  const events = await readJournalEvents(root);
  const newestFirst = [...events].reverse();

  let startIndex = 0;
  if (before !== null) {
    const cursorIndex = newestFirst.findIndex((event) => event.id === before);
    if (cursorIndex === -1) {
      return jsonResponse({ error: `no such event "${before}"` }, 400);
    }
    startIndex = cursorIndex + 1;
  }

  const page = newestFirst.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < newestFirst.length;
  const lastEvent = page[page.length - 1];
  const nextCursor = hasMore && lastEvent !== undefined ? lastEvent.id : null;

  return jsonResponse({ events: page, nextCursor });
};

/**
 * `GET /api/field-reports` -- Receive's workspace-wide field-report list
 * (issue #67, `Vision - Board Lab Ship Receive.md` §HOW): "what is the world
 * telling me about what I shipped." Reads the same full journal every other
 * endpoint reads (`readJournalEvents`), filters to `skill.field_report`, and
 * returns it newest-first, unpaginated -- a manually pasted channel is not
 * expected to grow the way the whole journal does, so this deliberately
 * skips `GET /api/events`'s cursor pagination for a small dedicated shape
 * the Receive tab can render directly, no `EventView.payload: Unknown`
 * decoding required.
 *
 * `fixtureCase` (issue #68) closes the loop back the other way: each
 * reported bundle's fixtures are scanned directly (`Fixtures.ts`'s
 * `scanFixtures`, the same tolerant scanner the index itself is built from)
 * for a case whose `source.eventId` matches this report's event id --
 * `fixture harvest`'s provenance stamp. `null` means unharvested. This
 * deliberately does NOT go through `IndexService`: the viewer refetches this
 * endpoint on every SSE journal event, and a full `rebuild()` (a second
 * journal parse + rescan of every bundle in the workspace + a SQLite
 * rewrite) is disproportionate for a read-only lookup over the handful of
 * reported bundles' `case.json` files.
 *
 * `todo` (issue #81) is the same read-time join, the other side of the
 * loop: `foldTodos` over the SAME `events` array already read above (no
 * second journal read) finds the todo, if any, whose `origin.eventId` equals
 * this report's event id -- `todo add --from-report`'s provenance stamp.
 * `null` means no todo has been opened from this report yet.
 */
const handleFieldReports = async (root: string, config: WorkspaceConfig): Promise<Response> => {
  const events = await readJournalEvents(root);
  const reportEvents = events.filter((event) => event.type === "skill.field_report");

  const reportedBundles = [...new Set(reportEvents.map((event) => event.payload.bundle))];
  // Actual directories, not the `<skillsDir>/<slug>` convention (seam pass
  // over #108/#109): a field report on an in-place-adopted bundle must still
  // find its harvested fixture -- one shared lookup for every reported slug.
  const bundleDirs = await resolveBundleDirs(root, config, reportedBundles);
  const fixturesByBundle = await Effect.runPromise(
    Effect.gen(function* () {
      const byBundle = new Map<string, ReadonlyArray<FixtureCaseRecord>>();
      for (const bundle of reportedBundles) {
        const scanned = yield* scanFixtures(bundleDirs.get(bundle) ?? join(root, config.skillsDir, bundle));
        byBundle.set(bundle, scanned.cases);
      }
      return byBundle;
    }).pipe(Effect.provide(BunServices.layer)),
  );

  const harvestedCase = (bundle: string, eventId: string): string | null => {
    const fixtures = fixturesByBundle.get(bundle) ?? [];
    const harvested = fixtures.find(
      (fixture) => fixture.source?.kind === "field-report" && fixture.source.eventId === eventId,
    );
    return harvested?.caseName ?? null;
  };

  const todosByReportEventId = new Map<string, Todo>();
  for (const todo of foldTodos(events).values()) {
    if (todo.origin?.kind === "field-report") {
      todosByReportEventId.set(todo.origin.eventId, todo);
    }
  }
  const linkedTodo = (eventId: string): { id: string; title: string; status: string } | null => {
    const todo = todosByReportEventId.get(eventId);
    return todo === undefined ? null : { id: todo.id, title: todo.title, status: todo.status };
  };

  const reports = reportEvents
    .map((event) => ({
      id: event.id,
      bundle: event.payload.bundle,
      outcome: event.payload.outcome,
      report: event.payload.report,
      versionHash: event.payload.versionHash ?? null,
      destination: event.payload.destination ?? null,
      at: event.at,
      actor: event.actor,
      fixtureCase: harvestedCase(event.payload.bundle, event.id),
      todo: linkedTodo(event.id),
    }))
    .reverse();
  return jsonResponse({ reports });
};

/**
 * `GET /api/intake` -- the Receive tab's intake queue (issue #90,
 * `Mechanism - Receiving Dock.md` §HOW): undisposed crates, oldest first --
 * "the dock must not become a shelf: oldest-first IS the attention
 * ordering." `readJournalEvents` already returns append order (oldest
 * first), so `listUndisposedCrates`'s output needs no re-sort.
 *
 * Each crate's dock verdict is recomputed HERE, fresh, every request (house
 * law: derive, never store) -- re-hashes `receiving/<intake-id>/` as it
 * stands right now (`hashReceivedCrate`) and re-derives against the
 * registry as it stands right now (`gatherIntakeRegistry` +
 * `deriveIntakeVerdict`), the exact same three functions `skillmaker
 * receive` calls at write time. A crate whose directory has since vanished
 * still resolves cleanly (`hashOutputTree`'s well-defined empty-tree hash
 * for a missing dir, `Versions.ts`), never a 500.
 *
 * `listUndisposedCrates` reads the real `skill.routed` event type (issue
 * #91): a routed crate (any disposition, including `salvage` -- disposed is
 * disposed) leaves this list for good.
 *
 * `recentlyRouted` (issue #91) is the OTHER half of "disposed crates leave
 * the queue... or collapse into a recently routed tail": the last few
 * `skill.routed` events, newest first, each joined back to its
 * `skill.received`'s `claimedName` (from the SAME `events` array already
 * read above -- no second journal read) so the tail reads as "crate ->
 * disposition -> why," not a bare intake id.
 *
 * NOTE (issue #91, flagged not fixed): this handler still parses the
 * journal twice per request -- `readJournalEvents` above, and
 * `gatherIntakeRegistry`'s own `index.rebuild()` call reads it again
 * internally (`IndexService.rebuild()` always calls `journal.readAll()`
 * itself; it has no "here are events I already read" parameter). Cheaply
 * consolidating to one read would mean threading pre-read events through
 * `IndexService.rebuild()`'s signature, which is shared by every other
 * index-reading endpoint in this file -- a bigger, riskier change than this
 * issue's scope. Left as-is, noted rather than silently carried forward.
 */
const handleIntake = async (root: string): Promise<Response> => {
  const events = await readJournalEvents(root);
  const undisposed = listUndisposedCrates(events);

  const routedTail = events.filter((event) => event.type === "skill.routed").slice(-RECENTLY_ROUTED_LIMIT).reverse();

  // The tail's own Unverified badge (issue #93): only an identity-granting
  // disposition (never `salvage`) naming a bundle is even a candidate --
  // for those, the badge holds until that bundle's FIRST graded
  // measurement ever, so this needs a measurement count per distinct
  // bundle referenced. `receivedIdentity` is computed once per row here and
  // reused below (both to gather candidate slugs and to derive the row's
  // own `unverified`), rather than re-deriving it from the raw event twice.
  // Gathered in the SAME `runIndexEffect` call as the dock registry below --
  // one shared rebuild(), not a second one.
  const routedRows = routedTail.map((event) => ({
    event,
    bundle: event.payload.bundle ?? null,
    receivedIdentity:
      event.payload.bundle !== undefined && isIdentityGrantingDisposition(event.payload.disposition),
  }));
  const badgeCandidateSlugs = new Set<string>();
  for (const row of routedRows) {
    if (row.receivedIdentity && row.bundle !== null) badgeCandidateSlugs.add(row.bundle);
  }

  const { registry, measurementCountByBundle } = await runIndexEffect(
    root,
    Effect.gen(function* () {
      const registryResult = yield* gatherIntakeRegistry(events);
      const index = yield* IndexService;
      const counts = new Map<string, number>();
      for (const slug of badgeCandidateSlugs) {
        const measurements = yield* index.listMeasurements(slug);
        counts.set(slug, measurements.length);
      }
      return { registry: registryResult, measurementCountByBundle: counts };
    }),
  );

  const crates = await Promise.all(
    undisposed.map(async (event) => {
      const crateDir = join(root, "receiving", event.payload.intake);
      const computedHash = await Effect.runPromise(
        hashReceivedCrate(crateDir).pipe(Effect.provide(BunServices.layer)),
      );
      const verdict = deriveIntakeVerdict(computedHash, event.payload.claimedName, registry);
      return {
        intake: event.payload.intake,
        source: event.payload.source,
        ref: event.payload.ref ?? null,
        claimedName: event.payload.claimedName ?? null,
        claimedVersionHash: event.payload.claimedVersionHash ?? null,
        rights: event.payload.rights ?? null,
        // Structured stakes/hurts testimony (issue #108) -- surfaced
        // alongside `notes`, which stays as-written for old flattened
        // events (never re-parsed into structure).
        stakes: event.payload.stakes ?? null,
        hurts: event.payload.hurts ?? null,
        notes: event.payload.notes ?? null,
        at: event.at,
        actor: event.actor,
        verdict,
      };
    }),
  );

  // One pass over the SAME `events` array (no second journal read): each
  // intake's originating `skill.received` claims -- the name it arrived
  // under, plus its structured stakes/hurts testimony (issue #108). The
  // testimony matters most on `salvaged` rows below: "reported
  // load-bearing" is exactly what the Archive drawer's harvest decision
  // wants in view. `null` when the event didn't carry the field (pre-#108
  // crates keep their flattened `notes` prose, never re-parsed).
  const receivedByIntake = new Map<
    string,
    {
      readonly claimedName: string | null;
      readonly stakes: IntakeStakes | null;
      readonly hurts: string | null;
    }
  >();
  for (const event of events) {
    if (event.type === "skill.received") {
      receivedByIntake.set(event.payload.intake, {
        claimedName: event.payload.claimedName ?? null,
        stakes: event.payload.stakes ?? null,
        hurts: event.payload.hurts ?? null,
      });
    }
  }

  // The shared shape of one routed-crate row: what the routing fact says
  // (intake, target bundle, reason, when, who) joined back to the crate's
  // claimed name and stakes/hurts testimony. Both `recentlyRouted` and
  // `salvaged` below build on this.
  const routedRowBase = (event: SkillRoutedEvent) => {
    const received = receivedByIntake.get(event.payload.intake);
    return {
      intake: event.payload.intake,
      claimedName: received?.claimedName ?? null,
      stakes: received?.stakes ?? null,
      hurts: received?.hurts ?? null,
      bundle: event.payload.bundle ?? null,
      reason: event.payload.reason,
      at: event.at,
      actor: event.actor,
    };
  };

  const recentlyRouted = routedRows.map(({ event, bundle, receivedIdentity }) => {
    const measurementCount = bundle !== null ? measurementCountByBundle.get(bundle) ?? 0 : 0;
    return {
      ...routedRowBase(event),
      disposition: event.payload.disposition,
      // The Unverified badge on the tail (issue #93): holds while the
      // bundle it landed on has zero graded measurements ever, at any
      // version. `salvage` never qualifies (grants no identity, even when
      // it names an existing bundle it defended).
      unverified: isUnverified(receivedIdentity, measurementCount),
    };
  });

  // The Archive drawer's salvaged population (issue #109): EVERY
  // salvage-routed crate, newest first -- unlike `recentlyRouted` above
  // (a capped, all-dispositions tail), this is the drawer's full "out of
  // commission but kept" fold. Salvage grants no identity and moves no
  // files: the crate still sits at `receiving/<intake>/`, which is exactly
  // what the drawer's harvest affordance reaches for. Derived from the SAME
  // `events` array -- no second journal read, nothing stored.
  const salvaged = events
    .filter((event) => event.type === "skill.routed")
    .filter((event) => event.payload.disposition === "salvage")
    .map(routedRowBase)
    .reverse();

  return jsonResponse({ crates, recentlyRouted, salvaged });
};

/**
 * `GET /api/catalog` -- the Catalog page's skill-browser rows (Phase 17,
 * director ruling: the Catalog page survives as "what skills do we have,"
 * discovery at repo scale). One row per bundle: name/one-liner/tags/stage
 * (already on `BundleRecord`), latest recorded version + drift, and a
 * measurements summary (how many of the bundle's fixtures have at least one
 * measurement cell at the latest recorded version).
 *
 * ONE `rebuild()` for the whole request, then every per-bundle listing
 * reuses that SAME `IndexService` connection -- not one `IndexServiceLayer`
 * (and one `rebuild()`) per bundle per list. Catalog rows scale with the
 * number of bundles, so the old per-bundle helper calls (each its own
 * `runIndexEffect`) meant N bundles cost 1 + 3N full index rebuilds for one
 * `GET /api/catalog` -- 13 rebuilds for a 4-bundle workspace. Mirrors
 * `Skillbook.ts#buildSkillbook`, which already does this correctly.
 *
 * `openTodoCount` (issue #83, the Lab Bench mode's open-work signal per
 * row): counts non-terminal (not `done`/`wont-do`) todos per `bundle`,
 * never stored -- recomputed on every request, same as the rest of this
 * handler's rows. `rebuild()` above already folds the journal's `todo.*`
 * events into the index's `todos` table (the same `foldTodos` fold
 * `handleFieldReports` runs over its own separately-read `events`), so this
 * reads that table back via `listTodos()` instead of re-reading and
 * re-folding the journal a second time in this handler.
 *
 * `unverified` (issue #93, the Unverified badge): `bundle.everReceived`
 * (folded from `skill.routed` at THIS SAME `rebuild()`, `IndexService.ts`)
 * combined with `measurements.length === 0` (already fetched two lines
 * below for `measuredFixtureCount` -- the SAME unfiltered, any-version list,
 * never re-queried) via core's `isUnverified`. No extra journal parse, no
 * new endpoint.
 */
const handleCatalog = async (root: string): Promise<Response> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      // Whereabouts (issue #109): the two pieces of Track's derived status
      // set the index rows don't already carry -- last shipment + date and
      // recency of activity (Track's default sort key). Folded by rebuild()
      // itself off the ONE journal read it already does (no second parse in
      // this handler), carried on its result, never stored.
      const { lastShipments, lastActivityAt } = yield* index.rebuild();
      const bundles = yield* index.listBundles();

      // Default listTodos() (swept excluded) is exact here: a todo can
      // only be swept once terminal (FoldTodos.ts's isSwept), and the
      // loop below skips terminal todos anyway.
      const allTodos = yield* index.listTodos();
      const openTodoCountByBundle = new Map<string, number>();
      for (const todo of allTodos) {
        if (todo.bundle === undefined || isTerminalStatus(todo.status)) {
          continue;
        }
        openTodoCountByBundle.set(todo.bundle, (openTodoCountByBundle.get(todo.bundle) ?? 0) + 1);
      }

      const entries = [];
      for (const bundle of bundles) {
        const versions = yield* index.listVersions(bundle.slug);
        const fixtures = yield* index.listFixtures(bundle.slug);
        const measurements = yield* index.listMeasurements(bundle.slug);
        const latestVersion = versions[0];
        const measuredFixtureCases =
          latestVersion === undefined
            ? new Set<string>()
            : new Set(
                measurements
                  .filter((measurement) => measurement.versionHash === latestVersion.hash)
                  .map((measurement) => measurement.fixtureCase),
              );
        entries.push({
          slug: bundle.slug,
          name: bundle.name,
          oneLiner: bundle.oneLiner,
          tags: bundle.tags,
          stage: bundle.stage,
          archived: bundle.archived,
          drift: bundle.drift,
          latestVersion:
            latestVersion === undefined
              ? null
              : {
                  hash: latestVersion.hash,
                  label: latestVersion.label ?? null,
                  recordedAt: latestVersion.recordedAt,
                },
          fixtureCount: fixtures.length,
          measuredFixtureCount: measuredFixtureCases.size,
          openTodoCount: openTodoCountByBundle.get(bundle.slug) ?? 0,
          // The Unverified badge (issue #93): received + zero graded
          // measurements EVER, at any version -- `measurements` above is
          // already the bundle's FULL, unfiltered measurement list (no
          // version scoping), and `bundle.everReceived` is already on the
          // record from this SAME rebuild() -- no extra journal parse.
          unverified: isUnverified(bundle.everReceived, measurements.length),
          // Whereabouts (issue #109): never one location -- a status set.
          lastShipment: lastShipments.get(bundle.slug) ?? null,
          // Recency floor: a bundle with no attributable journal events yet
          // still sorts honestly by its own creation timestamp.
          lastActivityAt: lastActivityAt.get(bundle.slug) ?? bundle.created,
        });
      }
      return jsonResponse({ entries });
    }),
  );

/**
 * Display-shortens an absolute path with `~` when it sits under the given
 * home directory. Pure (home is a parameter) so it is unit-testable; the
 * route passes `homedir()`.
 */
export const shortenHomePath = (path: string, home: string): string => {
  if (home.length === 0) return path;
  if (path === home) return "~";
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
};

/**
 * `GET /api/projects` -- the next shell's sidebar Projects tree (IA doc
 * 2026-07-22 §A). The real machine-level project registry (`~/.skillmaker`)
 * arrives in a later phase; TODAY the server knows exactly one project --
 * the workspace it is running for -- so this returns a one-element array.
 * The ARRAY shape is the contract: when the registry lands, this endpoint
 * grows more elements and the client changes not at all. Skills are the
 * workspace's non-archived bundles off ONE `rebuild()` (`listBundleRecords`),
 * in the server's own stage vocabulary (`idea`...`published`) -- display
 * labels are the viewer's business.
 */
const handleProjects = async (root: string, config: WorkspaceConfig): Promise<Response> => {
  const bundles = await listBundleRecords(root);
  const skills = bundles
    .filter((bundle) => !bundle.archived)
    .map((bundle) => ({ slug: bundle.slug, stage: bundle.stage, oneLiner: bundle.oneLiner }));
  return jsonResponse({
    projects: [
      {
        name: config.name.length > 0 ? config.name : basename(root),
        path: shortenHomePath(root, homedir()),
        skills,
      },
    ],
  });
};

type AppendVersionOutcome =
  | { readonly kind: "ok"; readonly status: "appended" | "already_appended" }
  | { readonly kind: "conflict"; readonly message: string };

/**
 * Appends `skill.version_recorded` with the same idempotency semantics as
 * the CLI's `skillmaker version record` (Version.ts): same content twice is
 * a no-op, same hash with a different label is a conflict.
 */
const appendVersion = (
  root: string,
  slug: string,
  actor: Actor,
  outputHash: string,
  designHash: string,
  label: string | undefined,
): Promise<AppendVersionOutcome> =>
  runJournalEffect(
    root,
    Effect.gen(function* () {
      const journal = yield* Journal;
      const result = yield* journal.append({
        type: "skill.version_recorded",
        actor,
        // See Version.ts's CLI equivalent: keyed on BOTH hashes so a
        // design-only change doesn't collide with the prior version's key.
        idempotencyKey: `skill.version_recorded:${slug}:${designHash}:${outputHash}`,
        payload: { bundle: slug, hash: outputHash, designHash, ...(label !== undefined ? { label } : {}) },
      });
      return { kind: "ok" as const, status: result.status };
    }).pipe(
      Effect.catchTag("JournalIdempotencyConflictError", (error) =>
        Effect.succeed<AppendVersionOutcome>({ kind: "conflict", message: error.message }),
      ),
    ),
  );

interface PostEventRequestBody {
  readonly type?: unknown;
  readonly payload?: unknown;
  readonly idempotencyKey?: unknown;
}

/**
 * `POST /api/events` -- the server-mediated write path (data-model.md
 * §2.9/§2.13): schema-validates against the allowlisted subset of the event
 * catalog, runs the same `Machine.checkTransition` guard the CLI's
 * `advance` command runs, then appends. Rejections are 409s carrying a
 * human-readable reason, not silent failures.
 */
/**
 * Scans every bundle's `runs/<runId>/run.json` to locate which bundle a run
 * id belongs to -- `run.graded` payloads carry only `{id, ...}`, no bundle,
 * so the server (unlike the client, which already knows its slug) has to
 * search for it. Bundle counts are small at this scale (studio.db's own
 * doc comments make the same tradeoff for `rebuild()`). Walks the
 * rebuild's own discovered bundle directories (`fetchBundleLocations`,
 * seam pass over #108/#109) rather than `readdir(<skillsDir>)` -- an
 * in-place-adopted bundle's runs live wherever the bundle does, and a
 * `readdir` of the conventional root would refuse to grade them. Still
 * tolerant: any lookup failure reads as "no such run" (the caller's 409),
 * never a 500.
 */
const findRunLocation = async (
  root: string,
  runId: string,
): Promise<{ readonly bundle: string; readonly runDir: string; readonly status: string } | undefined> => {
  let locations: ReadonlyMap<string, BundleLocation>;
  try {
    locations = await fetchBundleLocations(root);
  } catch {
    return undefined;
  }
  for (const [slug, location] of locations) {
    const runDir = join(location.dir, "runs", runId);
    const runJsonPath = join(runDir, "run.json");
    if (!existsSync(runJsonPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(runJsonPath, "utf8")) as { readonly status?: unknown };
      const status = typeof raw.status === "string" ? raw.status : "unknown";
      return { bundle: slug, runDir, status };
    } catch {
      return { bundle: slug, runDir, status: "unknown" };
    }
  }
  return undefined;
};

const handlePostEvent = async (root: string, request: Request): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "request body must be a JSON object" }, 400);
  }

  const { type, payload, idempotencyKey } = body as PostEventRequestBody;
  if (typeof type !== "string" || !ALLOWED_API_EVENT_TYPES.has(type)) {
    return jsonResponse(
      { error: `event type "${String(type)}" is not accepted by POST /api/events` },
      400,
    );
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return jsonResponse({ error: "idempotencyKey must be a string" }, 400);
  }

  const actor = await Effect.runPromise(resolveUserActor());

  // Dry-decode against the full event schema (with synthesized envelope
  // fields) to validate the payload shape and recover a typed payload for
  // guard-checking, before the journal's own append-time decode.
  const decodeOutcome = await Effect.runPromise(
    Effect.result(
      Schema.decodeUnknownEffect(JournalEvent)({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor,
        ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
        type,
        payload,
      }),
    ),
  );
  if (decodeOutcome._tag === "Failure") {
    return jsonResponse(
      { error: `invalid payload for "${type}": ${String(decodeOutcome.failure)}` },
      400,
    );
  }
  // Envelope fields (id/at/schemaVersion) are discarded -- journal.append
  // regenerates them; this dry-decode only proved the payload valid.
  const { id: _id, at: _at, schemaVersion: _schemaVersion, ...eventInput } = decodeOutcome.success;

  if (eventInput.type === "bundle.stage_changed") {
    const events = await readJournalEvents(root);
    const verdict = checkTransition(events, eventInput.payload);
    if (!verdict.allowed) {
      return jsonResponse({ error: verdict.reason }, 409);
    }
  }

  if (eventInput.type === "todo.opened") {
    // D5 (2026-07-21 simplification): a run-origin todo must point at a run
    // that actually exists -- the origin is the todo's evidence link, and a
    // dangling one would be a provenance lie. No status requirement: unlike
    // grading, opening work from a run is verdict-orthogonal.
    const origin = eventInput.payload.todo.origin;
    if (origin?.kind === "run") {
      const location = await findRunLocation(root, origin.runId);
      if (location === undefined) {
        return jsonResponse({ error: `no such run "${origin.runId}"` }, 409);
      }
    }
  }

  if (eventInput.type === "todo.updated") {
    const events = await readJournalEvents(root);
    const current = foldTodos(events).get(eventInput.payload.id);
    if (current === undefined) {
      return jsonResponse({ error: `no such todo "${eventInput.payload.id}"` }, 409);
    }
  }

  if (eventInput.type === "todo.status_changed") {
    const events = await readJournalEvents(root);
    const current = foldTodos(events).get(eventInput.payload.id);
    if (current === undefined) {
      return jsonResponse({ error: `no such todo "${eventInput.payload.id}"` }, 409);
    }
    if (current.status !== eventInput.payload.from) {
      return jsonResponse(
        {
          error: `stale "from": todo "${eventInput.payload.id}" is currently "${current.status}", not "${eventInput.payload.from}"`,
        },
        409,
      );
    }
  }

  if (eventInput.type === "run.graded") {
    const location = await findRunLocation(root, eventInput.payload.id);
    if (location === undefined) {
      return jsonResponse({ error: `no such run "${eventInput.payload.id}"` }, 409);
    }
    if (location.status !== "completed") {
      return jsonResponse(
        {
          error: `run "${eventInput.payload.id}" cannot be graded: status is "${location.status}", not "completed" (infra-error/running runs are never graded -- they carry no task-level verdict)`,
        },
        409,
      );
    }
  }

  if (eventInput.type === "review.resolved") {
    const events = await readJournalEvents(root);
    const state = foldBundleStates(events).get(eventInput.payload.bundle);
    if (
      state === undefined ||
      state.substate !== "awaiting-review" ||
      state.stage !== eventInput.payload.state
    ) {
      return jsonResponse(
        {
          error: `bundle "${eventInput.payload.bundle}" is not awaiting review at state "${eventInput.payload.state}"`,
        },
        409,
      );
    }
  }

  try {
    const result = await runJournalEffect(
      root,
      Effect.gen(function* () {
        const journal = yield* Journal;
        return yield* journal.append(eventInput);
      }),
    );
    return jsonResponse({ status: result.status, event: result.event });
  } catch (cause) {
    return jsonResponse({ error: `could not append event: ${String(cause)}` }, 500);
  }
};

/**
 * The current stage's agent station, if the bundle has `stations.json` and
 * that stage has a `doer: "agent"` station configured -- what the viewer's
 * "Run station" button (OverviewTab) gates on. Deliberately lenient (returns
 * `null` on any missing/malformed input rather than failing the whole bundle
 * detail response): this is availability info for a button, not a
 * precondition check -- `StationEngine.runStation` re-validates for real
 * when the button is actually pressed. Takes the bundle's ACTUAL directory
 * (seam pass over #108/#109): `stations.json` is per-bundle-dir, and an
 * in-place-adopted bundle does not live at `<skillsDir>/<slug>`.
 */
const readCurrentStageStation = (
  bundleDir: string,
  stage: string,
): { readonly state: string; readonly skill: string } | null => {
  try {
    const stationsJsonPath = join(bundleDir, "stations.json");
    if (!existsSync(stationsJsonPath)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(stationsJsonPath, "utf8")) as {
      readonly stations?: Record<string, { readonly doer?: unknown; readonly skill?: unknown }>;
    };
    const station = parsed.stations?.[stage];
    if (station === undefined || station.doer !== "agent" || typeof station.skill !== "string") {
      return null;
    }
    return { state: stage, skill: station.skill };
  } catch {
    return null;
  }
};

/**
 * `GET /api/bundles/:slug` -- the detail/review panel data (data-model.md
 * §2.13, §2.7). `bundle` already carries the live `designHash`/`outputHash`/
 * `drift` (computed at `rebuild()`, data-model.md §2.7); `versions` is the
 * full recorded history, newest first. `station` is the current stage's
 * agent station (if any) -- the viewer's "Run station" button gate.
 */
/** `IndexService`-backed slice of `handleBundleDetail` -- one rebuild, every list against the same connection. */
type BundleIndexDetail =
  | { readonly kind: "not_found" }
  | {
      readonly kind: "found";
      readonly bundle: BundleRecord;
      readonly versions: ReadonlyArray<VersionRecord>;
      readonly fixtures: ReadonlyArray<FixtureRecord>;
      readonly riskCoverage: ReadonlyArray<RiskCoverageRecord>;
      readonly warnings: ReadonlyArray<WarningRecord>;
      readonly runs: ReadonlyArray<RunIndexRecord>;
      readonly measurements: ReadonlyArray<MeasurementRecord>;
      /** Fork family (issue #109), off the rebuild's own marker decode -- no per-request directory walk, no second marker parse. */
      readonly forkOf: string | null;
      readonly forks: ReadonlyArray<string>;
      /** Where the bundle actually lives + its layout (seam pass over #108/#109), off the SAME rebuild's identity scan: an in-place bundle (brownfield adopt, `route`'s `new`/`fork` doors) does not live at `<skillsDir>/<slug>` and has no `output/` subtree. `null` for a journal-only bundle (no `bundle.json` found); callers fall back to the skillsDir convention. */
      readonly location: BundleLocation | null;
    };

const loadBundleIndexDetail = (root: string, slug: string): Promise<BundleIndexDetail> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      const rebuildResult = yield* index.rebuild();
      const bundle = yield* index.getBundle(slug);
      if (bundle === undefined) {
        return { kind: "not_found" as const };
      }
      const versions = yield* index.listVersions(slug);
      const fixtures = yield* index.listFixtures(slug);
      const riskCoverage = yield* index.listRiskCoverage(slug);
      const warnings = yield* index.listWarnings(slug);
      const runs = yield* index.listRuns(slug);
      const measurements = yield* index.listMeasurements(slug);
      return {
        kind: "found" as const,
        bundle,
        versions,
        fixtures,
        riskCoverage,
        warnings,
        runs: [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        measurements,
        forkOf: rebuildResult.forkOf.get(slug) ?? null,
        forks: rebuildResult.forkChildren.get(slug) ?? [],
        location: rebuildResult.locations.get(slug) ?? null,
      };
    }),
  );

/**
 * Reads `dossier.md`'s CONTENT directly (issue #94), the same "don't pay for
 * a full `rebuild()` for a single-bundle read" split `handleFieldReports`'
 * own direct `scanFixtures` call already uses -- `loadBundleIndexDetail`'s
 * `rebuild()` above already ran the dossier scanner too, but only for its
 * WARNINGS (joined into `warnings` alongside fixtures/risk-map, same as
 * `IndexService.rebuild`); the sections+gaps the detail page actually
 * renders are a second, cheap, targeted read, never persisted. Takes the
 * bundle's ACTUAL directory (seam pass over #108/#109): an in-place bundle's
 * `dossier.md` -- including the one the triage manifest's card answers
 * seeded (issue #108) -- lives wherever the bundle was discovered, not at
 * `<skillsDir>/<slug>`.
 */
const loadDossierSections = (bundleDir: string): Promise<DossierSections> =>
  Effect.runPromise(
    parseDossier(join(bundleDir, "dossier.md")).pipe(
      Effect.provide(BunServices.layer),
      Effect.map((result) => result.sections),
    ),
  );

const handleBundleDetail = async (root: string, config: WorkspaceConfig, slug: string): Promise<Response> => {
  const detail = await loadBundleIndexDetail(root, slug);
  if (detail.kind === "not_found") {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }
  const { bundle, versions, fixtures, riskCoverage, warnings, runs, measurements } = detail;

  const events = await readJournalEvents(root);
  const bundleEvents = events.filter((event) => bundleForEvent(event) === slug);
  // Newest first, capped at MAX_BUNDLE_DETAIL_EVENTS -- a recent-activity
  // list, not a full history (that's `skillmaker status --json`).
  const recentEvents = bundleEvents.slice(-MAX_BUNDLE_DETAIL_EVENTS).reverse();

  // The bundle's ACTUAL directory and layout (seam pass over #108/#109),
  // off the rebuild's own identity scan (`loadBundleIndexDetail`): an
  // in-place bundle -- brownfield adopt via triage, `route`'s `new`/`fork`
  // doors -- lives wherever it was discovered, and hardcoding
  // `<skillsDir>/<slug>` + the `design.md`/`output/` layout here silently
  // returned an empty dossier, a null station, and zero files for exactly
  // the imports the #108→#109 seam (seeded Job/Basis on the card) targets.
  const bundleDir = detail.location?.dir ?? join(root, config.skillsDir, slug);
  const layout: BundleLayout = detail.location?.layout ?? "output-dir";

  const station = readCurrentStageStation(bundleDir, bundle.stage);
  const dossier = await loadDossierSections(bundleDir);

  // Lineage (issue #109): chain of custody replayed from the journal (the
  // SAME full `events` read above -- uncapped, unlike `recentEvents`) plus
  // the fork family off the rebuild's own `AdoptMarker` decode
  // (`loadBundleIndexDetail`) and provenance off the bundle record's own
  // indexed `upstream` -- no marker is re-read here. All derived,
  // recomputed per request; the card is a projection, never a store.
  const lineage = {
    custody: custodyEventsFor(events, slug),
    forkOf: detail.forkOf,
    forks: detail.forks,
    upstream:
      bundle.upstream !== undefined
        ? { source: bundle.upstream.source, ref: bundle.upstream.ref ?? null }
        : null,
  };

  // The skill's own instructions file (card-fidelity simplify pass): the
  // SERVER owns the layout question -- the viewer's Instructions tab must
  // not re-derive `BundleLayout` by probing the files list. Off the SAME
  // resolved `layout` as `files` below: an output-dir bundle ships
  // `output/SKILL.md`; an in-place bundle IS the skill directory, so
  // `SKILL.md` sits at its root. `null` when the file doesn't exist yet --
  // an honest gap the card renders as such.
  const instructionsRelPath = layout === "output-dir" ? "output/SKILL.md" : "SKILL.md";
  const instructionsPath = existsSync(join(bundleDir, instructionsRelPath)) ? instructionsRelPath : null;

  return jsonResponse({
    bundle,
    guardStatus: guardStatus(events, slug),
    events: recentEvents,
    versions,
    fixtures,
    riskCoverage,
    warnings,
    runs,
    measurements,
    // The Unverified badge (issue #93): same derivation, same inputs as
    // `handleCatalog` -- `bundle.everReceived` (from THIS SAME rebuild) and
    // `measurements.length` (already fetched above, unfiltered/any-version).
    unverified: isUnverified(bundle.everReceived, measurements.length),
    station,
    dossier,
    lineage,
    files: listReviewableBundleFiles(bundleDir, layout),
    instructionsPath,
  });
};

interface RecordVersionRequestBody {
  readonly label?: unknown;
}

/**
 * `POST /api/bundles/:slug/record-version` -- the viewer's "Record version"
 * button. Hashing is I/O, not client business, so this endpoint computes
 * hashes server-side via the SAME `computeBundleHashes` the CLI's
 * `skillmaker version record` calls (Version.ts) rather than accepting
 * hashes from the client or widening the generic `POST /api/events`
 * allowlist -- a dedicated endpoint keeps that computation in one place.
 */
const handleRecordVersion = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  request: Request,
): Promise<Response> => {
  const bundle = await getBundleRecord(root, slug);
  if (bundle === undefined) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }

  let body: unknown = {};
  const rawText = await request.text();
  if (rawText.length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
  }
  const rawLabel =
    typeof body === "object" && body !== null && "label" in body
      ? (body as RecordVersionRequestBody).label
      : undefined;
  if (rawLabel !== undefined && typeof rawLabel !== "string") {
    return jsonResponse({ error: "label must be a string" }, 400);
  }
  const label = rawLabel;

  try {
    // The bundle's ACTUAL directory (seam pass over #108/#109): an
    // in-place-adopted bundle's card exposes this very button, and hashing
    // the conventional `<skillsDir>/<slug>` path would record hashes of a
    // nonexistent tree. `detectBundleLayout` on the real directory then
    // hands `computeBundleHashes` the right layout, exactly as the CLI's
    // `version record` does.
    const bundleDir = await resolveBundleDir(root, config, slug);
    const { designHash, outputHash } = await Effect.runPromise(
      detectBundleLayout(bundleDir).pipe(
        Effect.flatMap((layout) => computeBundleHashes(bundleDir, layout)),
        Effect.provide(BunServices.layer),
      ),
    );

    const actor = await Effect.runPromise(resolveUserActor());
    const outcome = await appendVersion(root, slug, actor, outputHash, designHash, label);

    if (outcome.kind === "conflict") {
      return jsonResponse(
        {
          error: `a version was already recorded for this exact content under a different label -- content is unchanged, so no new version was recorded. ${outcome.message}`,
        },
        409,
      );
    }

    return jsonResponse({ status: outcome.status, hash: outputHash, designHash, label: label ?? null });
  } catch (cause) {
    return jsonResponse({ error: `could not record version: ${String(cause)}` }, 500);
  }
};

interface CreateBundleRequestBody {
  readonly slug?: unknown;
  readonly name?: unknown;
}

/**
 * `POST /api/bundles` -- the board's "+ New bundle" affordance (the idea
 * column's create form). Scaffolds a Skill Bundle via the SAME
 * `Workspace.createBundle` the CLI's `skillmaker new` calls, then journals
 * `bundle.created` with the same idempotency key -- rather than widening the
 * generic `POST /api/events` allowlist, which stays closed to `bundle.created`
 * (a bundle is born from scaffolding + an event, not an event alone). Slug
 * validation and "already exists" match the CLI path exactly.
 */
const handleCreateBundle = async (root: string, request: Request): Promise<Response> => {
  let body: CreateBundleRequestBody = {};
  const rawText = await request.text();
  if (rawText.length > 0) {
    try {
      body = JSON.parse(rawText) as CreateBundleRequestBody;
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
  }
  if (typeof body.slug !== "string" || body.slug.length === 0) {
    return jsonResponse({ error: "slug is required" }, 400);
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    return jsonResponse({ error: "name must be a string" }, 400);
  }
  const slug = body.slug;
  const name = body.name;

  try {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        return yield* workspace.createBundle(root, name !== undefined ? { slug, name } : { slug });
      }).pipe(
        Effect.catchTag("InvalidSlugError", () => Effect.succeed({ status: "invalid_slug" as const })),
        Effect.provide(Layer.provide(WorkspaceLayer, BunServices.layer)),
      ),
    );

    if (created.status === "invalid_slug") {
      return jsonResponse(
        { status: "invalid_slug", slug, error: `"${slug}" is not a valid slug (expected lowercase words joined by hyphens)` },
        400,
      );
    }

    if (created.status === "already_exists") {
      return jsonResponse({ status: "already_exists", slug });
    }

    // Fresh scaffold -- journal its creation, exactly as New.ts does.
    const actor = await Effect.runPromise(resolveUserActor());
    await runJournalEffect(
      root,
      Effect.gen(function* () {
        const journal = yield* Journal;
        yield* journal.append({
          type: "bundle.created",
          actor,
          idempotencyKey: `bundle.created:${slug}`,
          payload: { bundle: slug },
        });
      }),
    );
    return jsonResponse({ status: "created", slug }, 201);
  } catch (cause) {
    return jsonResponse({ error: `could not create bundle: ${String(cause)}` }, 500);
  }
};

/** `runs/<runId>/artifacts/<nonempty>` -- Phase 9's run-detail artifact viewer. */
const RUN_ARTIFACT_PATH = /^runs\/[^/]+\/artifacts\/.+$/;

/** `runs/<runId>/response.md` -- the run's extracted final agent message (finding #5), surfaced in the same run-detail artifact viewer. */
const RUN_RESPONSE_PATH = /^runs\/[^/]+\/response\.md$/;

/**
 * The bundle's reviewable subdirectories, in pipeline order -- the single
 * source of truth shared by the file-read allowlist below and
 * `listReviewableBundleFiles`'s enumeration, so the two stay in sync by
 * construction rather than by hand.
 */
const REVIEWABLE_SUBDIRS = ["research", "output", "evals"] as const;

/**
 * An in-place bundle's reviewable top-level files (seam pass over #108/
 * #109), in review order: the skill payload itself first, then the authored
 * siblings. Shared by `listReviewableBundleFiles`'s enumeration and the
 * file-read allowlist below -- the same in-sync-by-construction treatment
 * `REVIEWABLE_SUBDIRS` already has.
 */
const IN_PLACE_REVIEWABLE_FILES = ["SKILL.md", "design.md", "dossier.md"] as const;

/**
 * Only `design.md`, an in-place bundle's top-level `SKILL.md`/`dossier.md`,
 * a non-empty path under `research/` or `output/`, a run's `artifacts/`
 * contents, or a run's `response.md` may be read back over HTTP
 * (data-model.md §2.12 -- artifacts listed/viewable on the run-detail
 * panel). `research/` is included so the researching-station review gate can
 * actually show the reviewer the `research/notes.md` it asks them to approve.
 */
const isAllowedBundleFilePath = (relativePath: string): boolean => {
  // No relative segments, period: `runs/<id>/artifacts/../../<id>/run.json`
  // would match the artifact pattern AND resolve inside the bundle dir
  // (passing the containment check), yet escape the allowlisted subtree.
  if (relativePath.split("/").includes("..")) {
    return false;
  }
  if ((IN_PLACE_REVIEWABLE_FILES as ReadonlyArray<string>).includes(relativePath)) {
    return true;
  }
  if (REVIEWABLE_SUBDIRS.some((sub) => relativePath.startsWith(`${sub}/`) && relativePath.length > sub.length + 1)) {
    return true;
  }
  return RUN_ARTIFACT_PATH.test(relativePath) || RUN_RESPONSE_PATH.test(relativePath);
};

/**
 * `GET /api/bundles/:slug/file?path=design.md|research/...|output/...` -- the
 * viewer's read-only Files tab. A strict allowlist (design.md, an in-place
 * bundle's top-level SKILL.md/dossier.md, or under research/ or output/) plus
 * a resolved-path containment check guards against traversal (`../..`,
 * absolute paths, symlink escapes); anything outside the allowlist or off
 * the bundle directory 404s rather than erroring, so it never leaks whether
 * a path exists elsewhere on disk. Serves from the bundle's ACTUAL directory
 * (`resolveBundleDir`, seam pass over #108/#109) so the files
 * `listReviewableBundleFiles` lists for an in-place bundle stay servable --
 * the two must cover the same subtree or the Files tab lists dead links.
 */
/**
 * `GET /api/bundles/:slug/files` -- the Files tab's tree: every bundle file
 * the file endpoint can actually serve (same allowlist, so the tree never
 * contains a dead link). `runs/` is deliberately excluded from the tree --
 * run artifacts stay reachable through run detail; listing every run file
 * here would flood the panel.
 */
const handleBundleFiles = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
): Promise<Response> => {
  const bundleDir = resolvePath(await resolveBundleDir(root, config, slug));
  if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
    return new Response("Not Found", { status: 404 });
  }

  const files: Array<{ path: string; size: number }> = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel.length === 0 ? name : `${rel}/${name}`;
      const st = statSync(abs);
      if (st.isDirectory()) {
        // Never descend into runs/ (excluded from the tree) or dotdirs.
        if (rel.length === 0 && (name === "runs" || name.startsWith("."))) continue;
        walk(abs, relPath);
      } else if (st.isFile() && isAllowedBundleFilePath(relPath)) {
        files.push({ path: relPath, size: st.size });
      }
    }
  };
  walk(bundleDir, "");
  return jsonResponse({ slug, files });
};

const handleBundleFile = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  relPath: string | null,
): Promise<Response> => {
  if (relPath === null || relPath.length === 0 || !isAllowedBundleFilePath(relPath)) {
    return new Response("Not Found", { status: 404 });
  }

  const bundleDir = resolvePath(await resolveBundleDir(root, config, slug));
  const filePath = resolvePath(join(bundleDir, relPath));
  if (filePath !== bundleDir && !filePath.startsWith(bundleDir + sep)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  const content = readFileSync(filePath, "utf8");
  return jsonResponse({ path: relPath, content });
};

/**
 * `GET /api/bundles/:slug/fixtures/:case` -- one fixture's readable test
 * body (card-fidelity round 2: "I can't see what the tests are"). Returns
 * the PARSED case, not a raw file dump, so the viewer renders a test a
 * human can read: the task prompt (`prompt.md` content when present, the
 * legacy `case.json` `prompt` field otherwise), what passing means
 * (`grading.answerKey` + `grading.checks`, the authored words), class,
 * risks, and context. Derived per request from the bundle's ACTUAL
 * directory (`resolveBundleDir` -- an in-place bundle's `evals/` lives
 * under its own dir), never stored. Tolerant like `Fixtures.scanFixtures`:
 * malformed `case.json` fields become honest nulls + a warning line, never
 * a hard failure -- the card shows what's wrong instead of going blank.
 */
const handleFixtureDetail = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  caseName: string,
): Promise<Response> => {
  // The case name is a single directory name -- no separators, no dot
  // segments -- so it can never address outside `evals/fixtures/`.
  if (caseName.length === 0 || /[/\\]/.test(caseName) || caseName.startsWith(".")) {
    return jsonResponse({ error: `no such fixture "${caseName}"` }, 404);
  }

  const bundleDir = resolvePath(await resolveBundleDir(root, config, slug));
  const caseDir = join(bundleDir, "evals", "fixtures", caseName);
  const caseJsonPath = join(caseDir, "case.json");
  if (!existsSync(caseJsonPath) || !statSync(caseJsonPath).isFile()) {
    return jsonResponse({ error: `no such fixture "${caseName}"` }, 404);
  }

  const warnings: string[] = [];
  let parsed: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(caseJsonPath, "utf8"));
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      parsed = raw as Record<string, unknown>;
    } else {
      warnings.push("case.json is not a JSON object");
    }
  } catch {
    warnings.push("case.json is not valid JSON");
  }

  const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const stringArray = (value: unknown): ReadonlyArray<string> =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

  const rawGrading = parsed["grading"];
  const grading =
    typeof rawGrading === "object" && rawGrading !== null && !Array.isArray(rawGrading)
      ? {
          answerKey: stringOrNull((rawGrading as Record<string, unknown>)["answerKey"]),
          checks: stringArray((rawGrading as Record<string, unknown>)["checks"]),
        }
      : null;

  const promptMdPath = join(caseDir, "prompt.md");
  const promptMd =
    existsSync(promptMdPath) && statSync(promptMdPath).isFile() ? readFileSync(promptMdPath, "utf8") : null;

  return jsonResponse({
    caseName,
    class: stringOrNull(parsed["class"]),
    risks: stringArray(parsed["risks"]),
    context: stringOrNull(parsed["context"]),
    promptMd,
    // The scaffold-era `prompt` string field (Fixtures.ts: tolerated, never
    // required) -- shown only when no prompt.md exists.
    legacyPrompt: stringOrNull(parsed["prompt"]),
    grading,
    warnings,
  });
};

/** Recursively lists every file under `dir`, as paths relative to `dir` (posix-joined, for stable wire output). */
const listFilesRecursive = (dir: string, relPrefix = ""): ReadonlyArray<string> => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relPrefix.length > 0 ? `${relPrefix}/${entry}` : entry;
    const info = statSync(abs);
    if (info.isDirectory()) {
      out.push(...listFilesRecursive(abs, rel));
    } else if (info.isFile()) {
      out.push(rel);
    }
  }
  return out;
};

/**
 * The bundle's reviewable source files for the viewer's Files tab -- exactly
 * the file-endpoint-servable subtree a reviewer should read. Layout-aware
 * (seam pass over #108/#109): an `"output-dir"` bundle offers `design.md`,
 * then everything under `research/` and `output/` (ordered design → research
 * → output so the dropdown reads like the production pipeline); an
 * `"in-place"` bundle has no `output/` subtree -- its skill payload IS the
 * bundle directory (`Versions.ts`'s `BundleLayout`), so its reviewable set
 * is the top-level `SKILL.md` plus the `design.md`/`dossier.md` siblings
 * when present (Adopt scaffolds `dossier.md`; `design.md` only exists if it
 * traveled with the directory). Scaffolding dotfiles (`.gitkeep`) are
 * dropped; run transcripts/artifacts are deliberately excluded (those belong
 * to the run-detail panel).
 */
const listReviewableBundleFiles = (dir: string, layout: BundleLayout): ReadonlyArray<string> => {
  const bundleDir = resolvePath(dir);
  const out: string[] = [];
  if (layout === "in-place") {
    for (const name of IN_PLACE_REVIEWABLE_FILES) {
      if (existsSync(join(bundleDir, name))) {
        out.push(name);
      }
    }
    return out;
  }
  const noDotSegment = (rel: string): boolean => !rel.split("/").some((segment) => segment.startsWith("."));
  if (existsSync(join(bundleDir, "design.md"))) {
    out.push("design.md");
  }
  for (const sub of REVIEWABLE_SUBDIRS) {
    out.push(...listFilesRecursive(join(bundleDir, sub), sub).filter(noDotSegment));
  }
  return out;
};

/**
 * `GET /api/bundles/:slug/runs/:runId` -- the read-out's run detail panel
 * (data-model.md §2.12): `run.json` fields, the parsed transcript, the
 * artifact file list, the full grading history (newest first -- regrades
 * are history, not overwrites), and the fixture's `case.json` grading
 * checklist for the grading panel's checkboxes.
 */
const handleRunDetail = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  runId: string,
): Promise<Response> => {
  // The bundle's ACTUAL directory (seam pass over #108/#109): an in-place
  // bundle's runs live under its own discovered directory, not under
  // `<skillsDir>/<slug>`.
  const bundleDir = await resolveBundleDir(root, config, slug);
  const runDir = join(bundleDir, "runs", runId);
  const runJsonPath = join(runDir, "run.json");
  if (!existsSync(runJsonPath)) {
    return jsonResponse({ error: `no such run "${runId}" in bundle "${slug}"` }, 404);
  }

  let run: unknown;
  try {
    run = JSON.parse(readFileSync(runJsonPath, "utf8"));
  } catch (cause) {
    return jsonResponse({ error: `run.json for "${runId}" is malformed: ${String(cause)}` }, 500);
  }

  // Transcript: parsed defensively, line by line -- a truncated/corrupt
  // trailing line (e.g. a crash mid-write) never sinks the whole panel.
  const transcriptPath = join(runDir, "transcript.jsonl");
  const transcript: unknown[] = [];
  if (existsSync(transcriptPath)) {
    const lines = readFileSync(transcriptPath, "utf8").split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        transcript.push(JSON.parse(line));
      } catch {
        transcript.push({ malformed: true, raw: line });
      }
    }
  }

  const artifactsDir = join(runDir, "artifacts");
  // `response.md` (finding #5) lives directly under `runs/<id>/`, a sibling
  // of `artifacts/`, not inside it -- but the run-detail panel's artifact
  // list is where grading actually happens, so it's surfaced there too,
  // first, ahead of the run's captured workspace-diff artifacts.
  const responsePath = join(runDir, "response.md");
  const artifacts = existsSync(responsePath)
    ? ["response.md", ...listFilesRecursive(artifactsDir)]
    : listFilesRecursive(artifactsDir);

  const events = await readJournalEvents(root);
  const gradingHistory = events
    .filter((event) => event.type === "run.graded" && event.payload.id === runId)
    .slice()
    .reverse();

  // The fixture's grading.checks (case.json), for the checklist UI -- read
  // directly and defensively (ruling I: malformed content is tolerated, not
  // a hard failure) rather than via `scanFixtures`, whose tolerant
  // `FixtureCaseRecord` summary deliberately drops `grading` (it is not part
  // of `IndexService`'s fixtures table). Also reads `class` here (same
  // defensive read) so `trigger`-class runs can surface `activated`
  // (Phase 12, Fixtures.ts's `trigger` class -- `didSkillActivate` scans the
  // transcript above for evidence the skill fired, since a trigger fixture's
  // prompt deliberately never names the skill).
  let checks: ReadonlyArray<string> = [];
  let activated: boolean | null = null;
  const runRecord = run as { readonly fixtureCase?: unknown; readonly skillInvoked?: unknown };
  if (typeof runRecord.fixtureCase === "string") {
    const caseJsonPath = join(bundleDir, "evals", "fixtures", runRecord.fixtureCase, "case.json");
    if (existsSync(caseJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(caseJsonPath, "utf8")) as {
          readonly class?: unknown;
          readonly grading?: { readonly checks?: unknown };
        };
        const rawChecks = parsed.grading?.checks;
        if (Array.isArray(rawChecks)) {
          checks = rawChecks.filter((c): c is string => typeof c === "string");
        }
        if (parsed.class === "trigger") {
          activated = didSkillActivate(transcript, slug);
        }
      } catch {
        // Malformed case.json -- checklist/activation are just empty, not a hard failure.
      }
    }
  }

  // Fix F7: `skillInvoked` is now computed by RunEngine/StationEngine for
  // EVERY run and persisted on run.json, not just "trigger"-class eval
  // fixtures (the narrow path above, kept for the existing `activated`
  // checklist-grading consumer). Prefer the persisted field; fall back to
  // deriving it here for run.json files written before this fix existed.
  const skillInvoked =
    typeof runRecord.skillInvoked === "boolean" ? runRecord.skillInvoked : didSkillActivate(transcript, slug);

  return jsonResponse({ run, transcript, artifacts, gradingHistory, checks, activated, skillInvoked });
};

interface TriggerRunRequestBody {
  readonly provider?: unknown;
  /** Fix 1 (Phase 20 Story 2 friction log F1): a model id from the provider's advertised `session/new` models -- validated by `RunEngine`/`AcpClient` once the session connects, not here (the advertised list is only known after spawning the adapter). */
  readonly model?: unknown;
}

/**
 * `POST /api/bundles/:slug/fixtures/:case/run` -- the viewer's "Run" button.
 * Spawns `RunEngine.runFixture` via `Effect.runFork` (a scheduled fiber, NOT
 * awaited) so the HTTP request returns immediately with the run id; the run
 * itself proceeds in the background and its progress lands via `run.started`/
 * `run.completed` journal events, which the existing journal file watcher
 * (`watchJournal`) already broadcasts over SSE -- the viewer's refetch-on-SSE
 * hook picks up the new/updated run with no extra plumbing here. A
 * pre-generated `runId` (RunEngine.ts's `RunFixtureInput.runId`) is what lets
 * this handler know the id before the run finishes.
 */
const handleTriggerRun = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  caseName: string,
  request: Request,
): Promise<Response> => {
  // NOTE (seam pass over #108/#109, deliberately NOT `resolveBundleDir`):
  // `RunEngine.runFixture` below resolves `<skillsDir>/<slug>` itself, so
  // an out-of-tree in-place bundle can't run until the ENGINE learns
  // locations (a core change shared with the CLI's `skillmaker run`, out
  // of this pass's scope). Widening only this precheck would turn today's
  // honest 404 into a 200 whose forked run then dies unobserved
  // (`Effect.ignore`) -- a silent no-op, strictly worse. The two prechecks
  // must move together with the engine.
  const bundleDir = join(root, config.skillsDir, slug);
  if (!existsSync(join(bundleDir, "bundle.json"))) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }
  const caseDir = join(bundleDir, "evals", "fixtures", caseName);
  if (!existsSync(join(caseDir, "prompt.md"))) {
    return jsonResponse({ error: `fixture "${caseName}" has no prompt.md (bundle "${slug}")` }, 409);
  }

  let provider = "claude-code";
  let model: string | undefined;
  const rawText = await request.text();
  if (rawText.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
    const rawProvider = (body as TriggerRunRequestBody).provider;
    if (rawProvider !== undefined) {
      if (typeof rawProvider !== "string") {
        return jsonResponse({ error: "provider must be a string" }, 400);
      }
      provider = rawProvider;
    }
    const rawModel = (body as TriggerRunRequestBody).model;
    if (rawModel !== undefined && typeof rawModel !== "string") {
      return jsonResponse({ error: "model must be a string" }, 400);
    }
    model = typeof rawModel === "string" && rawModel.length > 0 ? rawModel : undefined;
  }
  if (config.providers[provider] === undefined) {
    return jsonResponse({ error: `provider "${provider}" is not configured in skillmaker.config.json` }, 400);
  }

  const actor = await Effect.runPromise(resolveUserActor());
  const runId = crypto.randomUUID();
  const journalPath = join(root, ".skillmaker", "events.jsonl");

  const program = runFixture({
    root,
    config,
    bundle: slug,
    fixtureCase: caseName,
    provider,
    actor,
    runId,
    ...(model !== undefined ? { model } : {}),
  }).pipe(
    Effect.provide(Layer.provide(JournalLayer(journalPath), BunServices.layer)),
    Effect.provide(BunServices.layer),
    // Non-blocking: this fiber's own success/failure is not observed by the
    // request handler (the response has already gone out). RunEngine
    // already persists the outcome (run.json + run.started/run.completed)
    // before this Effect ever resolves, so there is nothing left to report
    // here -- just never let an unhandled rejection surface.
    Effect.ignore,
  );
  Effect.runFork(program);

  return jsonResponse({ runId, status: "started" });
};

interface TriggerStationRunRequestBody {
  readonly state?: unknown;
  readonly provider?: unknown;
}

const isBundleStage = (value: string): value is BundleStage =>
  value === "idea" || value === "researching" || value === "drafting" || value === "evaluating" || value === "published";

/**
 * `POST /api/bundles/:slug/station-run` -- the viewer's "Run station"
 * button (OverviewTab). Same detached-run shape as `handleTriggerRun`:
 * `StationEngine.runStation` is spawned via `Effect.runFork` (not awaited),
 * the HTTP response returns a pre-generated `runId` immediately, and the
 * run's actual progress (station.started / run.started / run.completed /
 * review.requested) lands via the journal, which the SSE watcher already
 * broadcasts.
 */
const handleTriggerStationRun = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  request: Request,
): Promise<Response> => {
  // NOTE: deliberately conventional-path, same reason as `handleTriggerRun`
  // above -- `StationEngine.runStation` resolves `<skillsDir>/<slug>`
  // itself; this precheck moves when the engine does.
  const bundleDir = join(root, config.skillsDir, slug);
  if (!existsSync(join(bundleDir, "bundle.json"))) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }

  let provider = "claude-code";
  let state: BundleStage | undefined;
  const rawText = await request.text();
  if (rawText.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
    const rawProvider = (body as TriggerStationRunRequestBody).provider;
    if (rawProvider !== undefined) {
      if (typeof rawProvider !== "string") {
        return jsonResponse({ error: "provider must be a string" }, 400);
      }
      provider = rawProvider;
    }
    const rawState = (body as TriggerStationRunRequestBody).state;
    if (rawState !== undefined) {
      if (typeof rawState !== "string" || !isBundleStage(rawState)) {
        return jsonResponse({ error: "state must be a valid bundle stage" }, 400);
      }
      state = rawState;
    }
  }
  if (config.providers[provider] === undefined) {
    return jsonResponse({ error: `provider "${provider}" is not configured in skillmaker.config.json` }, 400);
  }

  const actor = await Effect.runPromise(resolveUserActor());
  const runId = crypto.randomUUID();
  const journalPath = join(root, ".skillmaker", "events.jsonl");

  const program = runStation({
    root,
    config,
    bundle: slug,
    ...(state !== undefined ? { state } : {}),
    provider,
    actor,
    runId,
  }).pipe(
    Effect.provide(Layer.provide(JournalLayer(journalPath), BunServices.layer)),
    Effect.provide(BunServices.layer),
    // Non-blocking, same rationale as handleTriggerRun: StationEngine
    // already persists the outcome (run.json + journal events) before this
    // Effect ever resolves.
    Effect.ignore,
  );
  Effect.runFork(program);

  return jsonResponse({ runId, status: "started" });
};

/**
 * `GET /api/skillbook` -- the Skillbook page's data (data-model.md §2.14).
 * Runs the SAME `loadSkillbook` data-aggregation `skillmaker book build`
 * runs (`../Skillbook.ts`) -- "one generator over existing facts... rendered
 * two ways": here as JSON for the live viewer tab, there as a static site.
 */
const handleSkillbook = async (root: string, config: WorkspaceConfig): Promise<Response> => {
  try {
    const data = await loadSkillbook(root, config);
    return jsonResponse(data);
  } catch (cause) {
    return jsonResponse({ error: `could not build skillbook: ${String(cause)}` }, 500);
  }
};

interface PublishRequestBody {
  readonly target?: unknown;
}

/**
 * `POST /api/bundles/:slug/publish` -- the viewer's post-publish "Publish to
 * targets" step (Phase 17's guided publish flow, extended). Runs the SAME
 * `publishBundle` core function the CLI's `skillmaker publish` command runs
 * (`../commands/Publish.ts`) -- one contract, two doors. `target` in the
 * body is optional (default: every configured target), mirroring the CLI's
 * `--target` flag.
 */
const handlePublish = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  request: Request,
): Promise<Response> => {
  const bundle = await getBundleRecord(root, slug);
  if (bundle === undefined) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }

  if (config.publishTargets.length === 0) {
    return jsonResponse(
      { error: "no publishTargets configured in skillmaker.config.json -- nothing to publish to" },
      409,
    );
  }

  let target: string | undefined;
  const rawText = await request.text();
  if (rawText.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
    const rawTarget = (body as PublishRequestBody).target;
    if (rawTarget !== undefined) {
      if (typeof rawTarget !== "string") {
        return jsonResponse({ error: "target must be a string" }, 400);
      }
      target = rawTarget;
    }
  }

  // The bundle's ACTUAL directory (seam pass over #108/#109):
  // `publishBundle` takes the directory explicitly and is itself
  // layout-aware (`detectBundleLayout` inside), so resolving here fixes
  // publish for in-place bundles end-to-end.
  const bundleDir = await resolveBundleDir(root, config, slug);
  const journalPath = join(root, ".skillmaker", "events.jsonl");
  const actor = await Effect.runPromise(resolveUserActor());

  const outcome = await Effect.runPromise(
    publishBundle({
      workspaceRoot: root,
      bundleDir,
      bundle: slug,
      workspaceName: config.name,
      targets: config.publishTargets,
      targetIds: target === undefined ? undefined : [target],
      actor,
    }).pipe(
      Effect.provide(Layer.provide(JournalLayer(journalPath), BunServices.layer)),
      Effect.provide(BunServices.layer),
      Effect.map((result) => ({ kind: "ok" as const, result })),
      Effect.catchTag("PublishGuardError", (error) =>
        Effect.succeed({ kind: "guard" as const, reason: error.reason }),
      ),
      Effect.catchTag("PublishTargetNotFoundError", (error) =>
        Effect.succeed({ kind: "not_found" as const, target: error.target }),
      ),
      Effect.catchTag("UnknownPublishTargetKindError", (error) =>
        Effect.succeed({ kind: "unknown_kind" as const, target: error.target, targetKind: error.kind }),
      ),
    ),
  );

  if (outcome.kind === "guard") {
    return jsonResponse({ error: outcome.reason }, 409);
  }
  if (outcome.kind === "not_found") {
    return jsonResponse({ error: `no publish target "${outcome.target}" in skillmaker.config.json's publishTargets` }, 400);
  }
  if (outcome.kind === "unknown_kind") {
    return jsonResponse(
      { error: `publish target "${outcome.target}" has unrecognized kind "${outcome.targetKind}"` },
      400,
    );
  }

  return jsonResponse(outcome.result);
};

/**
 * A single set of SSE subscriber "send" functions, broadcast to on journal
 * change and on the heartbeat interval. Scoped per server instance.
 */
const createEventBroadcaster = () => {
  const clients = new Set<(chunk: string) => void>();

  const broadcast = (chunk: string) => {
    for (const send of clients) {
      send(chunk);
    }
  };

  const response = (): Response => {
    const encoder = new TextEncoder();
    let send: (chunk: string) => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Controller already closed by the client disconnecting; the
            // `cancel` callback below removes it from `clients` shortly.
          }
        };
        clients.add(send);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        clients.delete(send);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  };

  return {
    response,
    onJournalChange: () => broadcast("data: journal\n\n"),
    onHeartbeat: () => broadcast(": heartbeat\n\n"),
  };
};

const serveStatic = async (viewerDist: string, pathname: string): Promise<Response> => {
  const resolved = resolveStaticPath(viewerDist, pathname);
  if (resolved === undefined) {
    return new Response("Not Found", { status: 404 });
  }

  const tryFile = (filePath: string): Response | undefined => {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return undefined;
    }
    return new Response(readFileSync(filePath), {
      headers: { "content-type": contentTypeFor(filePath) },
    });
  };

  const direct = tryFile(resolved);
  if (direct !== undefined) {
    return direct;
  }

  // Directory index: a path that maps to a built page directory (astro
  // emits pages as <route>/index.html, e.g. /next) serves that page rather
  // than falling through to the SPA.
  const dirIndex = tryFile(join(resolved, "index.html"));
  if (dirIndex !== undefined) {
    return dirIndex;
  }

  // SPA fallback: any non-/api path without a real file falls back to
  // index.html, UNLESS it looks like a real asset request (has a file
  // extension) that's simply missing -- that stays a 404.
  if (extname(pathname).length > 0) {
    return new Response("Not Found", { status: 404 });
  }

  const indexResponse = tryFile(join(viewerDist, "index.html"));
  return indexResponse ?? new Response("Not Found", { status: 404 });
};

export const startServer = (options: StartServerOptions): ServerHandle => {
  const { root, config, port, viewerDist, version } = options;
  const journalPath = join(root, ".skillmaker", "events.jsonl");
  const broadcaster = createEventBroadcaster();

  const watcherHandle: JournalWatcherHandle = watchJournal(journalPath, broadcaster.onJournalChange);
  const heartbeat = setInterval(broadcaster.onHeartbeat, HEARTBEAT_MS);
  const chatManager = new ChatSessionManager({ root, config });

  const server = Bun.serve({
    port,
    // Explicit safety net, not a fix by itself: Bun's default per-connection
    // idle timeout is 10s, which a concurrent-request burst on cold start
    // (several `/api/*` requests + the events SSE stream all racing to
    // rebuild the same workspace's index at once, see the workspace-lock
    // comment in packages/core/src/IndexService.ts) could exceed and
    // surface as "[Bun.serve]: request timed out after 10 seconds" in the
    // server log and a hung request in the browser. 30s gives real
    // (non-runaway) requests headroom without hiding a genuine hang.
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === "/api/health") {
        return jsonResponse({ ok: true, version });
      }

      if (pathname === "/api/state") {
        return jsonResponse({
          workspace: { path: root, name: config.name },
          config: {
            skillsDir: config.skillsDir,
            viewerPort: config.viewer.port,
            providers: Object.keys(config.providers),
            publishTargets: config.publishTargets.map((target) => ({ id: target.id, kind: target.kind })),
          },
        });
      }

      if (pathname === "/api/bundles") {
        if (request.method === "POST") {
          return handleCreateBundle(root, request);
        }
        try {
          const bundles = await listBundleRecords(root);
          const fixtureCounts = await listFixtureCounts(root);
          return jsonResponse({ bundles, fixtureCounts });
        } catch (cause) {
          return jsonResponse({ error: `could not list bundles: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/events" && request.method === "POST") {
        return handlePostEvent(root, request);
      }

      if (pathname === "/api/events" && request.method === "GET") {
        try {
          return await handleListEvents(root, url);
        } catch (cause) {
          return jsonResponse({ error: `could not list events: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/field-reports") {
        try {
          return await handleFieldReports(root, config);
        } catch (cause) {
          return jsonResponse({ error: `could not list field reports: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/intake") {
        try {
          return await handleIntake(root);
        } catch (cause) {
          return jsonResponse({ error: `could not list intake: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/projects") {
        try {
          return await handleProjects(root, config);
        } catch (cause) {
          return jsonResponse({ error: `could not list projects: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/catalog") {
        try {
          return await handleCatalog(root);
        } catch (cause) {
          return jsonResponse({ error: `could not build catalog: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/skillbook") {
        return handleSkillbook(root, config);
      }

      if (pathname === "/api/todos") {
        try {
          const includeSwept = url.searchParams.get("all") === "1";
          const todos = await listTodoRecords(root, includeSwept);
          return jsonResponse({ todos });
        } catch (cause) {
          return jsonResponse({ error: `could not list todos: ${String(cause)}` }, 500);
        }
      }

      if (pathname.startsWith("/api/bundles/")) {
        const rest = pathname.slice("/api/bundles/".length);
        const segments = rest.split("/").filter((segment) => segment.length > 0);
        const slug = segments[0];

        if (slug !== undefined && segments.length === 2 && segments[1] === "record-version") {
          if (request.method !== "POST") {
            return jsonResponse({ error: "record-version requires POST" }, 405);
          }
          return handleRecordVersion(root, config, slug, request);
        }

        if (slug !== undefined && segments.length === 2 && segments[1] === "files") {
          if (request.method !== "GET") {
            return jsonResponse({ error: "files requires GET" }, 405);
          }
          return handleBundleFiles(root, config, slug);
        }

        if (slug !== undefined && segments.length === 2 && segments[1] === "file") {
          if (request.method !== "GET") {
            return jsonResponse({ error: "file requires GET" }, 405);
          }
          return handleBundleFile(root, config, slug, url.searchParams.get("path"));
        }

        if (slug !== undefined && segments.length === 3 && segments[1] === "runs") {
          if (request.method !== "GET") {
            return jsonResponse({ error: "runs/:runId requires GET" }, 405);
          }
          const runId = segments[2];
          if (runId === undefined) {
            return jsonResponse({ error: "missing run id" }, 404);
          }
          return handleRunDetail(root, config, slug, runId);
        }

        if (slug !== undefined && segments.length === 3 && segments[1] === "fixtures") {
          if (request.method !== "GET") {
            return jsonResponse({ error: "fixtures/:case requires GET" }, 405);
          }
          const caseName = segments[2];
          if (caseName === undefined) {
            return jsonResponse({ error: "missing fixture case" }, 404);
          }
          return handleFixtureDetail(root, config, slug, decodeURIComponent(caseName));
        }

        if (slug !== undefined && segments.length === 4 && segments[1] === "fixtures" && segments[3] === "run") {
          if (request.method !== "POST") {
            return jsonResponse({ error: "fixtures/:case/run requires POST" }, 405);
          }
          const caseName = segments[2];
          if (caseName === undefined) {
            return jsonResponse({ error: "missing fixture case" }, 404);
          }
          return handleTriggerRun(root, config, slug, caseName, request);
        }

        if (slug !== undefined && segments.length === 2 && segments[1] === "publish") {
          if (request.method !== "POST") {
            return jsonResponse({ error: "publish requires POST" }, 405);
          }
          return handlePublish(root, config, slug, request);
        }

        if (slug !== undefined && segments.length === 2 && segments[1] === "station-run") {
          if (request.method !== "POST") {
            return jsonResponse({ error: "station-run requires POST" }, 405);
          }
          return handleTriggerStationRun(root, config, slug, request);
        }

        if (slug !== undefined && segments.length === 1) {
          try {
            return await handleBundleDetail(root, config, slug);
          } catch (cause) {
            return jsonResponse({ error: `could not load bundle "${slug}": ${String(cause)}` }, 500);
          }
        }
      }

      if (pathname === "/api/events-stream") {
        return broadcaster.response();
      }

      // Chat surface (D9): per-skill agent sessions. Explicit-start flow:
      //   GET  /api/chat/:skill/state       session + provider + resumable snapshot
      //   POST /api/chat/:skill/session     { provider, mode: "new" | "resume" } -> spawn/resume
      //   POST /api/chat/:skill/message     { text } -> one prompt turn (409 while running)
      //   POST /api/chat/:skill/permission  { requestId, optionId, decision } -> answer a pending ask
      //   POST /api/chat/:skill/cancel      cancel the in-flight turn
      //   POST /api/chat/:skill/end         close the live session (stays resumable)
      //   GET  /api/chat/:skill/stream      SSE: buffered replay + live updates
      if (pathname.startsWith("/api/chat/")) {
        const chatSegments = pathname
          .slice("/api/chat/".length)
          .split("/")
          .filter((segment) => segment.length > 0);
        const chatSkill = chatSegments[0] !== undefined ? decodeURIComponent(chatSegments[0]) : undefined;
        const chatAction = chatSegments[1];
        if (chatSkill === undefined || chatSegments.length !== 2 || chatAction === undefined) {
          return jsonResponse({ error: "chat routes are /api/chat/:skill/<state|session|message|permission|cancel|end|stream>" }, 404);
        }

        if (chatAction === "state" && request.method === "GET") {
          return jsonResponse(chatManager.state(chatSkill));
        }
        if (chatAction === "stream" && request.method === "GET") {
          return chatManager.streamResponse(chatSkill);
        }
        if (request.method !== "POST") {
          return jsonResponse({ error: `${chatAction} requires POST` }, 405);
        }

        let chatBody: unknown = {};
        try {
          const raw = await request.text();
          chatBody = raw.length > 0 ? JSON.parse(raw) : {};
        } catch {
          return jsonResponse({ error: "request body must be JSON" }, 400);
        }
        const body = typeof chatBody === "object" && chatBody !== null ? (chatBody as Record<string, unknown>) : {};

        if (chatAction === "session") {
          const provider = typeof body.provider === "string" ? body.provider : undefined;
          const mode = body.mode === "resume" ? "resume" : "new";
          if (provider === undefined) {
            return jsonResponse({ error: "session requires a provider (one of the configured provider ids)" }, 400);
          }
          const started = await chatManager.startSession(chatSkill, provider, mode);
          return started.ok
            ? jsonResponse({ state: started.state })
            : jsonResponse({ error: started.error }, started.status);
        }
        if (chatAction === "message") {
          const text = typeof body.text === "string" ? body.text.trim() : "";
          if (text.length === 0) {
            return jsonResponse({ error: "message requires non-empty text" }, 400);
          }
          const sent = await chatManager.sendMessage(chatSkill, text);
          return sent.ok ? jsonResponse({ accepted: true }, 202) : jsonResponse({ error: sent.error }, sent.status);
        }
        if (chatAction === "permission") {
          const requestId = typeof body.requestId === "string" ? body.requestId : "";
          const optionId = typeof body.optionId === "string" ? body.optionId : "";
          const decision = body.decision === "denied" ? "denied" : "allowed";
          if (requestId.length === 0 || optionId.length === 0) {
            return jsonResponse({ error: "permission requires requestId and optionId" }, 400);
          }
          const answered = chatManager.answerPermission(chatSkill, requestId, optionId, decision);
          return answered.ok ? jsonResponse({ ok: true }) : jsonResponse({ error: answered.error }, answered.status);
        }
        if (chatAction === "cancel") {
          return jsonResponse(chatManager.cancelTurn(chatSkill));
        }
        if (chatAction === "end") {
          return jsonResponse(await chatManager.endSession(chatSkill));
        }
        return jsonResponse({ error: `unknown chat action "${chatAction}"` }, 404);
      }

      if (pathname.startsWith("/api/")) {
        return jsonResponse({ error: `unknown endpoint ${pathname}` }, 404);
      }

      return serveStatic(viewerDist, pathname);
    },
  });

  return {
    port: server.port ?? port,
    stop: async () => {
      clearInterval(heartbeat);
      watcherHandle.close();
      await chatManager.stop();
      await server.stop(true);
    },
  };
};
