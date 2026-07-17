/**
 * Whereabouts (issue #109, data-model draft "Track"): "a status set, never
 * one location -- a skill can be published, shipped, and back on the bench
 * at once: column, last shipment + date, open work, badges. All derived."
 * Pure folds only, no I/O, no Effect: the two pieces of the status set the
 * index doesn't already carry (`stage`/`archived`/`drift`/`openTodoCount`/
 * `unverified` all exist on the catalog row today) -- the last shipment
 * fact and a recency-of-activity timestamp for Track's sort. Recomputed on
 * every request by `handleCatalog`, never stored.
 */
import { bundleForEvent } from "./Fold.ts";
import type { JournalEvent } from "./Journal.ts";

/** The most recent `skill.shipped` fact for a bundle -- where it last went, which version left, and when. */
export interface LastShipment {
  readonly destination: string;
  readonly versionHash: string;
  readonly at: string;
}

/**
 * bundle slug -> its most recent `skill.shipped` fact. Journal order is
 * append order, so the last write per slug wins -- the latest shipment.
 */
export const foldLastShipments = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlyMap<string, LastShipment> => {
  const shipments = new Map<string, LastShipment>();
  for (const event of events) {
    if (event.type !== "skill.shipped") {
      continue;
    }
    shipments.set(event.payload.bundle, {
      destination: event.payload.destination,
      versionHash: event.payload.versionHash,
      at: event.at,
    });
  }
  return shipments;
};

/**
 * bundle slug -> the `at` of the bundle's most recent journal event, using
 * the same `bundleForEvent` attribution the index mirror uses. A bundle
 * with no attributable events is simply absent (the caller falls back to
 * the bundle's own `created` timestamp -- an honest floor, not a fake).
 */
export const foldLastActivityAt = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlyMap<string, string> => {
  const lastActivity = new Map<string, string>();
  for (const event of events) {
    const bundle = bundleForEvent(event);
    if (bundle === undefined) {
      continue;
    }
    lastActivity.set(bundle, event.at);
  }
  return lastActivity;
};
