/**
 * The Lab's Queue mode (#83): "to-do mode," the whole workspace's work as
 * one bookmarkable place, not a popup. This is the former `TodosPanel`'s
 * powers moved here wholesale, per the issue -- the row/form/toggle pieces
 * below are the SAME logic that used to live in the retired persistent
 * right-rail panel (kind chips, the origin chip #86 added, the checkbox
 * status control, the add form, the show-swept toggle), just rendered
 * full-page instead of in a collapsible `<aside>`, since there is no
 * sibling route content to share the row with anymore.
 *
 * Bench's per-row "N open" signal links in via `labHref("queue", slug)`
 * (`?bundle=<slug>`); `route.bundle` is threaded down from `Lab.tsx` and
 * applied with the pure `filterTodosByBundle` helper (`runtime/
 * todoQueue.ts`) -- filtering is explicit and clearable (a visible chip
 * with a link back to the unfiltered queue), never a silent truncation of
 * the list underneath it.
 */
import { type FC, type FormEvent, useState } from "react";
import { postEvent } from "../runtime/api.ts";
import { Link, bundleRunHref, labHref } from "../runtime/router.tsx";
import type { TodoKind, TodoOriginView, TodoRecord, TodoStatus } from "../runtime/schemas.ts";
import { filterTodosByBundle, isDone } from "../runtime/todoQueue.ts";
import { useBundles } from "../runtime/useBundles.ts";
import { useTodos } from "../runtime/useTodos.ts";

const TODO_KINDS: ReadonlyArray<TodoKind> = ["task", "bug", "improvement", "eval"];

const KIND_CHIP_CLASS: Readonly<Record<TodoKind, string>> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  eval: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  improvement: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  task: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

/** Mirrors `@skillmaker/core`'s `DEFAULT_PRIORITY_BY_KIND` (data-model.md §2.10). */
const DEFAULT_PRIORITY_BY_KIND: Readonly<Record<TodoKind, number>> = {
  bug: 10,
  eval: 15,
  improvement: 20,
  task: 30,
};

/**
 * `TodoOrigin.kind` was widened to a closed union (issue #92: `"field-
 * report"` | `"intake"`) so future producers (`run`, `coverage-gap`) can add
 * a kind without a breaking change -- a lookup table here means a future
 * kind is one entry to add, not a ternary to find and duplicate at every
 * render site. `titlePrefix` and `label` differ for `"field-report"` (the
 * chip reads "from the field", the tooltip spells out "from field report
 * <id>") but coincide for `"intake"` -- both fields are still needed per
 * kind, not derivable from one another.
 */
const ORIGIN_LABEL: Readonly<Record<TodoOriginView["kind"], { readonly label: string; readonly titlePrefix: string }>> = {
  "field-report": { label: "from the field", titlePrefix: "from field report" },
  intake: { label: "from intake", titlePrefix: "from intake" },
  run: { label: "from a run", titlePrefix: "from run" },
};

/** The origin's id, read from its per-kind field (the union retired the old shared `ref`). */
const originId = (origin: TodoOriginView): string => {
  switch (origin.kind) {
    case "field-report":
      return origin.eventId;
    case "intake":
      return origin.intakeId;
    case "run":
      return origin.runId;
  }
};

/**
 * A `run` origin links back to its run's read-out as evidence (D5: the
 * origin stamp exists so the transcript stays one click away). Only a
 * bundle-scoped todo can build the link -- the read-out lives on the
 * bundle's Models tab -- and run-origin todos always carry the run's own
 * bundle, so the plain-chip fallback is for malformed history only.
 */
const originHref = (origin: TodoOriginView, bundle: string | undefined): string | undefined =>
  origin.kind === "run" && bundle !== undefined ? bundleRunHref(bundle, origin.runId) : undefined;

const TodoRow: FC<{ todo: TodoRecord; pending: boolean; onToggle: (todo: TodoRecord) => void }> = ({
  todo,
  pending,
  onToggle,
}) => (
  <li className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
    <input
      type="checkbox"
      checked={isDone(todo.status)}
      disabled={pending}
      onChange={() => onToggle(todo)}
      className="mt-0.5"
    />
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_CHIP_CLASS[todo.kind]}`}>
          {todo.kind}
        </span>
        <span className="text-[10px] text-neutral-400">p{todo.priority}</span>
        {todo.swept && <span className="text-[10px] text-neutral-400">(swept)</span>}
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
      {(todo.bundle !== undefined || todo.origin !== undefined) && (
        <div className="flex flex-wrap gap-1">
          {todo.bundle !== undefined && (
            <span className="w-fit rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {todo.bundle}
            </span>
          )}
          {todo.origin !== undefined &&
            (() => {
              const href = originHref(todo.origin, todo.bundle);
              const title = `${ORIGIN_LABEL[todo.origin.kind].titlePrefix} ${originId(todo.origin)}`;
              const chipClass =
                "w-fit rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300";
              return href !== undefined ? (
                <Link href={href} title={title} className={`${chipClass} underline`}>
                  {ORIGIN_LABEL[todo.origin.kind].label}
                </Link>
              ) : (
                <span title={title} className={chipClass}>
                  {ORIGIN_LABEL[todo.origin.kind].label}
                </span>
              );
            })()}
        </div>
      )}
    </div>
  </li>
);

export const Queue: FC<{ bundleFilter: string | undefined }> = ({ bundleFilter }) => {
  const [showSwept, setShowSwept] = useState(false);
  const { todos, loading, error, refetch } = useTodos(showSwept);
  const { bundles } = useBundles();
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<TodoKind>("task");
  const [newBundle, setNewBundle] = useState(bundleFilter ?? "");

  const visibleTodos = filterTodosByBundle(todos, bundleFilter);

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
        refetch();
      })
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(undefined));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {bundleFilter !== undefined && (
        <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>
            Filtered to <span className="font-medium text-neutral-800 dark:text-neutral-100">{bundleFilter}</span> --
            showing {visibleTodos.length} of {todos.length}
          </span>
          <Link href={labHref("queue")} className="text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200">
            Clear
          </Link>
        </div>
      )}

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
          checked={showSwept}
          onChange={(event) => setShowSwept(event.target.checked)}
        />
        Show swept
      </label>

      {loading && todos.length === 0 && error === undefined && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <ul className="flex flex-col gap-2">
        {visibleTodos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} pending={pending === todo.id} onToggle={toggleDone} />
        ))}
        {visibleTodos.length === 0 && !loading && (
          <li className="text-[11px] text-neutral-400">
            {bundleFilter !== undefined ? "No todos for this bundle." : "No todos yet."}
          </li>
        )}
      </ul>
    </div>
  );
};
