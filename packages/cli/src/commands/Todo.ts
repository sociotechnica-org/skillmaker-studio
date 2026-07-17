/**
 * `skillmaker todo add|list|done|start|drop|reopen` — the baked-in tracking
 * system (data-model.md §2.9, §2.10; plan.md Phase 5). `add` appends
 * `todo.opened` with the full record; `done`/`start`/`drop`/`reopen` append
 * `todo.status_changed` with the correct folded `from`; `list` reads the
 * rebuilt index (`IndexService.listTodos`).
 */
import {
  DEFAULT_PRIORITY_BY_KIND,
  foldTodos,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  openTodoFromIntake,
  openTodoFromReport,
  Workspace,
  type OpenTodoFromIntakeResult,
  type OpenTodoFromReportResult,
  type TodoKind,
  type TodoRecord,
  type TodoStatus,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

const TODO_KINDS: ReadonlyArray<TodoKind> = ["task", "bug", "improvement", "eval"];

const isTodoKind = (value: string): value is TodoKind =>
  (TODO_KINDS as ReadonlyArray<string>).includes(value);

/** Today's date as YYYY-MM-DD (matches `WorkspaceService`'s `bundle.json.created` convention). */
const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// todo add
// ---------------------------------------------------------------------------

export interface TodoAddOptions {
  readonly json: boolean;
  readonly kind?: string;
  readonly bundle?: string;
  readonly detail?: string;
  readonly priority?: string;
  readonly pin: boolean;
  /** `--from-report <event-id>` (issue #81): opens the todo with bundle/kind/detail defaulted from the named `skill.field_report`. */
  readonly fromReport?: string;
  /** `--from-intake <intake-id>` (issue #91): opens the todo with kind/detail defaulted from the named `skill.received` crate -- the dock's salvage door's "work order into todos." */
  readonly fromIntake?: string;
}

const TODO_ADD_USAGE =
  "Usage: skillmaker todo add <title> [--kind task|bug|improvement|eval] [--bundle <slug>] [--detail <text>] [--priority <n>] [--pin] [--from-report <event-id> | --from-intake <intake-id>]\n";

export const runTodoAdd = Effect.fn("runTodoAdd")(function* (
  cwd: string,
  title: string | undefined,
  options: TodoAddOptions,
) {
  if (title === undefined || title.trim().length === 0) {
    return usageError(`skillmaker todo add: missing <title>\n\n${TODO_ADD_USAGE}`);
  }

  const hasFromReport = options.fromReport !== undefined && options.fromReport.trim().length > 0;
  const hasFromIntake = options.fromIntake !== undefined && options.fromIntake.trim().length > 0;
  if (hasFromReport && hasFromIntake) {
    return usageError(`skillmaker todo add: pass either --from-report or --from-intake, not both\n\n${TODO_ADD_USAGE}`);
  }

  if (options.kind !== undefined && !isTodoKind(options.kind)) {
    return usageError(
      `skillmaker todo add: invalid --kind "${options.kind}" (expected one of ${TODO_KINDS.join(", ")})\n`,
    );
  }
  // Re-narrow here: a closure captures the *declared* type of a captured
  // variable, not a prior flow-narrowing of it (same reasoning as
  // Advance.ts's `backStage`/`toStage`).
  const explicitKind: TodoKind | undefined =
    options.kind !== undefined && isTodoKind(options.kind) ? options.kind : undefined;

  let explicitPriority: number | undefined;
  if (options.priority !== undefined) {
    const parsed = Number.parseInt(options.priority, 10);
    if (Number.isNaN(parsed)) {
      return usageError(`skillmaker todo add: invalid --priority "${options.priority}"\n`);
    }
    explicitPriority = parsed;
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker todo add: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();
  const id = `td-${crypto.randomUUID()}`;
  const created = todayIsoDate();
  const trimmedTitle = title.trim();

  if (options.fromReport !== undefined && options.fromReport.trim().length > 0) {
    const eventId = options.fromReport.trim();

    const outcome = yield* openTodoFromReport({
      title: trimmedTitle,
      eventId,
      actor,
      id,
      created,
      ...(explicitKind !== undefined ? { kind: explicitKind } : {}),
      ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
      ...(options.detail !== undefined ? { detail: options.detail } : {}),
      ...(explicitPriority !== undefined ? { priority: explicitPriority } : {}),
      ...(options.pin ? { pinned: true } : {}),
    }).pipe(
      Effect.provide(JournalLayer(journalPath)),
      Effect.map((result) => ({ kind: "ok" as const, result })),
      Effect.catchTag("TodoFromReportEventNotFoundError", (error) =>
        Effect.succeed({ kind: "event_not_found" as const, eventId: error.eventId }),
      ),
      Effect.catchTag("TodoFromReportNotFieldReportError", (error) =>
        Effect.succeed({
          kind: "not_field_report" as const,
          eventId: error.eventId,
          eventType: error.eventType,
        }),
      ),
      Effect.catchTag("TodoFromReportBundleMismatchError", (error) =>
        Effect.succeed({
          kind: "bundle_mismatch" as const,
          eventId: error.eventId,
          bundle: error.bundle,
          reportBundle: error.reportBundle,
        }),
      ),
    );

    if (outcome.kind === "event_not_found") {
      return expectedFailure(`skillmaker todo add: no such event "${outcome.eventId}"\n`);
    }
    if (outcome.kind === "not_field_report") {
      return expectedFailure(
        `skillmaker todo add: event "${outcome.eventId}" is a "${outcome.eventType}" event, not a skill.field_report\n`,
      );
    }
    if (outcome.kind === "bundle_mismatch") {
      return expectedFailure(
        `skillmaker todo add: --bundle "${outcome.bundle}" disagrees with report "${outcome.eventId}"'s bundle "${outcome.reportBundle}"\n`,
      );
    }

    return summarizeFromReport(outcome.result, eventId, options.json);
  }

  if (hasFromIntake) {
    const intake = (options.fromIntake as string).trim();

    const outcome = yield* openTodoFromIntake({
      title: trimmedTitle,
      intake,
      actor,
      id,
      created,
      ...(explicitKind !== undefined ? { kind: explicitKind } : {}),
      ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
      ...(options.detail !== undefined ? { detail: options.detail } : {}),
      ...(explicitPriority !== undefined ? { priority: explicitPriority } : {}),
      ...(options.pin ? { pinned: true } : {}),
    }).pipe(
      Effect.provide(JournalLayer(journalPath)),
      Effect.map((result) => ({ kind: "ok" as const, result })),
      Effect.catchTag("TodoFromIntakeNotFoundError", (error) =>
        Effect.succeed({ kind: "intake_not_found" as const, intake: error.intake }),
      ),
    );

    if (outcome.kind === "intake_not_found") {
      return expectedFailure(`skillmaker todo add: no such intake "${outcome.intake}"\n`);
    }

    return summarizeFromIntake(outcome.result, intake, options.json);
  }

  const kind: TodoKind = explicitKind ?? "task";
  const priority = explicitPriority ?? DEFAULT_PRIORITY_BY_KIND[kind];

  const status: TodoStatus = "open";
  const todo = {
    id,
    kind,
    status,
    title: trimmedTitle,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    priority,
    ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
    created,
    ...(options.pin ? { pinned: true } : {}),
    source: actor,
  };

  yield* Effect.gen(function* () {
    const journal = yield* Journal;
    yield* journal.append({
      type: "todo.opened",
      actor,
      payload: { todo },
    });
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  if (options.json) {
    return ok(`${JSON.stringify({ status: "opened", id, todo })}\n`);
  }
  return ok(`skillmaker: opened todo ${id} — ${todo.title}\n`);
});

const summarizeFromReport = (result: OpenTodoFromReportResult, eventId: string, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "opened", id: result.todo.id, todo: result.todo })}\n`);
  }
  return ok(
    `skillmaker: opened todo ${result.todo.id} — ${result.todo.title} (from field report ${eventId})\n`,
  );
};

const summarizeFromIntake = (result: OpenTodoFromIntakeResult, intake: string, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "opened", id: result.todo.id, todo: result.todo })}\n`);
  }
  return ok(`skillmaker: opened todo ${result.todo.id} — ${result.todo.title} (from intake ${intake})\n`);
};

