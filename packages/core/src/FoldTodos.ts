/**
 * The todo journal fold (data-model.md §2.9, §2.10): pure, total replay of
 * `todo.*` events into current todo state. Mirrors `Fold.ts`'s shape for
 * bundles -- no I/O, never rejects an event, unrelated event types are
 * ignored.
 *
 * `swept` is deliberately NOT computed here: it depends on wall-clock
 * "now", which would make this fold impure. `isSwept` is exported
 * separately and takes `now` as an explicit parameter -- callers (the index
 * rebuild, the CLI, the server) decide when to evaluate it.
 */
import type { JournalEvent } from "./Journal.ts";
import { Todo, type TodoKind, type TodoStatus } from "./Todo.ts";

/** Terminal statuses: "done" and "wont-do" (data-model.md §2.10). */
const TERMINAL_STATUSES: ReadonlySet<TodoStatus> = new Set(["done", "wont-do"]);

export const isTerminalStatus = (status: TodoStatus): boolean => TERMINAL_STATUSES.has(status);

/** Default priorities by kind (data-model.md §2.10): lower = more urgent. */
export const DEFAULT_PRIORITY_BY_KIND: Readonly<Record<TodoKind, number>> = {
  bug: 10,
  eval: 15,
  improvement: 20,
  task: 30,
};

/** [inherited window]: terminal + swept once `terminalAt` is this many days old. */
export const SWEEP_WINDOW_DAYS = 7;

/** The `YYYY-MM-DD` portion of an ISO timestamp, for `terminalAt` stamping. */
export const isoDateOnly = (isoTimestamp: string): string => isoTimestamp.slice(0, 10);

/**
 * Folds an ordered list of journal events into current todo state
 * (data-model.md §2.10). Pure and total: unknown/irrelevant event types are
 * ignored; a `todo.updated`/`todo.status_changed` for an id with no prior
 * `todo.opened` is ignored (tolerant fold, mirroring `foldBundleStates`).
 *
 * Per-event semantics:
 *  - `todo.opened`: sets the full record verbatim.
 *  - `todo.updated`: applies a shallow patch of MUTABLE fields only (title,
 *    detail, checklist, priority, bundle, pinned). `id`/`kind`/`created`/
 *    `source` are immutable and are not representable in `TodoPatch` at
 *    all, so there is nothing to reject here -- the schema already
 *    reject-by-ignores them at decode time.
 *  - `todo.status_changed`: sets `status`; stamps `terminalAt` (the
 *    event's `at` date, `YYYY-MM-DD`) on entering a terminal status,
 *    preserves it terminal -> terminal, clears it on reopen
 *    (terminal -> open|in-progress).
 */
export const foldTodos = (events: ReadonlyArray<JournalEvent>): ReadonlyMap<string, Todo> => {
  const todos = new Map<string, Todo>();

  for (const event of events) {
    switch (event.type) {
      case "todo.opened": {
        todos.set(event.payload.todo.id, event.payload.todo);
        break;
      }
      case "todo.updated": {
        const current = todos.get(event.payload.id);
        if (current === undefined) {
          break;
        }
        const { patch } = event.payload;
        todos.set(
          current.id,
          Todo.make({
            ...current,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
            ...(patch.checklist !== undefined ? { checklist: patch.checklist } : {}),
            ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
            ...(patch.bundle !== undefined ? { bundle: patch.bundle } : {}),
            ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
          }),
        );
        break;
      }
      case "todo.status_changed": {
        const current = todos.get(event.payload.id);
        if (current === undefined) {
          break;
        }
        const { to } = event.payload;
        const wasTerminal = isTerminalStatus(current.status);
        const willBeTerminal = isTerminalStatus(to);

        // Entering terminal: stamp. Terminal -> terminal: preserve as-is.
        // Reopen (terminal -> open|in-progress): clear.
        const terminalAt = willBeTerminal
          ? wasTerminal
            ? current.terminalAt
            : isoDateOnly(event.at)
          : undefined;

        // Build explicitly rather than spreading `...current` first: when
        // reopening, `terminalAt` must be cleared, not merely left
        // unmentioned (an omitted spread key inherits the old value).
        const { terminalAt: _droppedTerminalAt, ...currentWithoutTerminalAt } = current;
        todos.set(
          current.id,
          Todo.make({
            ...currentWithoutTerminalAt,
            status: to,
            ...(terminalAt !== undefined ? { terminalAt } : {}),
          }),
        );
        break;
      }
      default:
        // bundle.*, skill.*, run.*, station.started, review.*: no effect.
        break;
    }
  }

  return todos;
};

/**
 * `swept` (data-model.md §2.10): derived, never stored in the journal.
 * True when the todo is terminal, has a `terminalAt` at least
 * `SWEEP_WINDOW_DAYS` days before `now`, and is not pinned.
 */
export const isSwept = (todo: Todo, now: Date): boolean => {
  if (!isTerminalStatus(todo.status)) {
    return false;
  }
  if (todo.terminalAt === undefined) {
    return false;
  }
  if (todo.pinned === true) {
    return false;
  }
  const terminalAtMs = Date.parse(`${todo.terminalAt}T00:00:00.000Z`);
  if (Number.isNaN(terminalAtMs)) {
    return false;
  }
  const ageDays = (now.getTime() - terminalAtMs) / (24 * 60 * 60 * 1000);
  return ageDays >= SWEEP_WINDOW_DAYS;
};

/**
 * Sort order (data-model.md §2.10, [inherited]): priority ascending
 * (lower = more urgent), then created ascending, then id ascending --
 * total and stable.
 */
export const compareTodos = (a: Todo, b: Todo): number => {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.created !== b.created) {
    return a.created < b.created ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
};
