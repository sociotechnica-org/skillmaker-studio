/**
 * Response schemas for the `/api/*` surface served by `packages/cli`'s
 * server (see data-model.md §2.13 for the state/substate vocabulary). Kept
 * in lockstep with `@skillmaker/core`'s `BundleRecord` and `IndexService`
 * response shapes, but the viewer does not depend on `@skillmaker/core`
 * directly -- it decodes what the wire actually sends.
 */
import { Schema, SchemaGetter } from "effect";

export const BundleStage = Schema.Literals([
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
]);
export type BundleStage = typeof BundleStage.Type;

export const BundleSubstate = Schema.Literals(["working", "awaiting-review"]);
export type BundleSubstate = typeof BundleSubstate.Type;

/**
 * Drift between the live `design.md`/`output/` hashes and the latest
 * recorded version (data-model.md §2.7). `"no-version"` is a fifth state
 * beyond the doc's four -- there is no "latest" to compare against until a
 * version has been recorded at least once.
 */
export const Drift = Schema.Literals([
  "no-version",
  "in-sync",
  "design-changed",
  "output-hand-edited",
  "both",
]);
export type Drift = typeof Drift.Type;

export class BundleRecord extends Schema.Class<BundleRecord>("BundleRecord")({
  slug: Schema.String,
  name: Schema.String,
  oneLiner: Schema.String,
  tags: Schema.Array(Schema.String),
  created: Schema.String,
  stage: BundleStage,
  substate: BundleSubstate,
  archived: Schema.Boolean,
  designHash: Schema.String,
  outputHash: Schema.String,
  drift: Drift,
  /** The `at` of the bundle's last stage change, or of its creation if it's never moved (issue #82). Absent for old wire clients/journals -- tolerant decode. */
  stageChangedAt: Schema.optionalKey(Schema.String),
}) {}

/** One recorded `skill.version_recorded` event (data-model.md §2.7, §2.11). */
export class VersionRecord extends Schema.Class<VersionRecord>("VersionRecord")({
  bundle: Schema.String,
  hash: Schema.String,
  designHash: Schema.String,
  label: Schema.optionalKey(Schema.String),
  recordedAt: Schema.String,
}) {}

export class BundlesResponse extends Schema.Class<BundlesResponse>("BundlesResponse")({
  bundles: Schema.Array(BundleRecord),
  /** bundle slug -> fixture count, for the board's subtle fixture-count indicator (plan.md Phase 7). */
  fixtureCounts: Schema.Record(Schema.String, Schema.Number),
}) {}

/**
 * A scanned `evals/fixtures/<case>/case.json` (data-model.md §2.5, §2.11).
 * `class` is left as `Schema.String`, not a literal union -- `scanFixtures`
 * tolerates an unknown class as a warning rather than dropping the fixture,
 * so the wire can legitimately send a non-canonical value here too.
 */
export class FixtureRecord extends Schema.Class<FixtureRecord>("FixtureRecord")({
  bundle: Schema.String,
  caseName: Schema.String,
  class: Schema.String,
  risks: Schema.Array(Schema.String),
  /** Whether `prompt.md` exists next to `case.json` (PROMPT.MD CHANGE) -- the Evals tab's prompt.md indicator. */
  hasPromptMd: Schema.Boolean,
}) {}

/** ● covered / ◐ partial / ○ gap / n/a (data-model.md §2.6). No results column, ever. */
export const CoverageValue = Schema.Literals(["covered", "partial", "gap", "n/a"]);
export type CoverageValue = typeof CoverageValue.Type;

/** One authored `evals/risk-map.md` row (data-model.md §2.6, §2.11). */
export class RiskCoverageRecord extends Schema.Class<RiskCoverageRecord>("RiskCoverageRecord")({
  bundle: Schema.String,
  riskId: Schema.String,
  /** Left as `Schema.String`, not a literal union, for the same reason as `FixtureRecord.class`. */
  family: Schema.String,
  coverage: CoverageValue,
  fixtureCase: Schema.optionalKey(Schema.String),
}) {}

/** A reindex-time warning (Part 3 ruling I: warnings, never hard fails). */
export class WarningRecord extends Schema.Class<WarningRecord>("WarningRecord")({
  bundle: Schema.optionalKey(Schema.String),
  source: Schema.String,
  message: Schema.String,
}) {}

/** `run.json`'s `status` (data-model.md §2.8). `"running"` is transient -- a crash mid-run can leave it stuck, but the run record is never deleted. */
export const RunStatus = Schema.Literals(["running", "completed", "failed", "infra-error"]);
export type RunStatus = typeof RunStatus.Type;

/** A grading verdict (data-model.md §2.9): kept in lockstep with core's `RunVerdict`. Absent on ungraded runs. */
export const RunVerdict = Schema.Literals(["pass", "fail", "partial"]);
export type RunVerdict = typeof RunVerdict.Type;

