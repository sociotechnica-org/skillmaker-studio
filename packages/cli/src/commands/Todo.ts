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
  Workspace,
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
}

export const runTodoAdd = Effect.fn("runTodoAdd")(function* (
  cwd: string,
  title: string | undefined,
  options: TodoAddOptions,
) {
  if (title === undefined || title.trim().length === 0) {
    return usageError(
      "skillmaker todo add: missing <title>\n\nUsage: skillmaker todo add <title> [--kind task|bug|improvement|eval] [--bundle <slug>] [--detail <text>] [--priority <n>] [--pin]\n",
    );
  }

  if (options.kind !== undefined && !isTodoKind(options.kind)) {
    return usageError(
      `skillmaker todo add: invalid --kind "${options.kind}" (expected one of ${TODO_KINDS.join(", ")})\n`,
    );
  }
  // Re-narrow here: a closure captures the *declared* type of a captured
  // variable, not a prior flow-narrowing of it (same reasoning as
  // Advance.ts's `backStage`/`toStage`).
  const kind: TodoKind = options.kind !== undefined && isTodoKind(options.kind) ? options.kind : "task";

  let priority = DEFAULT_PRIORITY_BY_KIND[kind];
  if (options.priority !== undefined) {
    const parsed = Number.parseInt(options.priority, 10);
    if (Number.isNaN(parsed)) {
      return usageError(`skillmaker todo add: invalid --priority "${options.priority}"\n`);
    }
    priority = parsed;
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

  const status: TodoStatus = "open";
  const todo = {
    id,
    kind,
    status,
    title: title.trim(),
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    priority,
    ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
    created: todayIsoDate(),
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
        includeArchived: options.all,
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
