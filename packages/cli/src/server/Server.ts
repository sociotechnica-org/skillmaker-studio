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
  foldBundleStates,
  foldTodos,
  guardStatus,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  JournalEvent,
  runFixture,
  type Actor,
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

const listVersionRecords = (root: string, slug: string): Promise<ReadonlyArray<VersionRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listVersions(slug);
    }),
  );

/** Runs for one bundle, newest first (data-model.md §2.8, plan.md Phase 8). */
const listRunRecords = (root: string, slug: string): Promise<ReadonlyArray<RunIndexRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      const runs = yield* index.listRuns(slug);
      return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }),
  );

/** Aggregated measurement cells for a bundle, never pooled (data-model.md §2.11, §1.1 laws 5-6). */
const listMeasurementRecords = (root: string, slug: string): Promise<ReadonlyArray<MeasurementRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listMeasurements(slug);
    }),
  );

interface BundleEvalDetail {
  readonly fixtures: ReadonlyArray<FixtureRecord>;
  readonly riskCoverage: ReadonlyArray<RiskCoverageRecord>;
  readonly warnings: ReadonlyArray<WarningRecord>;
}

/** Fixtures + risk coverage + warnings for one bundle (data-model.md §2.5/§2.6, plan.md Phase 7). */
const listBundleEvalDetail = (root: string, slug: string): Promise<BundleEvalDetail> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      const fixtures = yield* index.listFixtures(slug);
      const riskCoverage = yield* index.listRiskCoverage(slug);
      const warnings = yield* index.listWarnings(slug);
      return { fixtures, riskCoverage, warnings };
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
 * `GET /api/bundles/:slug` -- the detail/review panel data (data-model.md
 * §2.13, §2.7). `bundle` already carries the live `designHash`/`outputHash`/
 * `drift` (computed at `rebuild()`, data-model.md §2.7); `versions` is the
 * full recorded history, newest first.
 */
const handleBundleDetail = async (root: string, slug: string): Promise<Response> => {
  const bundle = await getBundleRecord(root, slug);
  if (bundle === undefined) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }

  const events = await readJournalEvents(root);
  const bundleEvents = events.filter((event) => bundleForEvent(event) === slug);
  // Newest first, capped at MAX_BUNDLE_DETAIL_EVENTS -- a recent-activity
  // list, not a full history (that's `skillmaker status --json`).
  const recentEvents = bundleEvents.slice(-MAX_BUNDLE_DETAIL_EVENTS).reverse();

  const versions = await listVersionRecords(root, slug);
  const { fixtures, riskCoverage, warnings } = await listBundleEvalDetail(root, slug);
  const runs = await listRunRecords(root, slug);
  const measurements = await listMeasurementRecords(root, slug);

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
  // of `IndexService`'s fixtures table).
  let checks: ReadonlyArray<string> = [];
  const runRecord = run as { readonly fixtureCase?: unknown };
  if (typeof runRecord.fixtureCase === "string") {
    const caseJsonPath = join(bundleDir, "evals", "fixtures", runRecord.fixtureCase, "case.json");
    if (existsSync(caseJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(caseJsonPath, "utf8")) as {
          readonly grading?: { readonly checks?: unknown };
        };
        const rawChecks = parsed.grading?.checks;
        if (Array.isArray(rawChecks)) {
          checks = rawChecks.filter((c): c is string => typeof c === "string");
        }
      } catch {
        // Malformed case.json -- checklist is just empty, not a hard failure.
      }
    }
  }

  return jsonResponse({ run, transcript, artifacts, gradingHistory, checks });
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

        if (slug !== undefined && segments.length === 1) {
          try {
            return await handleBundleDetail(root, slug);
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