/** One eval run against a fixture case (data-model.md §2.8, §2.11, plan.md Phase 8). Grading columns are populated starting Phase 9. */
export class RunRecord extends Schema.Class<RunRecord>("RunRecord")({
  id: Schema.String,
  bundle: Schema.String,
  fixtureCase: Schema.optionalKey(Schema.String),
  versionHash: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.optionalKey(Schema.String),
  status: RunStatus,
  verdict: Schema.optionalKey(RunVerdict),
  gradedAt: Schema.optionalKey(Schema.String),
}) {}

export class WorkspaceSummary extends Schema.Class<WorkspaceSummary>("WorkspaceSummary")({
  path: Schema.String,
  name: Schema.String,
}) {}

export class ConfigSummary extends Schema.Class<ConfigSummary>("ConfigSummary")({
  skillsDir: Schema.String,
  viewerPort: Schema.Number,
  /** Configured provider names -- the run-trigger provider select (Phase 9) shows a picker only when >1. */
  providers: Schema.Array(Schema.String),
  /** `skillmaker.config.json`'s `publishTargets` (data-model.md §2.14) -- the skill card's post-publish "Publish to targets" step shows only when this is non-empty. */
  publishTargets: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String })),
}) {}

export class StateResponse extends Schema.Class<StateResponse>("StateResponse")({
  workspace: WorkspaceSummary,
  config: ConfigSummary,
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  ok: Schema.Boolean,
  version: Schema.String,
}) {}

/**
 * The production stage ladder, in order (data-model.md §2.13, ruling F).
 * Kept in lockstep with `@skillmaker/core`'s `Machine.STAGES`, but declared
 * locally -- the viewer decodes what the wire sends, it does not import
 * `@skillmaker/core`.
 */
export const STAGES: ReadonlyArray<BundleStage> = [
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
];

/**
 * Human-facing labels for the pipeline — the *display* vocabulary (parallel
 * verbs), kept deliberately separate from the wire/state names
 * (`idea`/`researching`/…) so the journal format, guard logic, and every
 * `stage === "idea"` check stay untouched. The column rename lives here, in one
 * map, consumed by the Board, the bundle Overview, and the Lab.
 */
export const STAGE_LABEL: Record<BundleStage, string> = {
  idea: "Idea",
  researching: "Research",
  drafting: "Draft",
  evaluating: "Evals",
  published: "Publish",
};

/** Archived isn't a stage (it's the `archived` flag) — this is its board column label. */
export const ARCHIVED_LABEL = "Archive";

/**
 * The stage badge's colors, keyed by wire stage (issue #109): ONE map,
 * consumed by the skill card header (`SkillCard.tsx`), Track's catalog rows
 * (`Track.tsx`), the Lab bench (`Lab.tsx`), and Ship (`Ship.tsx`) -- the
 * same single-source treatment `UNVERIFIED_BADGE_CLASS` below already got,
 * instead of four hand-copied Tailwind tables.
 */
