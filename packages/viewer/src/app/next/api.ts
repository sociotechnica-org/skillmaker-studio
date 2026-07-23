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
import { getBundleDetail, getBundleFile, getCatalog, getState, getTodos } from "../runtime/api.ts";
import { modelDisplayName } from "../runtime/cardGlance.ts";
import type { BundleStage, CatalogEntry, StateResponse, TodoRecord } from "../runtime/schemas.ts";
import type { BundleFile, Claim, ClaimStatus, Project, Skill, SkillPage, Stage, Task } from "./types.ts";

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

const FAMILY_NAMES: Record<string, string> = {
  IN: "Input",
  RE: "Reasoning",
  OUT: "Output",
  ADV: "Adversarial",
  CHN: "Chain",
};

/**
 * `GET /api/bundles/:slug` (+ the instructions file) -> the Skill page.
 * Claim status is honest about the coverage-vs-validation split: an
 * authored "covered" row only shows `proven` when a measurement actually
 * passed for its fixture; otherwise it renders `unmeasured`.
 */
export const fetchSkillPage = async (slug: string): Promise<SkillPage> => {
  const detail = await getBundleDetail(slug);
  const instructions =
    detail.instructionsPath === null
      ? null
      : await getBundleFile(slug, detail.instructionsPath).then(
          (f) => f.content,
          () => null,
        );

  const measuredPass = new Set(
    detail.measurements.filter((m) => m.passes > 0).map((m) => m.fixtureCase),
  );
  const claims: ReadonlyArray<Claim> = detail.riskCoverage.map((r) => {
    const status: ClaimStatus =
      r.coverage === "gap"
        ? "gap"
        : r.coverage === "partial"
          ? "partial"
          : r.fixtureCase !== undefined && measuredPass.has(r.fixtureCase)
            ? "proven"
            : "unmeasured";
    return {
      id: r.riskId,
      family: FAMILY_NAMES[r.family] ?? r.family,
      sentence: r.description !== undefined && r.description.length > 0 ? r.description : "(no description)",
      status,
      fixtures: r.fixtureCase === undefined ? 0 : 1,
    };
  });

  const latestVersion = detail.versions.at(-1);
  const provenModels = [
    ...new Set(detail.measurements.filter((m) => m.passes > 0).map((m) => modelDisplayName(m.model))),
  ];
  const coveredCount = detail.riskCoverage.filter((r) => r.coverage !== "gap").length;

  return {
    instructions,
    stage: STAGE_FROM_WIRE[detail.bundle.stage],
    versionShort: latestVersion === undefined ? null : latestVersion.hash.replace(/^sha256:/, "").slice(0, 8),
    drift: detail.bundle.drift.replace(/-/g, " "),
    provenOn: provenModels.length === 0 ? "none yet" : provenModels.join(", "),
    coverage: `${coveredCount} of ${detail.riskCoverage.length} claims`,
    claims,
    events: detail.events.slice(0, 5).map((e) => ({
      type: e.type,
      at: new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    })),
  };
};

/** `GET /api/bundles/:slug/files` -> the bundle's readable file tree. */
export const fetchBundleFiles = async (slug: string): Promise<ReadonlyArray<BundleFile>> => {
  const response = await fetch(`/api/bundles/${encodeURIComponent(slug)}/files`);
  if (!response.ok) throw new Error(`files: ${response.status}`);
  const body = (await response.json()) as { files?: ReadonlyArray<{ path?: unknown; size?: unknown }> };
  return (body.files ?? [])
    .filter((f): f is { path: string; size: number } => typeof f.path === "string" && typeof f.size === "number")
    .filter((f) => !f.path.endsWith("/.gitkeep"));
};

/** `GET /api/bundles/:slug/file?path=` -> one file's content. */
export const fetchBundleFile = async (slug: string, path: string): Promise<string> => {
  const response = await fetch(
    `/api/bundles/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`,
  );
  if (!response.ok) throw new Error(`file: ${response.status}`);
  const body = (await response.json()) as { content?: unknown };
  if (typeof body.content !== "string") throw new Error("file: malformed response");
  return body.content;
};

/**
 * Fetch-on-mount with placeholder fallback: renders `fallback` (data.ts's
 * placeholder constants) while loading AND on any failure -- the shell
 * never breaks when the server is absent. Pass a module-level `fetcher`
 * (stable identity) so the effect runs once per mount.
 */
/** Like useApiData, but distinguishes loading / live / error so views can
 * avoid the placeholder flash: show nothing while loading, placeholders
 * only when the server is absent, and honest empty states when live. */
export function useApiStatus<T>(fetcher: () => Promise<T>): { readonly data?: T; readonly status: "loading" | "live" | "error" } {
  const [state, setState] = useState<{ readonly data?: T; readonly status: "loading" | "live" | "error" }>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetcher().then(
      (value) => {
        if (!cancelled) setState({ data: value, status: "live" });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher]);
  return state;
}

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
