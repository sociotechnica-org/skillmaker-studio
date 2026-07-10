/**
 * The journal — `.skillmaker/events.jsonl` (data-model.md §2.9).
 * Append-only, schema-versioned, git-tracked shared history. The journal
 * stays thin — ids and decisions, no fat content; file edits to
 * sources/outputs are not journaled (git is their history).
 */
import { Schema } from "effect";
import { Actor } from "./Actor.ts";
import { BundleStage } from "./Bundle.ts";
import { RunKind, RunRecord, RunStatus } from "./Run.ts";
import { Todo, TodoPatch, TodoStatus } from "./Todo.ts";

/**
 * Fields shared by every journal event. Spread into each event variant's
 * struct rather than expressed as a wrapper, so `type` stays a per-variant
 * literal and the union stays flat and decodable by discriminant.
 */
const envelopeFields = {
  schemaVersion: Schema.Literal(1),
  /** UUID for this event. */
  id: Schema.String.check(Schema.isUUID()),
  /** ISO timestamp. */
  at: Schema.String,
  actor: Actor,
  idempotencyKey: Schema.optionalKey(Schema.String),
};

// ---------------------------------------------------------------------------
// bundle.*
// ---------------------------------------------------------------------------

/** Fired by `skillmaker new`. */
export class BundleCreatedEvent extends Schema.Class<BundleCreatedEvent>(
  "BundleCreatedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("bundle.created"),
  payload: Schema.Struct({ bundle: Schema.String }),
}) {}

/**
 * The state-machine transition (data-model.md §2.13); guards are checked at
 * append time, not encoded in the schema.
 */
export class BundleStageChangedEvent extends Schema.Class<BundleStageChangedEvent>(
  "BundleStageChangedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("bundle.stage_changed"),
  payload: Schema.Struct({
    bundle: Schema.String,
    from: BundleStage,
    to: BundleStage,
    reason: Schema.optionalKey(Schema.String),
    override: Schema.optionalKey(Schema.Boolean),
  }),
}) {}

export class BundleGateDecidedEvent extends Schema.Class<BundleGateDecidedEvent>(
  "BundleGateDecidedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("bundle.gate_decided"),
  payload: Schema.Struct({
    bundle: Schema.String,
    /** One publish gate (ruling C). */
    gate: Schema.Literal("publish"),
    decision: Schema.Literals(["approved", "declined"]),
    /** Free-text evidence summary shown in history. */
    basis: Schema.String,
  }),
}) {}

/** Off the active board. */
export class BundleArchivedEvent extends Schema.Class<BundleArchivedEvent>(
  "BundleArchivedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("bundle.archived"),
  payload: Schema.Struct({ bundle: Schema.String }),
}) {}

/** Back on the active board. */
export class BundleRestoredEvent extends Schema.Class<BundleRestoredEvent>(
  "BundleRestoredEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("bundle.restored"),
  payload: Schema.Struct({ bundle: Schema.String }),
}) {}

// ---------------------------------------------------------------------------
// skill.*
// ---------------------------------------------------------------------------

export class SkillVersionRecordedEvent extends Schema.Class<SkillVersionRecordedEvent>(
  "SkillVersionRecordedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("skill.version_recorded"),
  payload: Schema.Struct({
    bundle: Schema.String,
    /** Output-tree content hash, e.g. "sha256:ab12...". */
    hash: Schema.String,
    /** design.md hash at record time -> drift hint. */
    designHash: Schema.String,
    /** Optional human tag, e.g. "v0.3". */
    label: Schema.optionalKey(Schema.String),
  }),
}) {}

export class SkillPublishedEvent extends Schema.Class<SkillPublishedEvent>(
  "SkillPublishedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("skill.published"),
  payload: Schema.Struct({
    bundle: Schema.String,
    versionHash: Schema.String,
    /** Publish-target id from skillmaker.config.json. */
    target: Schema.String,
    url: Schema.optionalKey(Schema.String),
  }),
}) {}

// ---------------------------------------------------------------------------
// todo.*
// ---------------------------------------------------------------------------

/** Carries the full todo record. */
export class TodoOpenedEvent extends Schema.Class<TodoOpenedEvent>("TodoOpenedEvent")({
  ...envelopeFields,
  type: Schema.Literal("todo.opened"),
  payload: Schema.Struct({ todo: Todo }),
}) {}

/** Shallow patch of mutable fields. */
export class TodoUpdatedEvent extends Schema.Class<TodoUpdatedEvent>("TodoUpdatedEvent")({
  ...envelopeFields,
  type: Schema.Literal("todo.updated"),
  payload: Schema.Struct({ id: Schema.String, patch: TodoPatch }),
}) {}

