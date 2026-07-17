/**
 * The `/track` page (issue #109, data-model draft "Track" -- "the books"):
 * the keep-tabs-on-the-portfolio motion, replacing Activity's nav slot.
 * Views only -- zero new stored state, every row a derived projection.
 *
 * Two rooms, deep-linkable via `?view=` (same mechanism as the Lab's #83
 * mode split):
 *  - **Catalog** (default): the deck's complete inside index -- every skill
 *    that exists, one row per bundle, sortable (recency of activity, name,
 *    stage -- `runtime/trackSort.ts`). Whereabouts render as a derived
 *    STATUS SET, never one location: stage, last shipment + date, open
 *    work, badges (drift, Unverified). Rows are card summaries; click
 *    through to the skill card. Backed by `/api/catalog` alone -- no
 *    per-row fetching.
 *  - **Feed**: the journal, chronological (`ActivityFeed.tsx`'s `Feed`,
 *    moved in). The acts land there; the stuff lives in the drawer.
 *
 * Plus the **Archive drawer** (`?archive=1`, a bookmarkable fold of the
 * Catalog, not a separate store): retired bundles (the `archived` flag,
 * display verb Retire -- journaled, reversible) and salvaged crates
 * (`/api/intake`'s `salvaged` fold) side by side. Harvest affordances
 * intact: retired rows click through to their card; salvaged rows carry
 * the crate's intake id (its content still sits at `receiving/<intake>/`,
 * un-accessioned, retained as evidence -- the same handle Receive shows).
 * The Board's old Archive pseudo-column points here now.
 */
import { useState, type FC } from "react";
import { driftNeedsAttention, type AttentionDrift } from "../runtime/labOrder.ts";
import { bundleHref, labHref, Link, trackHref, type TrackView } from "../runtime/router.tsx";
import {
  STAGE_LABEL,
  UNVERIFIED_BADGE_CLASS,
  type BundleStage,
  type CatalogEntry,
  type SalvagedCrateView,
} from "../runtime/schemas.ts";
import {
  activeEntries,
  CATALOG_SORTS,
  orderCatalog,
  retiredEntries,
  type CatalogSort,
} from "../runtime/trackSort.ts";
import { useCatalog } from "../runtime/useCatalog.ts";
import { useIntake } from "../runtime/useIntake.ts";
import { Feed } from "./ActivityFeed.tsx";

