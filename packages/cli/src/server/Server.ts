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
  didSkillActivate,
  foldBundleStates,
  foldTodos,
  guardStatus,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  JournalEvent,
  publishBundle,
  runFixture,
  runStation,
  type Actor,
  type BundleStage,
  type BundleRecord,
  type FixtureRecord,
  type MeasurementRecord,
  type RiskCoverageRecord,
  type RunIndexRecord,
  type TodoRecord,
  type VersionRecord,
  type WarningRecord,
  type WorkspaceConfig,
} from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve as resolvePath, sep } from "node:path";
import { resolveUserActor } from "../ActorResolver.ts";
import { loadSkillbook } from "../Skillbook.ts";
import { watchJournal, type JournalWatcherHandle } from "./JournalWatcher.ts";
import { contentTypeFor, resolveStaticPath } from "./StaticFiles.ts";

const HEARTBEAT_MS = 15_000;

/**
 * The v1 event catalog (data-model.md §2.9) is much larger than this --
 * `POST /api/events` only ever accepts the subset a human/agent can
 * meaningfully cause from outside the CLI's own scaffolding commands.
 * Everything else (`bundle.created`, `skill.*`, `run.*`, `station.started`)
 * stays CLI/engine-only. `todo.*` joined the allowlist in Phase 5 -- the
 * viewer's todos panel writes directly through this path, same as bundle
 * stage/review actions.
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
]);

const MAX_BUNDLE_DETAIL_EVENTS = 20;

const DEFAULT_EVENTS_PAGE_SIZE = 50;
const MAX_EVENTS_PAGE_SIZE = 200;

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

const listTodoRecords = (root: string, includeArchived: boolean): Promise<ReadonlyArray<TodoRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listTodos({ includeArchived });
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
 */
const handleCatalog = async (root: string): Promise<Response> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      const bundles = yield* index.listBundles();

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
        });
      }
      return jsonResponse({ entries });
    }),
  );

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
 * doc comments make the same tradeoff for `rebuild()`).
 */
const findRunLocation = (
  root: string,
  config: WorkspaceConfig,
  runId: string,
): { readonly bundle: string; readonly runDir: string; readonly status: string } | undefined => {
  const skillsRoot = join(root, config.skillsDir);
  if (!existsSync(skillsRoot)) return undefined;
  let bundleSlugs: ReadonlyArray<string>;
  try {
    bundleSlugs = readdirSync(skillsRoot).filter((name) => statSync(join(skillsRoot, name)).isDirectory());
  } catch {
    return undefined;
  }
  for (const slug of bundleSlugs) {
    const runDir = join(skillsRoot, slug, "runs", runId);
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

const handlePostEvent = async (
  root: string,
  config: WorkspaceConfig,
  request: Request,
): Promise<Response> => {
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
    const location = findRunLocation(root, config, eventInput.payload.id);
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
 * when the button is actually pressed.
 */
const readCurrentStageStation = (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  stage: string,
): { readonly state: string; readonly skill: string } | null => {
  try {
    const stationsJsonPath = join(root, config.skillsDir, slug, "stations.json");
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
    };

const loadBundleIndexDetail = (root: string, slug: string): Promise<BundleIndexDetail> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
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
      };
    }),
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

  const station = readCurrentStageStation(root, config, slug, bundle.stage);

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
    station,
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
    const bundleDir = join(root, config.skillsDir, slug);
    const { designHash, outputHash } = await Effect.runPromise(
      computeBundleHashes(bundleDir).pipe(Effect.provide(BunServices.layer)),
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

/** `runs/<runId>/artifacts/<nonempty>` -- Phase 9's run-detail artifact viewer. */
const RUN_ARTIFACT_PATH = /^runs\/[^/]+\/artifacts\/.+$/;

/**
 * Only `design.md`, a non-empty path under `output/`, or a run's
 * `artifacts/` contents may be read back over HTTP (data-model.md §2.12 --
 * artifacts listed/viewable on the run-detail panel).
 */
const isAllowedBundleFilePath = (relativePath: string): boolean => {
  // No relative segments, period: `runs/<id>/artifacts/../../<id>/run.json`
  // would match the artifact pattern AND resolve inside the bundle dir
  // (passing the containment check), yet escape the allowlisted subtree.
  if (relativePath.split("/").includes("..")) {
    return false;
  }
  if (relativePath === "design.md") {
    return true;
  }
  if (relativePath.startsWith("output/") && relativePath.length > "output/".length) {
    return true;
  }
  return RUN_ARTIFACT_PATH.test(relativePath);
};

/**
 * `GET /api/bundles/:slug/file?path=design.md|output/...` -- the viewer's
 * read-only Files tab. A strict allowlist (design.md, or under output/) plus
 * a resolved-path containment check guards against traversal (`../..`,
 * absolute paths, symlink escapes); anything outside the allowlist or off
 * the bundle directory 404s rather than erroring, so it never leaks whether
 * a path exists elsewhere on disk.
 */
const handleBundleFile = async (
  root: string,
  config: WorkspaceConfig,
  slug: string,
  relPath: string | null,
): Promise<Response> => {
  if (relPath === null || relPath.length === 0 || !isAllowedBundleFilePath(relPath)) {
    return new Response("Not Found", { status: 404 });
  }

  const bundleDir = resolvePath(join(root, config.skillsDir, slug));
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
  const bundleDir = join(root, config.skillsDir, slug);
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
  const artifacts = listFilesRecursive(artifactsDir);

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
  const runRecord = run as { readonly fixtureCase?: unknown };
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

  return jsonResponse({ run, transcript, artifacts, gradingHistory, checks, activated });
};

interface TriggerRunRequestBody {
  readonly provider?: unknown;
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
  const bundleDir = join(root, config.skillsDir, slug);
  if (!existsSync(join(bundleDir, "bundle.json"))) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }
  const caseDir = join(bundleDir, "evals", "fixtures", caseName);
  if (!existsSync(join(caseDir, "prompt.md"))) {
    return jsonResponse({ error: `fixture "${caseName}" has no prompt.md (bundle "${slug}")` }, 409);
  }

  let provider = "claude-code";
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

  const bundleDir = join(root, config.skillsDir, slug);
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
        try {
          const bundles = await listBundleRecords(root);
          const fixtureCounts = await listFixtureCounts(root);
          return jsonResponse({ bundles, fixtureCounts });
        } catch (cause) {
          return jsonResponse({ error: `could not list bundles: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/events" && request.method === "POST") {
        return handlePostEvent(root, config, request);
      }

      if (pathname === "/api/events" && request.method === "GET") {
        try {
          return await handleListEvents(root, url);
        } catch (cause) {
          return jsonResponse({ error: `could not list events: ${String(cause)}` }, 500);
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
          const includeArchived = url.searchParams.get("all") === "1";
          const todos = await listTodoRecords(root, includeArchived);
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
      await server.stop(true);
    },
  };
};
