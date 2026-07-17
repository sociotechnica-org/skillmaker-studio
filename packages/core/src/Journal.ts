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

/**
 * One measurement cell as it stood at ship time (Ship.ts, `computeMeasurements`
 * -- `Measurements.ts:150-220`). Deliberately a narrower shape than
 * `MeasurementRecord`: no `bundle`/`versionHash`, since both are already the
 * enclosing `SkillShippedEvent`'s own fields, so restating them per-cell
 * would just be redundant journal bytes for data the envelope already
 * carries.
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
 * The outbound half of the checkout/return primitive (`Vision - Board Lab
 * Port.md` §HOW, issue #66): a specific recorded version of a bundle left
 * for a destination and purpose, with its measurement receipts snapshotted
 * at ship time. Measurements are computed-at-read and move as runs land --
 * the snapshot IS the point: it is what the skill *shipped as*, not what it
 * measures as today. Deliberately carries no `idempotencyKey` (unlike
 * `SkillPublishedEvent`): re-shipping the same version to the same
 * destination is a real, distinct event, not a duplicate to be collapsed.
 * No `bundleForEvent`-adjacent board-state effect either -- shipping is not
 * a stage change (`Fold.ts`'s `foldBundleStates` is untouched).
 */
export class SkillShippedEvent extends Schema.Class<SkillShippedEvent>(
  "SkillShippedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("skill.shipped"),
  payload: Schema.Struct({
    bundle: Schema.String,
    versionHash: Schema.String,
    /** Free-text: where the skill went (an agent, a repo, a runtime -- v1 records this as a label, not a resolvable address). */
    destination: Schema.String,
    /** Free-text: why it shipped, e.g. "eval harness for team X". */
    purpose: Schema.String,
    /** The measurement snapshot at ship time, never re-derived after the fact. */
    receipts: Schema.Array(ShipReceipt),
  }),
}) {}

/** `worked` | `failed` | `surprise` -- the reporter's own read on how a shipped version held up, not a pass/fail eval verdict. */
export const FieldReportOutcome = Schema.Literals(["worked", "failed", "surprise"]);
export type FieldReportOutcome = typeof FieldReportOutcome.Type;

/**
 * The inbound half of the checkout/return-record primitive (`Vision -
 * Board Lab Ship Receive.md` §HOW, issue #67): "a dumb inbound channel.
 * Even a manually pasted field report proves the loop closes once, by
 * hand, before automating it." `report` is free prose -- the wild is the
 * best fixture source there is ("a skill that fails in production *is* a
 * new fixture"), but turning a report into a Lab fixture is #68, not this
 * event. `versionHash`/`destination` are both optional (unlike
 * `SkillShippedEvent`'s required fields): the reporter may not know which
 * version they ran or where it shipped from -- when known, they tie the
 * report back to a `skill.shipped` record (#71), but a report with neither
 * is still a real, useful signal. No `idempotencyKey`: two reports about
 * the same bundle are two distinct pieces of signal, never a duplicate to
 * collapse. Deliberately no `bundleForEvent`-adjacent board-state effect
 * either -- a field report doesn't move a bundle's stage (`Fold.ts`'s
 * `foldBundleStates` is untouched, same house rule `SkillShippedEvent`
 * follows).
 */
export class SkillFieldReportEvent extends Schema.Class<SkillFieldReportEvent>(
  "SkillFieldReportEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("skill.field_report"),
  payload: Schema.Struct({
    bundle: Schema.String,
    outcome: FieldReportOutcome,
    /** Free-text: what the wild is saying back. */
    report: Schema.String,
    /** A recorded version's hash, when the reporter knows which version they ran. */
    versionHash: Schema.optionalKey(Schema.String),
    /** Free-text: where the report came from (an agent, a repo, a runtime), when known. */
    destination: Schema.optionalKey(Schema.String),
  }),
}) {}

/** `ours` | `licensed` | `unclear` -- recorded, never enforced (Mechanism - Receiving Dock.md §WHAT). */
export const IntakeRights = Schema.Literals(["ours", "licensed", "unclear"]);
export type IntakeRights = typeof IntakeRights.Type;

/**
 * `aside` | `load-bearing` -- the maker's usage-stakes claim (issue #108,
 * data-model draft §Receive "Testimony": "stakes (aside · load-bearing)").
 * The one canonical home of the stakes vocabulary in core: `Triage.ts`'s
 * `TRIAGE_STAKES_VALUES` derives from this schema's literals, and the
 * viewer's hand-mirrored copy is held equal by the vocab lockstep test.
 * Testimony like everything else at the dock -- recorded and flagged, never
 * enforced; a stakes claim never moves a stage and never clears the
 * Unverified badge (issue #108 acceptance criteria).
 */
export const IntakeStakes = Schema.Literals(["aside", "load-bearing"]);
export type IntakeStakes = typeof IntakeStakes.Type;

/**
 * The dock's arrival fact (issue #90, `Mechanism - Receiving Dock.md` §HOW):
 * "everything may enter; nothing may pretend." `intake` is `in-<ulid>` (the
 * `Todo.ts` `td-<ulid>` id pattern) -- deliberately NOT `bundle`: a crate has
 * no identity yet, that is the whole point of the dock existing before
 * adoption. No `bundleForEvent` effect follows from that (`Fold.ts`): the
 * Activity feed renders this event workspace-level, like nothing else does
 * today. `claimedName`/`claimedVersionHash`/`rights`/`stakes`/`hurts`/
 * `notes` are all optional testimony -- the maker's word, recorded and
 * flagged, never enforced (house law, no gate anywhere). The dock verdict this event's
 * comparison produces (`return`/`new`/`conflict`, `Receive.ts`) is
 * deliberately NOT carried in this payload: it is derived at read time from
 * the crate's live content hash and the registry as it stands *right now*,
 * never stored, same house law `Versions.ts`'s drift hint follows.
 */
