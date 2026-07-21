/**
 * `skillmaker todo add <title> --from-report <event-id>` (issue #81, `Vision
 * - Board Lab Ship Receive.md`: "Receive produces signal -> signal becomes
 * Lab work"). Opens a todo whose defaults -- `bundle`, `kind`, `detail` --
 * are read off a `skill.field_report` event, with `origin: {kind:
 * "field-report", eventId}` stamped so the provenance survives forever
 * (immutable, same house rule as `source` -- `Todo.ts`'s `TodoOrigin`).
 *
 * Mirrors `Harvest.ts`'s core-function-plus-thin-CLI layering and its
 * honest-failure shape (unknown event id, wrong event type, bundle
 * disagreement) -- this is the todo-side equivalent of `harvestFixture`,
 * except what it "writes" is a journal event (`todo.opened`), not a file:
 * todos stay journal-native (`FoldTodos.ts`'s rule), so this appends exactly
 * like a plain `todo add` does, just with report-derived defaults.
 */
import { Effect } from "effect";
import type { Actor } from "./Actor.ts";
import {
  TodoFromIntakeNotFoundError,
  TodoFromReportBundleMismatchError,
  TodoFromReportEventNotFoundError,
  TodoFromReportNotFieldReportError,
  TodoFromRunBundleMismatchError,
  TodoFromRunNotFoundError,
} from "./Errors.ts";
import { DEFAULT_PRIORITY_BY_KIND } from "./FoldTodos.ts";
import type { FieldReportOutcome, SkillReceivedEvent } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { findReceivedEvent } from "./Receive.ts";
import type { RunRecord } from "./Run.ts";
import type { Todo, TodoKind } from "./Todo.ts";
import { shortHash } from "./Versions.ts";

/**
 * `skill.field_report.outcome` -> the todo `kind` opened from it (issue
 * #81): `failed` is a bug, `surprise` is worth an eval (something the
 * fixture suite didn't cover), `worked` is just a task. Overridable via
 * `--kind`, same as every other default this module computes.
 */
export const TODO_KIND_BY_OUTCOME: Readonly<Record<FieldReportOutcome, TodoKind>> = {
  failed: "bug",
  surprise: "eval",
  worked: "task",
};

export interface OpenTodoFromReportInput {
  readonly title: string;
  /** The `skill.field_report` event id, `--from-report`'s value. */
  readonly eventId: string;
  readonly actor: Actor;
  readonly id: string;
  readonly created: string;
  /** `--bundle`, when the caller gave one explicitly -- errors if it disagrees with the report's own bundle. */
  readonly bundle?: string;
  readonly kind?: TodoKind;
  readonly detail?: string;
  readonly priority?: number;
  readonly pinned?: boolean;
}

export interface OpenTodoFromReportResult {
  readonly todo: Todo;
}

/** `detail`'s default (issue #81): the report's prose verbatim, plus destination/version lines when the report carries them. */
const defaultDetail = (payload: {
  readonly report: string;
  readonly destination?: string;
  readonly versionHash?: string;
}): string => {
  const lines = [payload.report];
  if (payload.destination !== undefined) {
    lines.push(`Destination: ${payload.destination}`);
  }
  if (payload.versionHash !== undefined) {
    lines.push(`Version: ${shortHash(payload.versionHash)}`);
  }
  return lines.join("\n");
};

/**
 * Resolves `eventId` against the full journal (unknown id ->
 * `TodoFromReportEventNotFoundError`; not a `skill.field_report` ->
 * `TodoFromReportNotFieldReportError`; an explicit `bundle` that disagrees
 * with the report's own -> `TodoFromReportBundleMismatchError`), computes
 * `bundle`/`kind`/`detail` defaults (all overridable), stamps
 * `origin: {kind: "field-report", eventId}`, and appends `todo.opened`
 * -- the same event a plain `todo add` appends, just with these defaults
 * and the provenance stamp.
 */