// ---------------------------------------------------------------------------
// todo list
// ---------------------------------------------------------------------------

export interface TodoListOptions {
  readonly json: boolean;
  readonly bundle?: string;
  readonly all: boolean;
}

export const runTodoList = Effect.fn("runTodoList")(function* (
  cwd: string,
  options: TodoListOptions,
) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker todo list: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listTodos({
        ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
        includeSwept: options.all,
      });
    }).pipe(Effect.provide(IndexServiceLayer(resolved.root))),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker todo list: ${outcome.failure.message}\n`);
  }

  return summarizeList(outcome.success, options.json);
});

const summarizeList = (todos: ReadonlyArray<TodoRecord>, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ todos })}\n`);
  }

  if (todos.length === 0) {
    return ok("skillmaker: no todos yet (run `skillmaker todo add <title>`)\n");
  }

  const rows = todos.map((todo) => ({
    id: todo.id,
    kind: todo.kind,
    status: todo.status,
    priority: String(todo.priority),
    title: todo.bundle !== undefined ? `${todo.title} (${todo.bundle})` : todo.title,
  }));

  const idWidth = Math.max("ID".length, ...rows.map((row) => row.id.length));
  const kindWidth = Math.max("KIND".length, ...rows.map((row) => row.kind.length));
  const statusWidth = Math.max("STATUS".length, ...rows.map((row) => row.status.length));
  const prioWidth = Math.max("PRIO".length, ...rows.map((row) => row.priority.length));

  const header = `${"ID".padEnd(idWidth)}  ${"KIND".padEnd(kindWidth)}  ${"STATUS".padEnd(statusWidth)}  ${"PRIO".padEnd(prioWidth)}  TITLE`;
  const lines = rows.map(
    (row) =>
      `${row.id.padEnd(idWidth)}  ${row.kind.padEnd(kindWidth)}  ${row.status.padEnd(statusWidth)}  ${row.priority.padEnd(prioWidth)}  ${row.title}`,
  );

  return ok(`${[header, ...lines].join("\n")}\n`);
};