export class SkillReceivedEvent extends Schema.Class<SkillReceivedEvent>(
  "SkillReceivedEvent",
)({
  ...envelopeFields,
  type: Schema.Literal("skill.received"),
  payload: Schema.Struct({
    intake: Schema.String,
    /** Free-text: where the crate came from (a maker, a repo, "unknown"). */
    source: Schema.String,
    ref: Schema.optionalKey(Schema.String),
    /** The maker's claimed name for the skill -- testimony, checked against the registry's slugs/names at verdict time, never trusted outright. */
    claimedName: Schema.optionalKey(Schema.String),
    /** A label or hash the maker claims this version is -- testimony, recorded verbatim, never resolved/validated against a recorded version by this event itself. */
    claimedVersionHash: Schema.optionalKey(Schema.String),
    rights: Schema.optionalKey(IntakeRights),
    /**
     * Structured usage-stakes testimony (issue #108, additive-optional --
     * absence = not-asked = honest gap, so events written before this field
     * existed decode unchanged with no read shim and no schemaVersion
     * bump). Before #108 this claim was flattened into `notes` as
     * `"stakes: <value>"` prose; those old events stay readable as-is and
     * are NEVER re-parsed back into structure (house law: never write a
     * notes parser -- structure the ledger didn't record can't honestly be
     * fabricated later).
     */
    stakes: Schema.optionalKey(IntakeStakes),
    /** Structured "what hurt" testimony (issue #108, additive-optional) -- the maker's free-text pain report, previously folded into `notes`. May seed a todo (`Triage.ts`'s `mintHurtsTodo`); never moves a stage, never clears the Unverified badge. */
    hurts: Schema.optionalKey(Schema.String),
    /** Genuinely free-text notes only (issue #108): stakes/hurts no longer flatten in here on new writes -- they have their own structured fields above. */
    notes: Schema.optionalKey(Schema.String),
  }),
}) {}

/**
 * The five exit doors out of the dock (issue #91, `Mechanism - Receiving
 * Dock.md` §HOW): `return` (ours, coming home -- hash matches a recorded
 * version), `new` (no overlap -- adopt into the corpus), `upgrade` (same
 * name, different content -- next version of the existing bundle), `fork`
 * (shared ancestry, diverged intent -- new bundle, provenance link to the
 * parent), `salvage` (hypothesis broken -- no identity granted, the crate
 * stays at the dock as evidence).
 */
export const RouteDisposition = Schema.Literals(["return", "new", "upgrade", "fork", "salvage"]);
export type RouteDisposition = typeof RouteDisposition.Type;

/**
 * `skill.routed` (issue #91): the `review.requested`/`review.resolved`
 * pairing applied to cargo -- an undisposed crate is a `skill.received` with
 * no `skill.routed` referencing its `intake` (`Receive.ts`'s
 * `listUndisposedCrates`). `reason` is required on every disposition, no
 * exceptions: the hypothesis (broken? evolved? forked?) IS the point, the
 * same house law backward stage moves already demand
 * (`BundleStageChangedEvent`). `bundle` is set for every disposition except
 * a `salvage` that names no existing bundle to defend -- optional at the
 * schema level for all five (a discriminated union enforcing "required
 * unless salvage-without-target" would be considerably more machinery for a
 * rule `Route.ts`'s `routeCrate` already enforces at append time, the same
 * choice `BundleStageChangedEvent.reason`'s optionality + `Machine.ts`'s
 * guard makes for backward-move reasons). No `idempotencyKey`: routing twice
 * for the same intake is guarded by `Route.ts`'s own fold-based check
 * (mirrors `Machine.ts`'s guard-reads-the-fold pattern, not
 * `Journal.append`'s generic idempotency-key comparison), so a genuine
 * conflict (a second, different disposition for an already-routed intake)
 * surfaces as `Route.ts`'s own `RouteAlreadyRoutedError`, not
 * `JournalIdempotencyConflictError`.
 */
export class SkillRoutedEvent extends Schema.Class<SkillRoutedEvent>("SkillRoutedEvent")({
  ...envelopeFields,
  type: Schema.Literal("skill.routed"),
  payload: Schema.Struct({
    intake: Schema.String,
    disposition: RouteDisposition,
    bundle: Schema.optionalKey(Schema.String),
    reason: Schema.String,
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

/**
 * Fix (Phase 20 Story 3 friction log F2): `skillmaker run repair`
 * terminal-states a "running" run whose process is gone. Appended alongside
 * the corrected `run.json` (never replaces `run.started`/`run.completed` --
 * the journal keeps the full history, same "latest wins, history kept"
 * convention as `RunGradedEvent`).
 */
export class RunRepairedEvent extends Schema.Class<RunRepairedEvent>("RunRepairedEvent")({
  ...envelopeFields,
  type: Schema.Literal("run.repaired"),
  payload: Schema.Struct({
    id: Schema.String,
    status: RunStatus,
    endedAt: Schema.String,
    reason: Schema.String,
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
  SkillShippedEvent,
  SkillFieldReportEvent,
  SkillReceivedEvent,
  SkillRoutedEvent,
  TodoOpenedEvent,
  TodoUpdatedEvent,
  TodoStatusChangedEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunGradedEvent,
  RunRepairedEvent,
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
