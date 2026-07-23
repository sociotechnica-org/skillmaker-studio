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
import { useEffect, useRef, useState } from "react";
import { getBundleDetail, getBundleFile, getCatalog, getFixtureDetail, getState, getTodos } from "../runtime/api.ts";
import { useJournalTick } from "./liveRefresh.ts";
import { modelDisplayName } from "../runtime/cardGlance.ts";
import { latestReviewOutcome, pendingReview } from "../runtime/reviewPanel.ts";
import type { BundleDetailResponse, BundleStage, CatalogEntry, StateResponse, TodoRecord } from "../runtime/schemas.ts";
import { claimFixtureCases, promptSummary, unclaimedFixtureCases } from "./evals.ts";
import type { BundleFile, Claim, ClaimStatus, Project, Skill, SkillLoop, SkillPage, Stage, Task, WireStage } from "./types.ts";

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

/** One catalog row -> a board/sidebar `Skill`. `substate` is optional on the wire (pre-substate servers) -- absent means no dot, never an invented one. */
export const toSkill = (entry: CatalogEntry): Skill => ({
  slug: entry.slug,
  stage: STAGE_FROM_WIRE[entry.stage],
  oneLiner: entry.oneLiner,
  awaitingReview: entry.substate === "awaiting-review",
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

/** A wire state string -> `WireStage`, or undefined for anything unrecognized (never invents a stage). */
export const asWireStage = (value: string | undefined): WireStage | undefined =>
  value === "idea" || value === "researching" || value === "drafting" || value === "evaluating" || value === "published"
    ? value
    : undefined;

/**
 * Bundle detail -> the Skill page's production-loop facts. The pending
 * review is derived by the shared `reviewPanel` fold (#130 rules binding:
 * labeled by the state that REQUESTED it, never the current stage); this
 * mapper only carries the facts -- the card builds its own display copy in
 * the next shell's stage vocabulary.
 */
export const toLoop = (detail: BundleDetailResponse): SkillLoop => {
  const pending = pendingReview(detail.events, detail.bundle.stage);
  const outcome = latestReviewOutcome(detail.events, detail.bundle.stage);
  return {
    slug: detail.bundle.slug,
    stage: detail.bundle.stage,
    substate: detail.bundle.substate,
    approvedForForward: detail.guardStatus.approvedForForward,
    gateApproved: detail.guardStatus.gateApproved,
    pending:
      pending === undefined
        ? undefined
        : {
            requestedState: asWireStage(pending.requestedState),
            question: pending.question,
            artifacts: pending.artifacts,
          },
    outcome:
      outcome === undefined
        ? undefined
        : { decision: outcome.decision, at: outcome.at, notes: outcome.notes },
  };
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
    // `case.json.risks` is the join (IA §C rule 2); the authored risk-map
    // column is a fallback while the dual-write still exists.
    const fixtureCases = claimFixtureCases(r.riskId, detail.fixtures, r.fixtureCase);
    const status: ClaimStatus =
      r.coverage === "gap"
        ? "gap"
        : r.coverage === "partial"
          ? "partial"
          : fixtureCases.some((c) => measuredPass.has(c))
            ? "proven"
            : "unmeasured";
    return {
      id: r.riskId,
      family: FAMILY_NAMES[r.family] ?? r.family,
      sentence: r.description !== undefined && r.description.length > 0 ? r.description : "(no description)",
      status,
      fixtures: fixtureCases.length,
      fixtureCases,
    };
  });

  const latestVersion = detail.versions.at(-1);
  const provenModels = [
    ...new Set(detail.measurements.filter((m) => m.passes > 0).map((m) => modelDisplayName(m.model))),
  ];
  const coveredCount = detail.riskCoverage.filter((r) => r.coverage !== "gap").length;

  return {
    loop: toLoop(detail),
    instructions,
    stage: STAGE_FROM_WIRE[detail.bundle.stage],
    versionShort: latestVersion === undefined ? null : latestVersion.hash.replace(/^sha256:/, "").slice(0, 8),
    drift: detail.bundle.drift.replace(/-/g, " "),
    provenOn: provenModels.length === 0 ? "none yet" : provenModels.join(", "),
    coverage: `${coveredCount} of ${detail.riskCoverage.length} claims`,
    claims,
    evals: {
      slug,
      latestVersionHash: latestVersion?.hash ?? null,
      runs: detail.runs.map((run) => ({
        id: run.id,
        fixtureCase: run.fixtureCase ?? null,
        versionHash: run.versionHash,
        provider: run.provider,
        model: modelDisplayName(run.model),
        startedAt: run.startedAt,
        status: run.status,
        verdict: run.verdict ?? null,
      })),
      measurements: detail.measurements.map((m) => ({
        fixtureCase: m.fixtureCase,
        versionHash: m.versionHash,
        model: modelDisplayName(m.model),
        n: m.n,
        passes: m.passes,
      })),
      unclaimed: unclaimedFixtureCases(detail.fixtures, detail.riskCoverage.map((r) => r.riskId)),
    },
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

/** What the claim accordion shows per fixture: prompt summary + answer-key presence (IA §C rule 2). */
export type FixtureGlance = {
  readonly summary: string | null;
  readonly hasAnswerKey: boolean;
  readonly checkCount: number;
  readonly fixtureClass: string | null;
};

/** `GET /api/bundles/:slug/fixtures/:case` -> the accordion's fixture line. Fetched lazily on first claim expand. */
export const fetchFixtureGlance = async (slug: string, caseName: string): Promise<FixtureGlance> => {
  const detail = await getFixtureDetail(slug, caseName);
  return {
    summary: promptSummary(detail),
    hasAnswerKey: detail.grading !== null && detail.grading.answerKey !== null && detail.grading.answerKey.trim().length > 0,
    checkCount: detail.grading?.checks.length ?? 0,
    fixtureClass: detail.class,
  };
};

/** The run-row facts only `GET /runs/:runId` carries: the invoked flag (IA §C rule 3) + artifact names. */
export type RunGlance = {
  /** `true`/`false` = the wire's `skillInvoked` verdict; `null` = the server didn't say (older server). */
  readonly skillInvoked: boolean | null;
  readonly artifacts: ReadonlyArray<string>;
};

/**
 * Raw read of `GET /api/bundles/:slug/runs/:runId` for the invoked chip:
 * `skillInvoked` rides the response top-level, OUTSIDE the decoded
 * `RunDetailResponse` schema (the epistemic core, today CLI-only), so this
 * reads the body directly -- same raw-fetch precedent as
 * `fetchBundleFiles`. The transcript is deliberately not returned.
 */
export const fetchRunGlance = async (slug: string, runId: string): Promise<RunGlance> => {
  const response = await fetch(
    `/api/bundles/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
  );
  if (!response.ok) throw new Error(`run: ${response.status}`);
  const body = (await response.json()) as { skillInvoked?: unknown; artifacts?: unknown };
  return {
    skillInvoked: typeof body.skillInvoked === "boolean" ? body.skillInvoked : null,
    artifacts: Array.isArray(body.artifacts)
      ? body.artifacts.filter((a): a is string => typeof a === "string")
      : [],
  };
};

/**
 * Fetch-on-mount with placeholder fallback: renders `fallback` (data.ts's
 * placeholder constants) while loading AND on any failure -- the shell
 * never breaks when the server is absent. Pass a module-level `fetcher`
 * (stable identity) so the effect runs once per mount.
 *
 * Both hooks also refetch when the shared journal tick bumps
 * (./liveRefresh.ts: one debounced SSE subscription per page), so new
 * runs, stage changes, and todos appear without a manual refresh. A
 * tick-driven refetch is quiet: current data stays on screen while the
 * fresh response loads, and a transient failure never demotes live data.
 */
/** Like useApiData, but distinguishes loading / live / error so views can
 * avoid the placeholder flash: show nothing while loading, placeholders
 * only when the server is absent, and honest empty states when live. */
export function useApiStatus<T>(fetcher: () => Promise<T>): { readonly data?: T; readonly status: "loading" | "live" | "error" } {
  const tick = useJournalTick();
  const [state, setState] = useState<{ readonly data?: T; readonly status: "loading" | "live" | "error" }>({ status: "loading" });
  const lastFetcher = useRef<(() => Promise<T>) | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    // A tick with the same fetcher is a background refresh: keep what's
    // on screen. A new fetcher (e.g. slug change) starts from loading.
    const isRefresh = lastFetcher.current === fetcher;
    lastFetcher.current = fetcher;
    if (!isRefresh) setState({ status: "loading" });
    fetcher().then(
      (value) => {
        if (!cancelled) setState({ data: value, status: "live" });
      },
      () => {
        if (!cancelled) setState((prev) => (isRefresh && prev.status === "live" ? prev : { status: "error" }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, tick]);
  return state;
}

export function useApiData<T>(fetcher: () => Promise<T>, fallback: T): T {
  const tick = useJournalTick();
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetcher().then(
      (value) => {
        if (!cancelled) setData(value);
      },
      () => {
        // Server absent or wire mismatch: stay on the placeholders
        // (or on the last good data if a refresh fails transiently).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, tick]);

  return data ?? fallback;
}