// ---------------------------------------------------------------------------
// todo done / start / drop / reopen
// ---------------------------------------------------------------------------

export type TodoStatusCommand = "done" | "start" | "drop" | "reopen";

const TARGET_STATUS: Readonly<Record<TodoStatusCommand, TodoStatus>> = {
  done: "done",
  start: "in-progress",
  drop: "wont-do",
  reopen: "open",
};

export interface TodoStatusOptions {
  readonly json: boolean;
}

export const runTodoStatus = Effect.fn("runTodoStatus")(function* (
  cwd: string,
  command: TodoStatusCommand,
  id: string | undefined,
  options: TodoStatusOptions,
) {
  if (id === undefined) {
    return usageError(`skillmaker todo ${command}: missing <id>\n\nUsage: skillmaker todo ${command} <id>\n`);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      `skillmaker todo ${command}: no skillmaker workspace found (run \`skillmaker init\` first)\n`,
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();
  const to = TARGET_STATUS[command];

  const outcome:
    | { readonly kind: "not_found" }
    | { readonly kind: "noop"; readonly status: TodoStatus }
    | { readonly kind: "changed"; readonly from: TodoStatus; readonly to: TodoStatus } = yield* Effect.gen(
    function* () {
      const journal = yield* Journal;
      const events = yield* journal.readAll();
      const todos = foldTodos(events);
      const current = todos.get(id);

      if (current === undefined) {
        return { kind: "not_found" as const };
      }
      if (current.status === to) {
        return { kind: "noop" as const, status: current.status };
      }

      yield* journal.append({
        type: "todo.status_changed",
        actor,
        payload: { id, from: current.status, to },
      });

      return { kind: "changed" as const, from: current.status, to };
    },
  ).pipe(Effect.provide(JournalLayer(journalPath)));

  if (outcome.kind === "not_found") {
    return expectedFailure(`skillmaker todo ${command}: no such todo "${id}"\n`);
  }

  if (outcome.kind === "noop") {
    if (options.json) {
      return ok(`${JSON.stringify({ status: "noop", id, current: outcome.status })}\n`);
    }
    return ok(`skillmaker: todo ${id} is already "${outcome.status}"\n`);
  }

  if (options.json) {
    return ok(`${JSON.stringify({ status: "changed", id, from: outcome.from, to: outcome.to })}\n`);
  }
  return ok(`skillmaker: todo ${id} moved from "${outcome.from}" to "${outcome.to}"\n`);
});
