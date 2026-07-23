/**
 * Live-data wiring for the next shell: typed fetch helpers that ride the
 * existing runtime client (fetch -> JSON -> effect `Schema` decode, see
 * ../runtime/client.ts) and map the wire shapes onto this shell's domain
 * types -- so components keep consuming `Project`/`Task` exactly as
 * data.ts's placeholders shaped them.
 *
 * Agent-first parity (house rule D6): everything surfaced here is also
 * reachable via the CLI -- skills-by-stage ≈ `skillmaker list` (the same
 * catalog fold) and tasks ≈ `skillmaker todo list` (the same todos fold).
 *
 * The shell must never break without the server: `/next` runs under plain
 * `astro dev` where `/api/*` is absent, so `useApiData` falls back to the
 * caller-supplied placeholder constants on any fetch/decode failure.
 */
import { useEffect, useState } from "react";
import { getCatalog, getState, getTodos } from "../runtime/api.ts";
import type { BundleStage, CatalogEntry, StateResponse, TodoRecord } from "../runtime/schemas.ts";
import type { Project, Skill, Stage, Task } from "./types.ts";

/**
 * Wire stage -> this shell's display `Stage`. Deliberately NOT the runtime's
 * `STAGE_LABEL` map (that one says "Draft"/"Publish"): the next shell's IA
 * doc ruled its own column vocabulary, held in types.ts's `STAGES`.
 */
export const STAGE_FROM_WIRE: Record<BundleStage, Stage> = {
  idea: "Idea",
  researching: "Research",
  drafting: "Drafting",
  evaluating: "Evals",
  published: "Published",
};

/** One catalog row -> a board/sidebar `Skill`. */
export const toSkill = (entry: CatalogEntry): Skill => ({
  slug: entry.slug,
  stage: STAGE_FROM_WIRE[entry.stage],
  oneLiner: entry.oneLiner,
});

/**
 * Catalog + workspace -> the projects list. A single project until the
 * registry exists: named after the workspace, skills from the catalog.
 * Archived bundles stay off the board (its "Archived: drawer" footnote).
 */
export const toProjects = (
  state: StateResponse,
  entries: ReadonlyArray<CatalogEntry>,
): ReadonlyArray<Project> => [
  {
    name: state.workspace.name,
    path: state.workspace.path,
    skills: entries.filter((entry) => !entry.archived).map(toSkill),
  },
];

/**
 * A todo's provenance line, in the shell's "run · slug" / "gap · slug" /
 * "human" style. Origin wins when present (which upstream signal opened the
 * todo automatically); an origin-less `eval` todo is a coverage gap; an
 * origin-less anything else was opened by a person.
 */
export const renderOrigin = (todo: TodoRecord): string => {
  const suffix = todo.bundle !== undefined ? ` · ${todo.bundle}` : "";
  switch (todo.origin?.kind) {
    case "run":
      return `run${suffix}`;
    case "field-report":
      return `report${suffix}`;
    case "intake":
      return `intake${suffix}`;
    case undefined:
      return todo.kind === "eval" ? `gap${suffix}` : "human";
  }
};

/**
 * One todo -> a `Task`, or `undefined` for terminal todos (`done`/
 * `wont-do`) -- the Tasks view lists open work only, exactly like the
 * sidebar badge's count.
 */
export const toTask = (todo: TodoRecord): Task | undefined =>
  todo.status === "open" || todo.status === "in-progress"
    ? { title: todo.title, origin: renderOrigin(todo), state: todo.status }
    : undefined;

export const toTasks = (todos: ReadonlyArray<TodoRecord>): ReadonlyArray<Task> =>
  todos.flatMap((todo) => {
    const task = toTask(todo);
    return task === undefined ? [] : [task];
  });

/** `GET /api/state` + `GET /api/catalog` -> skills-by-stage (≈ `skillmaker list`). */
export const fetchProjects = async (): Promise<ReadonlyArray<Project>> => {
  const [state, catalog] = await Promise.all([getState(), getCatalog()]);
  return toProjects(state, catalog.entries);
};

/** `GET /api/todos` -> open tasks (≈ `skillmaker todo list`). */
export const fetchTasks = async (): Promise<ReadonlyArray<Task>> => {
  const response = await getTodos(false);
  return toTasks(response.todos);
};

/**
 * Fetch-on-mount with placeholder fallback: renders `fallback` (data.ts's
 * placeholder constants) while loading AND on any failure -- the shell
 * never breaks when the server is absent. Pass a module-level `fetcher`
 * (stable identity) so the effect runs once per mount.
 */
export function useApiData<T>(fetcher: () => Promise<T>, fallback: T): T {
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetcher().then(
      (value) => {
        if (!cancelled) setData(value);
      },
      () => {
        // Server absent or wire mismatch: stay on the placeholders.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  return data ?? fallback;
}