const STAGE_BADGE_CLASS: Record<BundleStage, string> = {
  idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  researching: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  drafting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  evaluating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

const DRIFT_LABEL: Record<AttentionDrift, string> = {
  "design-changed": "Design changed",
  "output-hand-edited": "Output hand-edited",
  both: "Design + output changed",
};

const DRIFT_BADGE_CLASS = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";

const SORT_LABEL: Record<CatalogSort, string> = {
  recent: "Recent activity",
  name: "Name",
  stage: "Stage",
};

/**
 * One Catalog row: a card summary. The second line is the whereabouts --
 * a derived status set (stage is a badge above; here: last shipment + date,
 * open work, latest version), never a single "location."
 */
const CatalogRow: FC<{ entry: CatalogEntry }> = ({ entry }) => (
  <li className="flex flex-col gap-1.5 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
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
          Retired
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
    </div>
    {entry.oneLiner.length > 0 && (
      <p className="text-xs text-neutral-600 dark:text-neutral-300">{entry.oneLiner}</p>
    )}
    <div className="flex flex-wrap gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
      <span>
        {entry.lastShipment === null
          ? "never shipped"
          : `shipped to "${entry.lastShipment.destination}" ${new Date(entry.lastShipment.at).toLocaleDateString()}`}
      </span>
      {entry.openTodoCount > 0 ? (
        <Link href={labHref("queue", entry.slug)} className="text-sky-700 hover:underline dark:text-sky-300">
          {entry.openTodoCount} open
        </Link>
      ) : (
        <span>no open work</span>
      )}
      <span>
        {entry.latestVersion === null
          ? "no recorded version"
          : `v: ${entry.latestVersion.label ?? entry.latestVersion.hash.slice(0, 8)}`}
      </span>
      <span title="Most recent journal activity">
        active {new Date(entry.lastActivityAt).toLocaleDateString()}
      </span>
    </div>
  </li>
);

/** One salvaged crate in the drawer: what it claimed to be, why it was refused, and the intake id -- the harvest handle for content still sitting at `receiving/<intake>/`. */
const SalvagedRow: FC<{ crate: SalvagedCrateView }> = ({ crate }) => (
  <li className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {crate.claimedName ?? "unnamed crate"}
      </span>
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        salvaged
      </span>
      {crate.bundle !== null && (
        <span title="The existing bundle this salvage defended">
          <Link
            href={bundleHref(crate.bundle)}
            className="text-xs font-medium text-neutral-700 hover:underline dark:text-neutral-300"
          >
            {crate.bundle}
          </Link>
        </span>
      )}
    </div>
    <p className="text-xs text-neutral-500 dark:text-neutral-400">{crate.reason}</p>
    <div className="flex flex-wrap items-center gap-2">
      <code
        title={`The crate's content is retained at receiving/${crate.intake}/ — harvest from there.`}
        className="w-fit select-all rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
      >
        receiving/{crate.intake}/
      </code>
      <span className="text-[11px] text-neutral-400">{new Date(crate.at).toLocaleDateString()}</span>
    </div>
  </li>
);

/**
 * The Archive drawer: the Catalog's back fold -- everything out of
 * commission but kept, two populations in one place. A toggle whose open
 * state lives in the URL (`?archive=1`), so the Board's retired
 * pseudo-column can deep-link straight into it. Storage never moves; this
 * is a view.
 */
const ArchiveDrawer: FC<{
  open: boolean;
  retired: ReadonlyArray<CatalogEntry>;
  salvaged: ReadonlyArray<SalvagedCrateView>;
}> = ({ open, retired, salvaged }) => {
  const count = retired.length + salvaged.length;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
      <Link
        href={trackHref("catalog", { archive: !open })}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Archive ({count})</span>
        <span className="font-normal normal-case tracking-normal text-neutral-400">
          out of commission but kept — retired bundles and salvaged crates
        </span>
      </Link>

      {open && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Retired bundles
            </h3>
            {retired.length === 0 ? (
              <p className="text-xs text-neutral-400">
                Nothing retired. Retiring is journaled and reversible — a retired skill lands here, whole.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {retired.map((entry) => (
                  <CatalogRow key={entry.slug} entry={entry} />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Salvaged crates
            </h3>
            {salvaged.length === 0 ? (
              <p className="text-xs text-neutral-400">
                No salvaged crates. A refused arrival never becomes a skill, but its crate stays harvestable here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {salvaged.map((crate) => (
                  <SalvagedRow key={crate.intake} crate={crate} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

/** The Catalog room: every skill that exists, sortable; the drawer folds in below. */
const CatalogRoom: FC<{ archiveOpen: boolean }> = ({ archiveOpen }) => {
  const { entries, loading, error } = useCatalog();
  const { salvaged, error: intakeError } = useIntake();
  const [sort, setSort] = useState<CatalogSort>("recent");

  const active = orderCatalog(activeEntries(entries), sort);
  const retired = orderCatalog(retiredEntries(entries), sort);

  return (
    <div className="flex flex-col gap-3">
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load the catalog: {error.message}
        </p>
      )}
      {intakeError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load salvaged crates: {intakeError.message}
        </p>
      )}

      {loading && entries.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <label htmlFor="catalog-sort">Sort by</label>
        <select
          id="catalog-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as CatalogSort)}
          className="rounded-md border border-neutral-300 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          {CATALOG_SORTS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {SORT_LABEL[candidate]}
            </option>
          ))}
        </select>
      </div>

      <ul className="flex flex-col gap-2">
        {active.map((entry) => (
          <CatalogRow key={entry.slug} entry={entry} />
        ))}
        {entries.length === 0 && !loading && (
          <li className="text-sm text-neutral-400">No skills yet — the Catalog lists everything that exists.</li>
        )}
      </ul>

      <ArchiveDrawer open={archiveOpen} retired={retired} salvaged={salvaged} />
    </div>
  );
};

const MODE_TAB_ACTIVE =
  "font-display uppercase tracking-wide rounded-md bg-neutral-900 px-3 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900";
const MODE_TAB_INACTIVE =
  "font-display uppercase tracking-wide rounded-md px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100";

const MODE_LABEL: Record<TrackView, string> = { catalog: "Catalog", feed: "Feed" };

const ModeTabs: FC<{ view: TrackView }> = ({ view }) => (
  <nav className="flex items-center gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
    {(["catalog", "feed"] as const).map((mode) => (
      <Link key={mode} href={trackHref(mode)} className={view === mode ? MODE_TAB_ACTIVE : MODE_TAB_INACTIVE}>
        {MODE_LABEL[mode]}
      </Link>
    ))}
  </nav>
);

const MODE_TAGLINE: Record<TrackView, string> = {
  catalog: "the books — every skill that exists, whereabouts derived, click through to the card.",
  feed: "the journal, chronological — the acts land here; the stuff lives in the drawer.",
};

export const Track: FC<{ view: TrackView; archive: boolean }> = ({ view, archive }) => (
  <div className="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Track</h1>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{MODE_TAGLINE[view]}</p>
    </div>

    <ModeTabs view={view} />

    {view === "catalog" ? <CatalogRoom archiveOpen={archive} /> : <Feed />}
  </div>
);
