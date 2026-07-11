/**
 * The todos panel (plan.md Phase 5): a persistent right-side, collapsible
 * panel on the board page -- NOT bundle-scoped, visible without selecting a
 * bundle (unlike `BundlePanel`, which only renders once a bundle is
 * selected). Renders alongside `BundlePanel` when both are open; the board
 * layout stays a simple flex row of `main | BundlePanel? | TodosPanel`.
 *
 * Default view hides archived todos (terminal + >=7 days + not pinned,
 * data-model.md §2.10) -- a "show archived" toggle switches `useTodos` to
 * `?all=1`. All writes go through `POST /api/events` (data-model.md
 * §2.9/§2.10) via `runtime/api.ts`'s `postEvent`, same as `BundlePanel`.
 */
import { type FC, type FormEvent, useState } from "react";
import { postEvent } from "../runtime/api.ts";
import type { BundleRecord, TodoKind, TodoRecord, TodoStatus } from "../runtime/schemas.ts";
import { useTodos } from "../runtime/useTodos.ts";

const TODO_KINDS: ReadonlyArray<TodoKind> = ["task", "bug", "improvement", "eval"];

const KIND_CHIP_CLASS: Readonly<Record<TodoKind, string>> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  eval: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  improvement: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  task: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const isDone = (status: TodoStatus): boolean => status === "done";

export const TodosPanel: FC<{ bundles: ReadonlyArray<BundleRecord> }> = ({ bundles }) => {
  const [open, setOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const { todos, loading, error, refetch } = useTodos(showArchived);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<TodoKind>("task");
  const [newBundle, setNewBundle] = useState("");

  const toggleDone = (todo: TodoRecord): void => {
    const to: TodoStatus = isDone(todo.status) ? "open" : "done";
    setPending(todo.id);
    setActionError(undefined);
    postEvent({ type: "todo.status_changed", payload: { id: todo.id, from: todo.status, to } })
      .then((result) => {
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
        refetch();
      })
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(undefined));
  };

  const addTodo = (event: FormEvent): void => {
    event.preventDefault();
    const title = newTitle.trim();
    if (title.length === 0) {
      return;
    }
    setPending("__add__");
    setActionError(undefined);
    postEvent({
      type: "todo.opened",
      payload: {
        todo: {
          id: `td-${crypto.randomUUID()}`,
          kind: newKind,
          status: "open",
          title,
          priority: DEFAULT_PRIORITY_BY_KIND[newKind],
          ...(newBundle.length > 0 ? { bundle: newBundle } : {}),
          created: new Date().toISOString().slice(0, 10),
          source: { kind: "user", name: "viewer" },
        },
      },
    })
      .then((result) => {
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
        setNewTitle("");
        setNewBundle("");
        refetch();
      })
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(undefined));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-fit shrink-0 self-start rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:border-neutral-800 dark:hover:text-neutral-200"
      >
        Todos ▸
      </button>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Todos
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          Collapse
        </button>
      </div>

      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load todos: {error.message}
        </p>
      )}
      {actionError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      )}

      <form onSubmit={addTodo} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="New todo title"
          className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex gap-2">
          <select
            value={newKind}
            onChange={(event) => setNewKind(event.target.value as TodoKind)}
            className="flex-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            {TODO_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <select
            value={newBundle}
            onChange={(event) => setNewBundle(event.target.value)}
            className="flex-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">(no bundle)</option>
            {bundles.map((bundle) => (
              <option key={bundle.slug} value={bundle.slug}>
                {bundle.slug}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending === "__add__" || newTitle.trim().length === 0}
          className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          + Add todo
        </button>
      </form>

      <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Show archived
      </label>

      {loading && todos.length === 0 && error === undefined && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <ul className="flex flex-col gap-2">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
          >
            <input
              type="checkbox"
              checked={isDone(todo.status)}
              disabled={pending === todo.id}
              onChange={() => toggleDone(todo)}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_CHIP_CLASS[todo.kind]}`}>
                  {todo.kind}
                </span>
                <span className="text-[10px] text-neutral-400">p{todo.priority}</span>
                {todo.archived && <span className="text-[10px] text-neutral-400">(archived)</span>}
              </div>
              <p
                className={
                  isDone(todo.status) || todo.status === "wont-do"
                    ? "text-neutral-400 line-through dark:text-neutral-500"
                    : "text-neutral-800 dark:text-neutral-100"
                }
              >
                {todo.title}
              </p>
              {todo.bundle !== undefined && (
                <span className="w-fit rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {todo.bundle}
                </span>
              )}
            </div>
          </li>
        ))}
        {todos.length === 0 && !loading && (
          <li className="text-[11px] text-neutral-400">No todos yet.</li>
        )}
      </ul>
    </aside>
  );
};

/** Mirrors `@skillmaker/core`'s `DEFAULT_PRIORITY_BY_KIND` (data-model.md §2.10). */
const DEFAULT_PRIORITY_BY_KIND: Readonly<Record<TodoKind, number>> = {
  bug: 10,
  eval: 15,
  improvement: 20,
  task: 30,
};