/** Terminal stamping (terminalAt) is derived at replay. */
export class TodoStatusChangedEvent extends Schema.Class<TodoStatusChangedEvent>(
  "TodoStatusChangedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("todo.status_changed"),
  payload: Schema.Struct({
    id: Schema.String,
    from: TodoStatus,
    to: TodoStatus,
  }),
}) {}

// ---------------------------------------------------------------------------
// run.*
// ---------------------------------------------------------------------------

/** Mirrors run.json (minus end fields) for replay-completeness. */
export class RunStartedEvent extends Schema.Class<RunStartedEvent>("RunStartedEvent")({
  ...envelopeFields,
  type: Schema.Literal("run.started"),
  payload: Schema.Struct({ run: RunRecord }),
}) {}

export class RunCompletedEvent extends Schema.Class<RunCompletedEvent>(
  "RunCompletedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("run.completed"),
  payload: Schema.Struct({
    id: Schema.String,
    status: RunStatus,
    endedAt: Schema.String,
  }),
}) {}

export const RunVerdict = Schema.Literals(["pass", "fail", "partial"]);
export type RunVerdict = typeof RunVerdict.Type;

export class GradedCheck extends Schema.Class<GradedCheck>("GradedCheck")({
  text: Schema.String,
  pass: Schema.Boolean,
}) {}

/** Regrade = new event; latest wins, history kept. */
export class RunGradedEvent extends Schema.Class<RunGradedEvent>("RunGradedEvent")({
  ...envelopeFields,
  type: Schema.Literal("run.graded"),
  payload: Schema.Struct({
    id: Schema.String,
    verdict: RunVerdict,
    /** Mirrors case.json grading.checks as graded checkboxes. */
    checks: Schema.optionalKey(Schema.Array(GradedCheck)),
    notes: Schema.optionalKey(Schema.String),
  }),
}) {}

// ---------------------------------------------------------------------------
// station.* / review.*
// ---------------------------------------------------------------------------

/** Station work begins (data-model.md §2.13); `runId` when agent-driven. */
export class StationStartedEvent extends Schema.Class<StationStartedEvent>(
  "StationStartedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("station.started"),
  payload: Schema.Struct({
    bundle: Schema.String,
    state: BundleStage,
    runId: Schema.optionalKey(Schema.String),
  }),
}) {}

/**
 * Agent ends its turn; bundle enters `awaiting-review` [inherited:
 * non-blocking pair].
 */
export class ReviewRequestedEvent extends Schema.Class<ReviewRequestedEvent>(
  "ReviewRequestedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("review.requested"),
  payload: Schema.Struct({
    bundle: Schema.String,
    state: BundleStage,
    artifacts: Schema.optionalKey(Schema.Array(Schema.String)),
    question: Schema.optionalKey(Schema.String),
  }),
}) {}

/**
 * `approve` satisfies the forward guard; `revise` notes become the agent's
 * next instruction.
 */
export class ReviewResolvedEvent extends Schema.Class<ReviewResolvedEvent>(
  "ReviewResolvedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("review.resolved"),
  payload: Schema.Struct({
    bundle: Schema.String,
    state: BundleStage,
    decision: Schema.Literals(["approve", "revise"]),
    notes: Schema.optionalKey(Schema.String),
  }),
}) {}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

/**
 * The v1 event catalog as a discriminated union on `type` (data-model.md
 * §2.9). Writes go only through the CLI/server, never freehand.
 */
export const JournalEvent = Schema.Union([
  BundleCreatedEvent,
  BundleStageChangedEvent,
  BundleGateDecidedEvent,
  BundleArchivedEvent,
  BundleRestoredEvent,
  SkillVersionRecordedEvent,
  SkillPublishedEvent,
  TodoOpenedEvent,
  TodoUpdatedEvent,
  TodoStatusChangedEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunGradedEvent,
  StationStartedEvent,
  ReviewRequestedEvent,
  ReviewResolvedEvent,
]);

export type JournalEvent = typeof JournalEvent.Type;
export type JournalEventType = JournalEvent["type"];

/** Distributes `Omit` over a union so each member keeps its own discriminant. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * What a caller supplies to `Journal.append` — everything except the fields
 * the journal itself generates (`id`, `at`, `schemaVersion`).
 */
export type JournalEventInput = DistributiveOmit<JournalEvent, "id" | "at" | "schemaVersion">;

/** Re-exported for convenience: the shape of a not-yet-enveloped event input. */
export type { RunKind };
