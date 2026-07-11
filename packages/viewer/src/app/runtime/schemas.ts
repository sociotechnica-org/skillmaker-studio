/**
 * Response schemas for the `/api/*` surface served by `packages/cli`'s
 * server (see data-model.md §2.13 for the state/substate vocabulary). Kept
 * in lockstep with `@skillmaker/core`'s `BundleRecord` and `IndexService`
 * response shapes, but the viewer does not depend on `@skillmaker/core`
 * directly -- it decodes what the wire actually sends.
 */
import { Schema } from "effect";

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
  archived: Schema.Boolean,
  source: ActorView,
}) {}

export class TodosResponse extends Schema.Class<TodosResponse>("TodosResponse")({
  todos: Schema.Array(TodoRecord),
}) {}
