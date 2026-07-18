/**
 * The `/lab` page (#64, Board · Lab · Ship · Receive · Activity as of #72):
 * the hardening bench -- the skill
 * browser that survives from the old single-page Catalog view (director
 * ruling, ui-pass-spec end-of-doc) -- name, one-liner, tags, stage, latest
 * version + drift, and a measurements summary, each row linking to its
 * bundle-detail page. Reads `GET /api/catalog`, a dedicated aggregate
 * endpoint (not `/api/bundles`) so this page doesn't need to fetch every
 * bundle's detail individually -- the endpoint name is server wire format
 * and stays `/api/catalog` (#64 is display-layer only).
 *
 * #65, "bench not shelf": the drift pill only renders for the three states
 * that mean something moved, the coverage line distinguishes its three
 * honest measurement states instead of one flat fraction, and rows are
 * reordered for triage -- all via the pure helpers in `runtime/labOrder.ts`.
 * Still display-layer only: no new endpoint, `GET /api/catalog` already
 * carries everything this needs.
 *
 * #83, "the Lab's two modes": the stock-and-flow ruling names the todo
 * queue as the heart of the Lab, so this page now has a mode toggle,
 * deep-linkable via `?view=` (`runtime/router.tsx`'s `labHref`/`LabView`)
 * so "to-do mode" is a bookmarkable place, not a popup:
 *  - **Bench** (default, `view=bench` or the param absent -- old `/lab`
 *    URLs are untouched) is the triage list below, now with a per-row
 *    open-work signal ("N open") wherever `openTodoCount > 0`, linking into
 *    Queue filtered to that bundle. `orderForAttention` learned the new
 *    rank: drifted, then open todos, then measurement gaps, then clean,
 *    archived last.
 *  - **Queue** (`?view=queue`) is the whole workspace's flat,
 *    priority-sorted todo list -- the retired `TodosPanel`'s powers,
 *    rendered here instead of a persistent rail (`Queue.tsx`).
 */
import type { FC } from "react";
import {
  coverageState,
  DRIFT_BADGE_CLASS,
  DRIFT_LABEL,
  driftNeedsAttention,
  orderForAttention,
  type CoverageState,
} from "../runtime/labOrder.ts";
import { bundleHref, labHref, Link, type LabView } from "../runtime/router.tsx";
import {
  RETIRED_BADGE_CLASS,
  STAGE_BADGE_CLASS,
  STAGE_LABEL,
  UNVERIFIED_BADGE_CLASS,
  type CatalogEntry,
} from "../runtime/schemas.ts";
import { useCatalog } from "../runtime/useCatalog.ts";
import { Queue } from "./Queue.tsx";

/**
 * Coverage's three honest states (#65): never collapse "a fixture exists"
 * into "it passes" (README: coverage and validation don't merge). Raw
 * numbers stay visible whenever there's anything to count.
 */
const COVERAGE_LABEL: Record<CoverageState, (entry: CatalogEntry) => string> = {
  "no-fixtures": () => "No fixtures yet",
  "under-measured": (entry) => `${entry.measuredFixtureCount}/${entry.fixtureCount} fixtures measured`,
  "fully-measured": (entry) => `All ${entry.fixtureCount} fixtures measured`,
};

const COVERAGE_CLASS: Record<CoverageState, string> = {
  "no-fixtures": "text-neutral-400 dark:text-neutral-500",
  "under-measured": "text-amber-700 dark:text-amber-400",
  "fully-measured": "text-emerald-700 dark:text-emerald-400",
};

const LabRow: FC<{ entry: CatalogEntry }> = ({ entry }) => {
  const coverage = coverageState(entry);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={bundleHref(entry.slug, "overview", "improve")}
          className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
        >
          {entry.name}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_BADGE_CLASS[entry.stage]}`}>
          {STAGE_LABEL[entry.stage]}
        </span>
        {entry.archived && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RETIRED_BADGE_CLASS}`}>
            Archived
          </span>
        )}
        {driftNeedsAttention(entry.drift) && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DRIFT_BADGE_CLASS}`}>
            {DRIFT_LABEL[entry.drift]}
          </span>
        )}
        {entry.unverified && (
          <span
            title="Arrived from outside; we have not yet measured it."
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${UNVERIFIED_BADGE_CLASS}`}
          >
            Unverified
          </span>
        )}
        {entry.openTodoCount > 0 && (
          <Link
            href={labHref("queue", entry.slug)}
            className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:underline dark:bg-sky-950 dark:text-sky-300"
          >
            {entry.openTodoCount} open
          </Link>
        )}
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-300">{entry.oneLiner}</p>

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {entry.latestVersion === null
            ? "No recorded version"
            : `Latest: ${entry.latestVersion.label ?? entry.latestVersion.hash.slice(0, 8)} (${new Date(
                entry.latestVersion.recordedAt,
              ).toLocaleDateString()})`}
        </span>
        <span className={COVERAGE_CLASS[coverage]}>{COVERAGE_LABEL[coverage](entry)}</span>
      </div>
    </li>
  );
};

const MODE_TAB_ACTIVE =
  "font-display uppercase tracking-wide rounded-md bg-neutral-900 px-3 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900";
const MODE_TAB_INACTIVE =
  "font-display uppercase tracking-wide rounded-md px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100";

const MODE_LABEL: Record<LabView, string> = { bench: "Bench", queue: "Queue" };

const ModeTabs: FC<{ view: LabView }> = ({ view }) => (
  <nav className="flex items-center gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
    {(["bench", "queue"] as const).map((mode) => (
      <Link key={mode} href={labHref(mode)} className={view === mode ? MODE_TAB_ACTIVE : MODE_TAB_INACTIVE}>
        {MODE_LABEL[mode]}
      </Link>
    ))}
  </nav>
);

const Bench: FC = () => {
  const { entries, loading, error } = useCatalog();
  const orderedEntries = orderForAttention(entries);

  return (
    <div className="flex flex-col gap-4">
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load lab: {error.message}
        </p>
      )}

      {loading && entries.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <ul className="flex flex-col gap-3">
        {orderedEntries.map((entry) => (
          <LabRow key={entry.slug} entry={entry} />
        ))}
        {entries.length === 0 && !loading && (
          <li className="text-sm text-neutral-400">No bundles yet.</li>
        )}
      </ul>
    </div>
  );
};

const MODE_TAGLINE: Record<LabView, string> = {
  bench: "the hardening bench — stage, drift, coverage, and open work at a glance.",
  queue: "to-do mode — every unit of work across the workspace, priority-sorted.",
};

export const Lab: FC<{ view: LabView; bundle: string | undefined }> = ({ view, bundle }) => (
  <div className="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Lab</h1>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{MODE_TAGLINE[view]}</p>
    </div>

    <ModeTabs view={view} />

    {view === "bench" ? <Bench /> : <Queue bundleFilter={bundle} />}
  </div>
);
