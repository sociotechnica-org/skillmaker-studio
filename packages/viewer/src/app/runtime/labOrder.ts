/**
 * Lab's bench-not-shelf logic (#65): what needs attention, and in what
 * order. Two pure, exported functions kept out of `Lab.tsx` so they're
 * unit-testable without React -- same pattern as `nextAction.ts`.
 *
 * `driftNeedsAttention` decides which `Drift` values earn a pill: only the
 * three states where something actually moved (`design-changed`,
 * `output-hand-edited`, `both`). `in-sync` and `no-version` read as benign
 * status, not attention -- Lab hides their pill so a pill on Lab always
 * means "look at this."
 *
 * `coverageState` distinguishes three honest measurement states -- no
 * fixtures yet, fixtures exist but under-measured, all fixtures measured --
 * per the README rule that coverage (a fixture exists) and validation (it
 * passes) never merge into one signal.
 *
 * `orderForAttention` sorts a catalog page for triage: drifted bundles
 * first, then measurement gaps (no fixtures or under-measured), then clean
 * (fully measured); archived bundles always sink to the bottom regardless
 * of their drift/coverage state, since there's nothing to act on for a
 * shelved bundle. Ties keep the incoming order (an explicit index
 * tie-break, not a reliance on `Array#sort`'s stability guarantee).
 */
import type { CatalogEntry, Drift } from "./schemas.ts";

/** The three `Drift` values that mean "something changed" -- the ones that earn a pill. */
export type AttentionDrift = "design-changed" | "output-hand-edited" | "both";

const ATTENTION_DRIFT: ReadonlySet<Drift> = new Set<AttentionDrift>(["design-changed", "output-hand-edited", "both"]);

/** True for the three drift values that mean "something changed" -- the ones that earn a pill. */
export const driftNeedsAttention = (drift: Drift): drift is AttentionDrift => ATTENTION_DRIFT.has(drift);

export type CoverageState = "no-fixtures" | "under-measured" | "fully-measured";

/** Which of the three honest coverage states a catalog entry is in. */
export const coverageState = (
  entry: Pick<CatalogEntry, "fixtureCount" | "measuredFixtureCount">,
): CoverageState => {
  if (entry.fixtureCount === 0) {
    return "no-fixtures";
  }
  if (entry.measuredFixtureCount < entry.fixtureCount) {
    return "under-measured";
  }
  return "fully-measured";
};

/** Attention-first sort rank: lower sorts earlier. Archived always ranks last, ahead of nothing. */
const attentionRank = (entry: CatalogEntry): number => {
  if (entry.archived) {
    return 3;
  }
  if (driftNeedsAttention(entry.drift)) {
    return 0;
  }
  if (coverageState(entry) !== "fully-measured") {
    return 1;
  }
  return 2;
};

/** Reorders catalog entries for triage: drifted, then measurement gaps, then clean, then archived. */
export const orderForAttention = (
  entries: ReadonlyArray<CatalogEntry>,
): ReadonlyArray<CatalogEntry> =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const rankDiff = attentionRank(a.entry) - attentionRank(b.entry);
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    })
    .map(({ entry }) => entry);