export const STAGE_BADGE_CLASS: Record<BundleStage, string> = {
  idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  researching: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  drafting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  evaluating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

/** The Retired badge's colors (issue #109: Retire is the display verb for the reversible `archived` flag) -- muted neutral: shelved, not alarming. */
export const RETIRED_BADGE_CLASS = "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";

/**
 * The Unverified badge's shared style (issue #93): one constant instead of
 * three hand-copied Tailwind strings, consumed by the Lab Bench (`Lab.tsx`),
 * Receive's recently-routed tail (`Receive.tsx`), and the bundle detail Evals
 * tab (`SkillCard.tsx`). Deliberately violet, not amber -- Lab's drift pill
 * already owns amber for "something moved"; this badge means "no proof," an
 * absence, not an alarm.
 */
export const UNVERIFIED_BADGE_CLASS = "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300";

/** Mirrors `@skillmaker/core`'s `Machine.GuardStatus` (data-model.md §2.13). */
export class GuardStatus extends Schema.Class<GuardStatus>("GuardStatus")({
  stage: BundleStage,
  approvedForForward: Schema.Boolean,
  gateApproved: Schema.Boolean,
}) {}

export class ActorView extends Schema.Class<ActorView>("ActorView")({
  kind: Schema.Literals(["user", "agent", "process"]),
  name: Schema.String,
  provider: Schema.optionalKey(Schema.String),
}) {}

/**
 * A journal event as rendered in the bundle-detail panel. `payload` is left
 * as `Schema.Unknown` -- the panel only needs a handful of well-known fields
 * per event `type`, read defensively rather than via a full 16-member
 * discriminated union the viewer would have to keep hand-in-hand with core.
 */
export class EventView extends Schema.Class<EventView>("EventView")({
  id: Schema.String,
  type: Schema.String,
  at: Schema.String,
  actor: ActorView,
  payload: Schema.Unknown,
}) {}

/**
 * One measurement cell (data-model.md §2.11): NEVER pooled -- keyed on
 * bundle x fixture x version x provider (+model), CI computed in core at
 * read time (rule of three when 0 failures, else Wilson).
 */
export class MeasurementRecord extends Schema.Class<MeasurementRecord>("MeasurementRecord")({
  bundle: Schema.String,
  fixtureCase: Schema.String,
  versionHash: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  n: Schema.Number,
  passes: Schema.Number,
  // Fix 3 (F5): counted in `n`'s denominator, never in `passRate`'s
  // numerator -- kept as their own fields so a partial verdict stays
  // visible instead of disappearing from the cell.
  partial: Schema.Number,
  fail: Schema.Number,
  passRate: Schema.Number,
  ci: Schema.NullOr(Schema.Tuple([Schema.Number, Schema.Number])),
}) {}

/**
 * The current stage's agent station, if the bundle has `stations.json` and
 * that stage has a `doer: "agent"` station configured (data-model.md
 * §2.13) -- what the Overview tab's "Run station" button gates on.
 */
export class StationAvailability extends Schema.Class<StationAvailability>("StationAvailability")({
  state: Schema.String,
  skill: Schema.String,
}) {}

/**
 * One named `## Contexts` entry from `dossier.md` (issue #94): "jobs
 * singular, contexts plural" -- any number of named contracts on the one
 * job, each a free-prose block (handoff-in, what downstream reads,
 * environment notes, stakes), not further structured.
 */
export class DossierContext extends Schema.Class<DossierContext>("DossierContext")({
  name: Schema.String,
  body: Schema.String,
  /** Handoff CLAIM (issue #108): what hands work to this skill -- a bundle slug when local, honest free text otherwise. Never resolved, never a graph edge; absent = unclaimed = honest gap. */
  upstream: Schema.optionalKey(Schema.String),
  /** Handoff CLAIM (issue #108): what reads this skill's output. Same rules as `upstream`. */
  downstream: Schema.optionalKey(Schema.String),
  /** Handoff CLAIM (issue #108): who/what runs it. Same rules as `upstream`. */
  hands: Schema.optionalKey(Schema.String),
}) {}

/**
 * `skills/<slug>/dossier.md`'s parsed sections (issue #94, `Mechanism -
 * Receiving Dock.md` §HOW's "the dossier"): every field optional -- an
 * absent one is an honest gap ("fit criterion: unrecorded" on the detail
 * page), never a defect.
 */
export class DossierRecord extends Schema.Class<DossierRecord>("DossierRecord")({
  job: Schema.optionalKey(Schema.String),
  contexts: Schema.Array(DossierContext),
  outOfScope: Schema.optionalKey(Schema.String),
  basis: Schema.optionalKey(Schema.String),
  evidence: Schema.optionalKey(Schema.String),
  fitCriterion: Schema.optionalKey(Schema.String),
}) {}

/**
 * Lineage (issue #109, the card's Lineage tab): chain of custody replayed
 * from the journal server-side (`handleBundleDetail` -- creation/receipt
 * origin, version records, ship/receive acts, retire/restore, uncapped and
 * chronological, unlike the recent-events tail) plus the fork family from
 * adopt markers (`forkOf` stamped by `route --as fork`; `forks` the
 * bundles whose markers point back here; `upstream` from `adopt --source`/
 * the dock). All derived, recomputed per request -- never a store.
 */
export class LineageRecord extends Schema.Class<LineageRecord>("LineageRecord")({
  custody: Schema.Array(EventView),
  forkOf: Schema.NullOr(Schema.String),
  forks: Schema.Array(Schema.String),
  upstream: Schema.NullOr(Schema.Struct({ source: Schema.String, ref: Schema.NullOr(Schema.String) })),
}) {}

export class BundleDetailResponse extends Schema.Class<BundleDetailResponse>(
  "BundleDetailResponse",
)({
  bundle: BundleRecord,
  guardStatus: GuardStatus,
  events: Schema.Array(EventView),
  versions: Schema.Array(VersionRecord),
  fixtures: Schema.Array(FixtureRecord),
  riskCoverage: Schema.Array(RiskCoverageRecord),
  warnings: Schema.Array(WarningRecord),
  runs: Schema.Array(RunRecord),
  measurements: Schema.Array(MeasurementRecord),
  station: Schema.NullOr(StationAvailability),
  dossier: DossierRecord,
  /** The card's Lineage tab data (issue #109) -- custody chain + fork family, derived server-side. */
  lineage: LineageRecord,
  /** The bundle's reviewable source files (design.md, research/*, output/*) for the Files tab, pipeline-ordered. */
  files: Schema.Array(Schema.String),
  /**
   * The skill's own instructions file for the Instructions tab (card-fidelity
   * simplify pass): derived server-side from the bundle's resolved layout
   * (`output/SKILL.md` for output-dir bundles, `SKILL.md` for in-place ones)
   * so the viewer never re-derives `BundleLayout` by probing `files`. `null`
   * when the file doesn't exist yet -- an honest gap. A free-text relative
   * path, not a vocabulary word (no VocabLockstep row).
   */
  instructionsPath: Schema.NullOr(Schema.String),
  /** The Unverified badge (issue #93): same derivation as `CatalogEntry.unverified`, computed from this same response's `measurements`. */
  unverified: Schema.Boolean,
}) {}

/**
 * `GET /api/bundles/:slug/fixtures/:case` (card-fidelity round 2): one
 * fixture's readable test body -- the parsed case, not a raw file dump.
 * `promptMd` is the sibling `prompt.md`'s content (`null` when the case has
 * none); `legacyPrompt` is the scaffold-era `case.json` `prompt` string
 * (tolerated, never required -- shown only when no prompt.md exists);
 * `grading` carries the authored pass criteria (`answerKey` + `checks`).
 * All free text, mirrored as-is -- no vocabulary words, no lockstep rows.
 * `warnings` reports malformed `case.json` content honestly instead of the
 * server hard-failing (same tolerance as core's `scanFixtures`).
 */
export class FixtureGradingView extends Schema.Class<FixtureGradingView>("FixtureGradingView")({
  answerKey: Schema.NullOr(Schema.String),
  checks: Schema.Array(Schema.String),
}) {}

export class FixtureDetailResponse extends Schema.Class<FixtureDetailResponse>("FixtureDetailResponse")({
  caseName: Schema.String,
  class: Schema.NullOr(Schema.String),
  risks: Schema.Array(Schema.String),
  context: Schema.NullOr(Schema.String),
  promptMd: Schema.NullOr(Schema.String),
  legacyPrompt: Schema.NullOr(Schema.String),
  grading: Schema.NullOr(FixtureGradingView),
  warnings: Schema.Array(Schema.String),
}) {}

/**
 * The `run.json` fields the run-detail panel renders (data-model.md §2.8).
 * Extra keys on the wire (`schemaVersion`, `actor`, `kind`, `station`) are
 * ignored on decode, per this file's decode-what-the-wire-sends convention.
 */
export class RunDetailRun extends Schema.Class<RunDetailRun>("RunDetailRun")({
  id: Schema.String,
  bundle: Schema.String,
  fixtureCase: Schema.optionalKey(Schema.String),
  skillVersionHash: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.optionalKey(Schema.String),
  status: RunStatus,
}) {}

/**
 * `GET /api/bundles/:slug/runs/:runId` (data-model.md §2.12). `transcript`
 * entries stay `Schema.Unknown` -- raw ACP wire messages rendered
 * defensively, exactly like `EventView.payload`. `gradingHistory` is newest
 * first; `checks` is the fixture's authored `grading.checks` strings.
 */
export class RunDetailResponse extends Schema.Class<RunDetailResponse>("RunDetailResponse")({
  run: RunDetailRun,
  transcript: Schema.Array(Schema.Unknown),
  artifacts: Schema.Array(Schema.String),
  gradingHistory: Schema.Array(EventView),
  checks: Schema.Array(Schema.String),
}) {}

/** `POST /api/bundles/:slug/fixtures/:case/run` response -- the run id, returned before the run finishes. */
export class TriggerRunResponse extends Schema.Class<TriggerRunResponse>("TriggerRunResponse")({
  runId: Schema.String,
  status: Schema.Literal("started"),
}) {}

/** `POST /api/bundles/:slug/station-run` response -- same shape as `TriggerRunResponse`. */
export class TriggerStationRunResponse extends Schema.Class<TriggerStationRunResponse>(
  "TriggerStationRunResponse",
)({
  runId: Schema.String,
  status: Schema.Literal("started"),
}) {}

export class PostEventResponse extends Schema.Class<PostEventResponse>("PostEventResponse")({
  status: Schema.Literals(["appended", "already_appended"]),
  event: EventView,
}) {}

/** `POST /api/bundles/:slug/record-version` response. */
export class RecordVersionResponse extends Schema.Class<RecordVersionResponse>(
  "RecordVersionResponse",
)({
  status: Schema.Literals(["appended", "already_appended"]),
  hash: Schema.String,
  designHash: Schema.String,
  label: Schema.NullOr(Schema.String),
}) {}

/** `POST /api/bundles` response -- the board's "+ New bundle" create form. */
export class CreateBundleResponse extends Schema.Class<CreateBundleResponse>(
  "CreateBundleResponse",
)({
  status: Schema.Literals(["created", "already_exists"]),
  slug: Schema.String,
}) {}

/** `GET /api/bundles/:slug/file?path=...` response. */
export class BundleFileResponse extends Schema.Class<BundleFileResponse>("BundleFileResponse")({
  path: Schema.String,
  content: Schema.String,
}) {}

export class ApiErrorResponse extends Schema.Class<ApiErrorResponse>("ApiErrorResponse")({
  error: Schema.String,
}) {}

/**
 * Mirrors `@skillmaker/core`'s `Todo`/`IndexService.TodoRecord`
 * (data-model.md §2.10, §2.11), but declared locally like the rest of this
 * file -- the viewer decodes what the wire sends.
 */
export const TodoKind = Schema.Literals(["task", "bug", "improvement", "eval"]);
export type TodoKind = typeof TodoKind.Type;

export const TodoStatus = Schema.Literals(["open", "in-progress", "done", "wont-do"]);
export type TodoStatus = typeof TodoStatus.Type;

export class ChecklistItemView extends Schema.Class<ChecklistItemView>("ChecklistItemView")({
  text: Schema.String,
  done: Schema.Boolean,
}) {}

/**
 * Mirrors `@skillmaker/core`'s `TodoOrigin`/`TodoOriginRecord` (issue #81,
 * `"intake"` added issues #91/#92; reshaped to a per-kind-id union by the
 * 2026-07-17 data-model reconciliation, ruling R2): which upstream signal
 * opened this todo automatically, if any -- a field report (keyed by its
 * journal event's `eventId`), an intake (keyed by the crate's
 * `intakeId`, salvage mining / the triage manifest's "what hurts"), or a
 * run (keyed by the run's own `runId`, the read-out's "this run surfaced
 * work" door -- 2026-07-21 simplification, D5).
 */
export const TodoOriginFieldReportView = Schema.Struct({
  kind: Schema.Literal("field-report"),
  eventId: Schema.String,
});

export const TodoOriginIntakeView = Schema.Struct({
  kind: Schema.Literal("intake"),
  intakeId: Schema.String,
});

export const TodoOriginRunView = Schema.Struct({
  kind: Schema.Literal("run"),
  runId: Schema.String,
});

export const TodoOriginView = Schema.Union([
  TodoOriginFieldReportView,
  TodoOriginIntakeView,
  TodoOriginRunView,
]);
export type TodoOriginView = typeof TodoOriginView.Type;

/**
 * READ SHIM, mirrored from core's `TodoOriginFromWire` (the viewer
 * deliberately never imports `@skillmaker/core` -- it decodes what the wire
 * actually sends). The journal is append-only, so wire data derived from
 * old events -- most concretely a `studio.db` built before the reshape,
 * served through `/api/todos` before its next rebuild -- can still carry
 * the retired `{kind, ref}` origin overload. When the legacy `ref` key is
 * present it is mapped to `eventId` (kind `field-report`) or `intakeId`
 * (kind `intake`); everything past decode sees only the union above. The
 * viewer writes no origins, so the legacy branch here is read-only by
 * construction.
 */
const TodoOriginViewWire = Schema.Union([
  TodoOriginFieldReportView,
  TodoOriginIntakeView,
  // `run` postdates the reshape (D5), so it has no legacy `ref` form.
  TodoOriginRunView,
  Schema.Struct({ kind: Schema.Literals(["field-report", "intake"]), ref: Schema.String }),
]);

const TodoOriginViewFromWire = TodoOriginViewWire.pipe(
  Schema.decodeTo(TodoOriginView, {
    decode: SchemaGetter.transform((wire) =>
      "ref" in wire
        ? wire.kind === "field-report"
          ? { kind: "field-report" as const, eventId: wire.ref }
          : { kind: "intake" as const, intakeId: wire.ref }
        : wire,
    ),
    encode: SchemaGetter.passthroughSubtype(),
  }),
);

export class TodoRecord extends Schema.Class<TodoRecord>("TodoRecord")({
  id: Schema.String,
  kind: TodoKind,
  status: TodoStatus,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  checklist: Schema.optionalKey(Schema.Array(ChecklistItemView)),
  priority: Schema.Number,
  bundle: Schema.optionalKey(Schema.String),
  created: Schema.String,
  terminalAt: Schema.optionalKey(Schema.String),
  pinned: Schema.optionalKey(Schema.Boolean),
  swept: Schema.Boolean,
  source: ActorView,
  origin: Schema.optionalKey(TodoOriginViewFromWire),
}) {}

export class TodosResponse extends Schema.Class<TodosResponse>("TodosResponse")({
  todos: Schema.Array(TodoRecord),
}) {}

/**
 * `GET /api/events[?limit=&before=]` -- the Activity page's journal feed
 * (Phase 17, ui-pass-spec.md §3.1 "new capability the old surface lacked").
 * Newest first; `nextCursor` (an event id) is `null` once there is nothing
 * older left to page through.
 */
export class EventsResponse extends Schema.Class<EventsResponse>("EventsResponse")({
  events: Schema.Array(EventView),
  nextCursor: Schema.NullOr(Schema.String),
}) {}

/**
 * One `GET /api/catalog` row (Phase 17, director ruling: the Catalog page,
 * now the Lab (#64), survives as a skill browser -- "what skills do we
 * have," discovery at repo scale). `latestVersion` mirrors `VersionRecord`
 * but is nullable (no version recorded yet); `measuredFixtureCount`/
 * `fixtureCount` is the measurements-summary the ruling calls for, derived
 * server-side from the same fixtures/measurements data `BundleDetailResponse`
 * already exposes per-bundle. Class/endpoint names stay `Catalog*`/
 * `/api/catalog` -- they mirror the untouched server wire format.
 *
 * `openTodoCount` (issue #83): the count of non-terminal todos on this
 * bundle, folded server-side from the journal on every request (see
 * `handleCatalog`'s doc comment) -- never stored. Feeds the Lab Bench
 * mode's open-work signal and `orderForAttention`'s new rank.
 */
export class CatalogEntry extends Schema.Class<CatalogEntry>("CatalogEntry")({
  slug: Schema.String,
  name: Schema.String,
  oneLiner: Schema.String,
  tags: Schema.Array(Schema.String),
  stage: BundleStage,
  archived: Schema.Boolean,
  drift: Drift,
  latestVersion: Schema.NullOr(
    Schema.Struct({
      hash: Schema.String,
      label: Schema.NullOr(Schema.String),
      recordedAt: Schema.String,
    }),
  ),
  fixtureCount: Schema.Number,
  measuredFixtureCount: Schema.Number,
  openTodoCount: Schema.Number,
  /**
   * The Unverified badge (issue #93, `Mechanism - Receiving Dock.md` §HOW):
   * received (arrived via `skill.routed`, an identity-granting disposition)
   * AND zero graded measurements ever, at any recorded version. Derived
   * server-side (`handleCatalog`), never stored -- no "Verified" state
   * exists on the other side of this boolean, its absence is silence.
   */
  unverified: Schema.Boolean,
  /**
   * Whereabouts (issue #109): the last `skill.shipped` fact for this bundle
   * -- where it last went, which version left, when. `null` = never shipped,
   * an honest absence. One piece of the derived status set, never "the
   * location": a skill can be published, shipped, and back on the bench at
   * once.
   */
  lastShipment: Schema.NullOr(
    Schema.Struct({
      destination: Schema.String,
      versionHash: Schema.String,
      at: Schema.String,
    }),
  ),
  /** The `at` of this bundle's most recent attributable journal event (falls back to its creation timestamp) -- Track's recency sort key. Derived server-side, never stored. */
  lastActivityAt: Schema.String,
}) {}

export class CatalogResponse extends Schema.Class<CatalogResponse>("CatalogResponse")({
  entries: Schema.Array(CatalogEntry),
}) {}

/**
 * `GET /api/skillbook` (data-model.md §2.14): "skills leave the studio with
 * receipts." One changelog entry per version/publish/gate/shipped/reported
 * event, newest first; `designMarkdown` is the raw `design.md` content
 * (rendered client-side, same hand-rolled markdown subset `book build`'s
 * `BookRenderer.ts` renders server/CLI-side).
 */
export class SkillbookChangelogEntry extends Schema.Class<SkillbookChangelogEntry>(
  "SkillbookChangelogEntry",
)({
  type: Schema.Literals(["version", "published", "gate", "shipped", "reported"]),
  at: Schema.String,
  summary: Schema.String,
}) {}

/**
 * One measurement cell as it stood at ship time (issue #66) -- a narrower
 * shape than `MeasurementRecord`: `bundle`/`versionHash` are already the
 * enclosing `SkillbookShipment`'s own fields.
 */
export class ShipReceipt extends Schema.Class<ShipReceipt>("ShipReceipt")({
  fixtureCase: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  n: Schema.Number,
  passes: Schema.Number,
  passRate: Schema.Number,
  ci: Schema.NullOr(Schema.Tuple([Schema.Number, Schema.Number])),
}) {}

/**
 * One `skill.shipped` event, materialized for Ship (issue #66): "where
 * is this in the world" -- destination, purpose, the version that left, and
 * the receipts it shipped with, frozen at that moment.
 */
export class SkillbookShipment extends Schema.Class<SkillbookShipment>("SkillbookShipment")({
  at: Schema.String,
  versionHash: Schema.String,
  destination: Schema.String,
  purpose: Schema.String,
  receipts: Schema.Array(ShipReceipt),
}) {}

export class SkillbookBundle extends Schema.Class<SkillbookBundle>("SkillbookBundle")({
  slug: Schema.String,
  name: Schema.String,
  oneLiner: Schema.String,
  stage: Schema.String,
  designMarkdown: Schema.String,
  latestVersion: Schema.NullOr(VersionRecord),
  measurements: Schema.Array(MeasurementRecord),
  changelog: Schema.Array(SkillbookChangelogEntry),
  shipments: Schema.Array(SkillbookShipment),
  /** Derived server-side by `Skillbook.ts`'s `isInSkillbook` (issue #109 Stage 3): the ONE definition of the outward book's population, shared with `book build`'s static index -- the viewer displays it, never recomputes it. */
  inBook: Schema.Boolean,
}) {}

export class SkillbookResponse extends Schema.Class<SkillbookResponse>("SkillbookResponse")({
  workspaceName: Schema.String,
  bundles: Schema.Array(SkillbookBundle),
}) {}

/** Mirrors `@skillmaker/core`'s `FieldReportOutcome` (issue #67) -- the reporter's own read, not a pass/fail eval verdict. */
export const FieldReportOutcome = Schema.Literals(["worked", "failed", "surprise"]);
export type FieldReportOutcome = typeof FieldReportOutcome.Type;

/**
 * `GET /api/field-reports` -- Receive's workspace-wide field-report list
 * (issue #67): "what is the world telling me about what I shipped."
 * `versionHash`/`destination` are `null` when the reporter didn't know them.
 * `fixtureCase` (issue #68) is the harvested fixture's case name on this
 * bundle's Evals tab, when `fixture harvest --from-report` has turned this
 * exact report into a fixture; `null` when it hasn't been harvested yet.
 * `todo` (issue #81) is the other exit door: the todo, if any, opened via
 * `todo add --from-report` against this exact report -- `null` when no todo
 * has been opened from it yet.
 */
export class FieldReportView extends Schema.Class<FieldReportView>("FieldReportView")({
  id: Schema.String,
  bundle: Schema.String,
  outcome: FieldReportOutcome,
  report: Schema.String,
  versionHash: Schema.NullOr(Schema.String),
  destination: Schema.NullOr(Schema.String),
  at: Schema.String,
  actor: ActorView,
  fixtureCase: Schema.NullOr(Schema.String),
  todo: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      status: TodoStatus,
    }),
  ),
}) {}