export const openTodoFromReport = Effect.fn("TodoFromReport.openTodoFromReport")(function* (
  input: OpenTodoFromReportInput,
) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const event = events.find((candidate) => candidate.id === input.eventId);
  if (event === undefined) {
    return yield* Effect.fail(TodoFromReportEventNotFoundError.make({ eventId: input.eventId }));
  }
  if (event.type !== "skill.field_report") {
    return yield* Effect.fail(
      TodoFromReportNotFieldReportError.make({ eventId: input.eventId, eventType: event.type }),
    );
  }
  if (input.bundle !== undefined && input.bundle !== event.payload.bundle) {
    return yield* Effect.fail(
      TodoFromReportBundleMismatchError.make({
        eventId: input.eventId,
        bundle: input.bundle,
        reportBundle: event.payload.bundle,
      }),
    );
  }

  const bundle = input.bundle ?? event.payload.bundle;
  const kind = input.kind ?? TODO_KIND_BY_OUTCOME[event.payload.outcome];
  const priority = input.priority ?? DEFAULT_PRIORITY_BY_KIND[kind];
  const detail = input.detail ?? defaultDetail(event.payload);

  const todo = {
    id: input.id,
    kind,
    status: "open" as const,
    title: input.title,
    detail,
    priority,
    bundle,
    created: input.created,
    ...(input.pinned === true ? { pinned: true } : {}),
    source: input.actor,
    origin: { kind: "field-report" as const, eventId: input.eventId },
  };

  yield* journal.append({ type: "todo.opened", actor: input.actor, payload: { todo } });

  const result: OpenTodoFromReportResult = { todo };
  return result;
});

// ---------------------------------------------------------------------------
// todo add --from-intake (issue #91, the dock's salvage door)
// ---------------------------------------------------------------------------

export interface OpenTodoFromIntakeInput {
  readonly title: string;
  /** The `skill.received` event's intake id, `--from-intake`'s value. */
  readonly intake: string;
  readonly actor: Actor;
  readonly id: string;
  readonly created: string;
  /** Unlike `openTodoFromReport`, there is no bundle to default from -- a crate carries no identity until routed; `--bundle` names the bundle a salvaged intake's work order belongs to, when there is one. */
  readonly bundle?: string;
  readonly kind?: TodoKind;
  readonly detail?: string;
  readonly priority?: number;
  readonly pinned?: boolean;
}

export interface OpenTodoFromIntakeResult {
  readonly todo: Todo;
}

/** `detail`'s default (issue #91): the crate's recorded testimony/source/claim, the closest analogue to a field report's prose a `skill.received` event carries. Structured `stakes`/`hurts` (issue #108) surface first when present; an old crate's flattened `notes` prose still shows verbatim, never re-parsed. */
const defaultIntakeDetail = (payload: SkillReceivedEvent["payload"]): string => {
  // Stakes before hurts -- the same order the dock's elicitation tree asks
  // them in and every other surface renders them (the manifest columns,
  // Receive's crate rows, Track's salvaged rows).
  const testimony: string[] = [];
  if (payload.stakes !== undefined) {
    testimony.push(`Stakes: ${payload.stakes}`);
  }
  if (payload.hurts !== undefined) {
    testimony.push(`Hurts: ${payload.hurts}`);
  }
  if (payload.notes !== undefined) {
    testimony.push(payload.notes);
  }
  const lines = [testimony.length > 0 ? testimony.join("\n") : "(no notes recorded at intake)"];
  lines.push(`Source: ${payload.source}`);
  if (payload.claimedName !== undefined) {
    lines.push(`Claimed name: ${payload.claimedName}`);
  }
  return lines.join("\n");
};

/**
 * Resolves `intake` against the full journal (unknown id ->
 * `TodoFromIntakeNotFoundError`), computes `kind`/`detail`/`priority`
 * defaults (all overridable, mirroring `openTodoFromReport`), stamps
 * `origin: {kind: "intake", intakeId: intake}`, and appends `todo.opened` --
 * salvage's "work order into todos" door (`Mechanism - Receiving Dock.md`
 * §HOW). `kind` defaults to `"task"` (a crate carries no `outcome` signal
 * like a field report's `worked`/`failed`/`surprise` to key off of) --
 * `--kind` overrides as usual.
 */
export const openTodoFromIntake = Effect.fn("TodoFromReport.openTodoFromIntake")(function* (
  input: OpenTodoFromIntakeInput,
) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const received = findReceivedEvent(events, input.intake);
  if (received === undefined) {
    return yield* Effect.fail(TodoFromIntakeNotFoundError.make({ intake: input.intake }));
  }

  const kind = input.kind ?? "task";
  const priority = input.priority ?? DEFAULT_PRIORITY_BY_KIND[kind];
  const detail = input.detail ?? defaultIntakeDetail(received.payload);

  const todo = {
    id: input.id,
    kind,
    status: "open" as const,
    title: input.title,
    detail,
    priority,
    ...(input.bundle !== undefined ? { bundle: input.bundle } : {}),
    created: input.created,
    ...(input.pinned === true ? { pinned: true } : {}),
    source: input.actor,
    origin: { kind: "intake" as const, intakeId: input.intake },
  };

  yield* journal.append({ type: "todo.opened", actor: input.actor, payload: { todo } });

  const result: OpenTodoFromIntakeResult = { todo };
  return result;
});

