/**
 * Pure helpers for the Lab's Queue mode (#83): the former `TodosPanel`'s
 * display logic, extracted so it's unit-testable without React -- same
 * `labOrder.ts` pattern this file sits next to.
 *
 * `isDone` mirrors `TodosPanel.tsx`'s original helper verbatim (a todo
 * reads as "done" only for the `"done"` status; `"wont-do"` gets its own
 * strikethrough treatment inline in the row, not folded into this check).
 *
 * `filterTodosByBundle` is Queue's bundle filter: Bench's per-row
 * "N open" signal links into Queue via `?bundle=<slug>` (`labHref`), and
 * this is the pure filter that link's query param drives. `undefined`
 * (no filter) returns the list unchanged -- Queue's default is the whole
 * workspace's work, per the issue.
 */
import type { TodoRecord, TodoStatus } from "./schemas.ts";

export const isDone = (status: TodoStatus): boolean => status === "done";

export const filterTodosByBundle = (
  todos: ReadonlyArray<TodoRecord>,
  bundle: string | undefined,
): ReadonlyArray<TodoRecord> => (bundle === undefined ? todos : todos.filter((todo) => todo.bundle === bundle));
