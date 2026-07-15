/**
 * The `/lab` page (#64, Board · Lab · Port): the hardening bench -- the skill
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
 * reordered for triage (drifted, then measurement gaps, then clean, then
 * archived) -- all via the pure helpers in `runtime/labOrder.ts`. Still
 * display-layer only: no new endpoint, `GET /api/catalog` already carries
 * everything this needs.
 */
import type { FC } from "react";
import {
  coverageState,
  driftNeedsAttention,
  orderForAttention,
  type AttentionDrift,
  type CoverageState,
} from "../runtime/labOrder.ts";
import { bundleHref, Link } from "../runtime/router.tsx";
import { STAGE_LABEL, type BundleStage, type CatalogEntry } from "../runtime/schemas.ts";
import { useCatalog } from "../runtime/useCatalog.ts";

const STAGE_BADGE_CLASS: Record<BundleStage, string> = {
  idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  researching: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  drafting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  evaluating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

/**
 * #65: a Lab pill means attention needed, so it only exists for the three
 * `Drift` values where something actually changed -- `in-sync` and
 * `no-version` never reach this map (see `driftNeedsAttention`). `in-sync`
 * still gets a mention, just as plain metadata ("No recorded version" in
 * the line below), not a loud pill.
 */
const DRIFT_LABEL: Record<AttentionDrift, string> = {
  "design-changed": "Design changed",
  "output-hand-edited": "Output hand-edited",
  both: "Design + output changed",
};

const DRIFT_BADGE_CLASS = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";

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
          href={bundleHref(entry.slug)}
          className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
        >
          {entry.name}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_BADGE_CLASS[entry.stage]}`}>
          {STAGE_LABEL[entry.stage]}
        </span>
        {entry.archived && (
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            Archived
          </span>
        )}
        {driftNeedsAttention(entry.drift) && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DRIFT_BADGE_CLASS}`}>
            {DRIFT_LABEL[entry.drift]}
          </span>
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

export const Lab: FC = () => {
  const { entries, loading, error } = useCatalog();
  const orderedEntries = orderForAttention(entries);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Lab</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          the hardening bench — stage, drift, and coverage at a glance.
        </p>
      </div>

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
