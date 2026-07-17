/**
 * Track's Catalog ordering (issue #109): pure sort helpers over catalog
 * entries, no React -- same split as `labOrder.ts`. The Catalog is the
 * complete inside index; sorting is a view choice, never a filter that
 * hides anything (the Archive drawer is the one fold, and it's a separate
 * toggle, not a sort).
 */
import { STAGES, type BundleStage, type CatalogEntry } from "./schemas.ts";

export type CatalogSort = "recent" | "name" | "stage";

export const CATALOG_SORTS: ReadonlyArray<CatalogSort> = ["recent", "name", "stage"];

const stageRank = (stage: BundleStage): number => STAGES.indexOf(stage);

/**
 * A stable, non-mutating sort: `recent` newest activity first (the default
 * -- "keep tabs" reads freshest first), `name` alphabetical, `stage` ladder
 * order (idea -> published) with recency as the tiebreak.
 */
export const orderCatalog = (
  entries: ReadonlyArray<CatalogEntry>,
  sort: CatalogSort,
): ReadonlyArray<CatalogEntry> => {
  const byRecency = (a: CatalogEntry, b: CatalogEntry): number =>
    b.lastActivityAt.localeCompare(a.lastActivityAt);
  const copy = [...entries];
  switch (sort) {
    case "recent":
      return copy.sort(byRecency);
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "stage":
      return copy.sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || byRecency(a, b));
  }
};

/** The Archive drawer's retired population: the Catalog folded to `archived` rows -- a view, storage never moves. */
export const retiredEntries = (entries: ReadonlyArray<CatalogEntry>): ReadonlyArray<CatalogEntry> =>
  entries.filter((entry) => entry.archived);

/** The Catalog's main rows: everything not in the drawer. */
export const activeEntries = (entries: ReadonlyArray<CatalogEntry>): ReadonlyArray<CatalogEntry> =>
  entries.filter((entry) => !entry.archived);
