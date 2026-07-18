/**
 * The one NaN-guarded date-rendering idiom (issue #109 review): a malformed
 * timestamp renders as its raw string -- honest input, never the browser's
 * "Invalid Date". Promoted from `ActivityFeed.tsx`'s local helper so the
 * guard exists once; consumed by the Feed, Track's catalog/drawer rows, and
 * the skill card.
 */

/** Full timestamp (`toLocaleString`): date + time, for event rows and version history. */
export const formatTimestamp = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
};

/** Day precision (`toLocaleDateString`): for whereabouts lines where the time of day is noise. */
export const formatDay = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString();
};
