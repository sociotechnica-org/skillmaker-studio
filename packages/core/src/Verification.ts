/**
 * The Unverified badge (issue #93, `Mechanism - Receiving Dock.md` §HOW,
 * "The Unverified badge"): derived only, at read time, never stored. No
 * `skill.cleared` event exists or ever will (revisit is cheap, event types
 * are additive) -- "clearing" is just the derivation flipping false once a
 * graded measurement exists. No "Verified" state anywhere: the badge's
 * absence is silence, not a medal.
 *
 * A bundle is Unverified iff:
 *   (a) it was RECEIVED -- its history contains at least one `skill.routed`
 *       event whose disposition GRANTS IDENTITY (`return`, `new`,
 *       `upgrade`, `fork`) naming this bundle. `salvage` grants no identity
 *       (`Mechanism - Receiving Dock.md` §HOW), so it never marks any
 *       bundle Unverified -- not the (usually absent) bundle it names, and
 *       not the crate itself, which never becomes a bundle at all.
 *   (b) it has ZERO graded measurements EVER, at ANY recorded version.
 *       "Ever, at any version" falls out of using the exact same unfiltered
 *       measurement list every other display already reads
 *       (`IndexService.listMeasurements`/`computeMeasurements` fold every
 *       run for the bundle regardless of version) -- there is no separate
 *       "all versions" query to get right or get wrong.
 *
 * A version bump never resurrects the badge: `everReceived` is a one-time
 * fact recorded once and never revoked, and "zero measurements ever" only
 * gets harder to satisfy over time (a new version has no runs of its own
 * yet, but the bundle's PRIOR versions' graded runs still count -- the
 * first measurement EVER clears, for good).
 *
 * Traveled receipts (a crate's own claims -- `skill.received.claimedVersionHash`/
 * `notes` -- or a `skill.shipped` snapshot) never clear the badge: neither
 * is a `run.graded` event, so neither ever reaches `computeMeasurements`'s
 * input in the first place (`IndexService.rebuild`'s `runRecords` are
 * scanned from `runs/<id>/run.json` + folded `run.graded` events only).
 * This falls out of the existing pipeline rather than needing a filter
 * here -- asserted by test, not enforced by code, since there is no code
 * path where it could leak in.
 */
import type { JournalEvent, RouteDisposition } from "./Journal.ts";

/**
 * The dispositions that grant a bundle identity (`Mechanism - Receiving
 * Dock.md` §HOW): every disposition except `salvage`. Mirrors `Route.ts`'s
 * `DISPOSITIONS` minus the one that grants nothing.
 */
export const IDENTITY_GRANTING_DISPOSITIONS: ReadonlyArray<RouteDisposition> = [
  "return",
  "new",
  "upgrade",
  "fork",
];

export const isIdentityGrantingDisposition = (disposition: RouteDisposition): boolean =>
  IDENTITY_GRANTING_DISPOSITIONS.includes(disposition);

/**
 * Folds `skill.routed` events into the set of bundle slugs ever received
 * (issue #93): any identity-granting disposition names the bundle it
 * grants/confirms identity for. Arrival is a one-time fact -- nothing ever
 * removes a slug from this set, and a later event (a version bump, another
 * routing) never revisits it.
 */
export const foldEverReceivedBundles = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlySet<string> => {
  const slugs = new Set<string>();
  for (const event of events) {
    if (event.type !== "skill.routed") continue;
    if (!isIdentityGrantingDisposition(event.payload.disposition)) continue;
    if (event.payload.bundle === undefined) continue;
    slugs.add(event.payload.bundle);
  }
  return slugs;
};

/**
 * The badge derivation itself: received, and zero graded measurements ever,
 * at any version. `measurementCount` is the caller's already-computed
 * `computeMeasurements(...).length` (or `IndexService.listMeasurements`'s
 * result length) for the bundle across its FULL run history -- never a
 * version-scoped subset, or "any version" silently narrows to "the latest
 * version."
 */
export const isUnverified = (everReceived: boolean, measurementCount: number): boolean =>
  everReceived && measurementCount === 0;