/** `GET /api/field-reports` response -- newest first, unpaginated (issue #67). */
export class FieldReportsResponse extends Schema.Class<FieldReportsResponse>("FieldReportsResponse")({
  reports: Schema.Array(FieldReportView),
}) {}

/** Mirrors `@skillmaker/core`'s `IntakeRights` (issue #90) -- recorded, never enforced. */
export const IntakeRights = Schema.Literals(["ours", "licensed", "unclear"]);
export type IntakeRights = typeof IntakeRights.Type;

/** Mirrors `@skillmaker/core`'s `IntakeVerdict` (issue #90, `Mechanism - Receiving Dock.md` §HOW). */
export const IntakeVerdict = Schema.Literals(["return", "new", "conflict"]);
export type IntakeVerdict = typeof IntakeVerdict.Type;

/** Mirrors `@skillmaker/core`'s `IntakeStakes` (issue #108) -- the maker's usage-stakes claim, recorded never enforced; held equal to core by the vocab lockstep test. */
export const IntakeStakes = Schema.Literals(["aside", "load-bearing"]);
export type IntakeStakes = typeof IntakeStakes.Type;

/**
 * The stakes badge's colors, keyed by the maker's usage-stakes claim (seam
 * pass over #108/#109): ONE map, consumed by Receive's crate rows
 * (`Receive.tsx`) and Track's salvaged rows (`Track.tsx`) -- the same
 * single-source treatment `UNVERIFIED_BADGE_CLASS` got. `load-bearing` is
 * visually distinct (rose -- "someone's workflow leans on this" is exactly
 * what a harvest decision wants to notice) vs the neutral `aside`; neither
 * amber (Lab's drift pill owns it) nor violet (the Unverified badge's).
 */