// ---------------------------------------------------------------------------
// todo add --from-run (2026-07-21 simplification, D5: run findings become work)
// ---------------------------------------------------------------------------

export interface OpenTodoFromRunInput {
  readonly title: string;
  /** The run's id (`run.json.id`), `--from-run`'s value. */
  readonly runId: string;
  readonly actor: Actor;
  readonly id: string;
  readonly created: string;
  /** `--bundle`, when the caller gave one explicitly -- errors if it disagrees with the run's own bundle (same rule as `openTodoFromReport`). */
  readonly bundle?: string;
  readonly kind?: TodoKind;
  readonly detail?: string;
  readonly priority?: number;
  readonly pinned?: boolean;
}

export interface OpenTodoFromRunResult {
  readonly todo: Todo;
}

/**
 * `detail`'s default: what the run was -- fixture case (or station), provider/
 * model, version under test -- so the todo names its evidence even off-screen.
 * A run carries no prose the way a field report does; the transcript under
 * `runs/<runId>/` is the testimony, and `origin` points straight at it.
 */
const defaultRunDetail = (run: RunRecord): string => {
  const what =
    run.kind === "station"
      ? `Surfaced by station run ${run.id}${run.station !== null ? ` (station ${run.station})` : ""}.`
      : `Surfaced by eval run ${run.id}${run.fixtureCase !== undefined ? ` (fixture ${run.fixtureCase})` : ""}.`;
  const lines = [what, `Provider: ${run.provider}${run.model.length > 0 && run.model !== run.provider ? ` / ${run.model}` : ""}`];
  lines.push(`Version: ${shortHash(run.skillVersionHash)}`);
  return lines.join("\n");
};

/**
 * Resolves `runId` against the journal's `run.started` events (unknown id ->
 * `TodoFromRunNotFoundError`; an explicit `bundle` that disagrees with the
 * run's own -> `TodoFromRunBundleMismatchError`), computes `bundle`/`detail`
 * defaults (all overridable), stamps `origin: {kind: "run", runId}`, and
 * appends `todo.opened` -- the third door in the "signal becomes work"
 * pattern, after field reports (#81) and intake (#91). `kind` defaults to
 * `"task"`: a run carries no `worked`/`failed`/`surprise` outcome to key off
 * of, and its grading verdict is DELIBERATELY not consulted -- verdict and
 * disposition stay orthogonal (D5's ruling: a pass can demand follow-up, a
 * fail can demand nothing).
 */
export const openTodoFromRun = Effect.fn("TodoFromReport.openTodoFromRun")(function* (
  input: OpenTodoFromRunInput,
) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const started = events.find(
    (candidate) => candidate.type === "run.started" && candidate.payload.run.id === input.runId,
  );
  if (started === undefined || started.type !== "run.started") {
    return yield* Effect.fail(TodoFromRunNotFoundError.make({ runId: input.runId }));
  }
  const run = started.payload.run;
  if (input.bundle !== undefined && input.bundle !== run.bundle) {
    return yield* Effect.fail(
      TodoFromRunBundleMismatchError.make({
        runId: input.runId,
        bundle: input.bundle,
        runBundle: run.bundle,
      }),
    );
  }

  const kind = input.kind ?? "task";
  const priority = input.priority ?? DEFAULT_PRIORITY_BY_KIND[kind];
  const detail = input.detail ?? defaultRunDetail(run);

  const todo = {
    id: input.id,
    kind,
    status: "open" as const,
    title: input.title,
    detail,
    priority,
    bundle: input.bundle ?? run.bundle,
    created: input.created,
    ...(input.pinned === true ? { pinned: true } : {}),
    source: input.actor,
    origin: { kind: "run" as const, runId: input.runId },
  };

  yield* journal.append({ type: "todo.opened", actor: input.actor, payload: { todo } });

  const result: OpenTodoFromRunResult = { todo };
  return result;
});