export const STAKES_BADGE_CLASS: Record<IntakeStakes, string> = {
  aside: "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
  "load-bearing": "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

/**
 * `GET /api/intake` -- the Receive tab's intake queue row (issue #90): one
 * undisposed `skill.received` crate, its claims verbatim, and its dock
 * verdict RECOMPUTED server-side on every request (derive, never store --
 * this is never the same value written to the journal, because nothing is
 * ever written there at all).
 */
export class IntakeCrateView extends Schema.Class<IntakeCrateView>("IntakeCrateView")({
  intake: Schema.String,
  source: Schema.String,
  ref: Schema.NullOr(Schema.String),
  claimedName: Schema.NullOr(Schema.String),
  claimedVersionHash: Schema.NullOr(Schema.String),
  rights: Schema.NullOr(IntakeRights),
  /** Structured usage-stakes testimony (issue #108) -- `null` for pre-#108 events, whose stakes (if any) live flattened in `notes` prose, displayed as-is and never re-parsed. */
  stakes: Schema.NullOr(IntakeStakes),
  /** Structured "what hurt" testimony (issue #108) -- same additive-optional treatment as `stakes`. */
  hurts: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  at: Schema.String,
  actor: ActorView,
  verdict: IntakeVerdict,
}) {}

/** Mirrors `@skillmaker/core`'s `RouteDisposition` (issue #91, `Mechanism - Receiving Dock.md` §HOW): the five exit doors. */
export const RouteDisposition = Schema.Literals(["return", "new", "upgrade", "fork", "salvage"]);
export type RouteDisposition = typeof RouteDisposition.Type;

/**
 * Mirrors `@skillmaker/core`'s `VERDICT_DISPOSITIONS` (Receive.ts): the
 * doors each verdict offers. `salvage` under every verdict is the point --
 * the universal refusal door; a verdict constrains what the machine
 * suggests, never the human's right to refuse. Hand-mirrored because the
 * viewer never imports core; the vocab lockstep test holds the two equal.
 */
export const VERDICT_DISPOSITIONS: Readonly<Record<IntakeVerdict, ReadonlyArray<RouteDisposition>>> = {
  return: ["return", "salvage"],
  new: ["new", "salvage"],
  conflict: ["upgrade", "fork", "salvage"],
};

/**
 * `GET /api/intake`'s "recently routed" tail (issue #91): a disposed crate
 * leaves `crates` above for good, but a handful of the most recent
 * `skill.routed` facts still show here -- disposition + reason + the bundle
 * it landed on (`null` for a `salvage` naming no target), newest first.
 */
export class RecentlyRoutedView extends Schema.Class<RecentlyRoutedView>("RecentlyRoutedView")({
  intake: Schema.String,
  disposition: RouteDisposition,
  bundle: Schema.NullOr(Schema.String),
  reason: Schema.String,
  claimedName: Schema.NullOr(Schema.String),
  /** The originating crate's structured stakes testimony (issue #108, joined by the server from `skill.received` in the same pass as `claimedName`) -- `null` for pre-#108 crates. */
  stakes: Schema.NullOr(IntakeStakes),
  /** The originating crate's structured "what hurt" testimony -- same treatment as `stakes`. */
  hurts: Schema.NullOr(Schema.String),
  at: Schema.String,
  actor: ActorView,
  /** The Unverified badge (issue #93), while it holds: `false` for every `salvage` row (grants no identity) and for any bundle that already has a graded measurement. */
  unverified: Schema.Boolean,
}) {}

/**
 * One salvaged crate for the Archive drawer (issue #109): "everything out of
 * commission but kept," the drawer's second population beside retired
 * bundles. Unlike `recentlyRouted` (capped, all dispositions), this is the
 * FULL salvage fold, newest first. `bundle` is the existing bundle the
 * salvage defended, when one was named. The crate's content still sits at
 * `receiving/<intake>/` -- the intake id is the harvest handle.
 */
export class SalvagedCrateView extends Schema.Class<SalvagedCrateView>("SalvagedCrateView")({
  intake: Schema.String,
  claimedName: Schema.NullOr(Schema.String),
  bundle: Schema.NullOr(Schema.String),
  reason: Schema.String,
  /** The refused crate's own arrival testimony (issue #108, seam pass): "reported load-bearing" is exactly what the drawer's harvest decision weighs -- `null` for pre-#108 crates. */
  stakes: Schema.NullOr(IntakeStakes),
  /** What hurt, per the crate's `skill.received` -- same treatment as `stakes`. */
  hurts: Schema.NullOr(Schema.String),
  at: Schema.String,
  actor: ActorView,
}) {}

/** `GET /api/intake` response -- `crates` oldest first, unpaginated (issue #90: "the dock must not become a shelf"); `recentlyRouted` newest first, capped (issue #91); `salvaged` the Archive drawer's full salvage fold, newest first (issue #109). */
export class IntakeResponse extends Schema.Class<IntakeResponse>("IntakeResponse")({
  crates: Schema.Array(IntakeCrateView),
  recentlyRouted: Schema.Array(RecentlyRoutedView),
  salvaged: Schema.Array(SalvagedCrateView),
}) {}

/** One `publishTargets` entry (skillmaker.config.json) -- what the viewer's Publish step offers. */
export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
  id: Schema.String,
  kind: Schema.String,
  path: Schema.optionalKey(Schema.String),
}) {}

/** One target's outcome within a `POST /api/bundles/:slug/publish` response. */
export class PublishTargetResult extends Schema.Class<PublishTargetResult>("PublishTargetResult")({
  target: Schema.String,
  kind: Schema.String,
  status: Schema.Literals(["published", "already_published"]),
  url: Schema.optionalKey(Schema.String),
}) {}

/** `POST /api/bundles/:slug/publish` response. */
export class PublishBundleResponse extends Schema.Class<PublishBundleResponse>(
  "PublishBundleResponse",
)({
  bundle: Schema.String,
  versionHash: Schema.String,
  results: Schema.Array(PublishTargetResult),
}) {}
