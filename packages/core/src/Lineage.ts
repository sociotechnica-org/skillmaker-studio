/**
 * Lineage (issue #109, data-model draft "The Card"): the chain of custody,
 * replayed from the journal -- "lineage (journal replay + fork family)."
 * Pure filter only, no I/O, no Effect: which journal events constitute a
 * bundle's custody story (creation/adoption/receipt origin, version records,
 * ship/receive acts, retire/restore). Derived at read time, never stored --
 * the card is a projection, the journal is the identity.
 *
 * The fork-family half of lineage (`forkOf` / fork children) is NOT here:
 * that provenance lives on each bundle's `.skillmaker-adopt.json` marker
 * (`Adopt.ts`'s `AdoptMarker.forkOf`, house law: provenance that isn't a
 * per-event fact belongs on the marker), so the server reads markers for it.
 */
import { bundleForEvent } from "./Fold.ts";
import type { JournalEvent } from "./Journal.ts";

/**
 * The event types that tell the custody story. Deliberately NOT the whole
 * catalog: `run.*`/`todo.*`/`review.*`/`station.started`/`bundle.stage_changed`
 * are the working life of the skill (the Feed's business), not changes of
 * custody or identity. `skill.routed` is included because an identity-granting
 * disposition (`new`/`upgrade`/`fork`/`return`) IS the bundle's receipt
 * origin; `bundle.archived`/`bundle.restored` because Retire is a custody
 * fact ("out of commission but kept"), journaled and reversible.
 */
export const CUSTODY_EVENT_TYPES: ReadonlyArray<JournalEvent["type"]> = [
  "bundle.created",
  "skill.routed",
  "skill.version_recorded",
  "skill.published",
  "skill.shipped",
  "skill.field_report",
  "bundle.archived",
  "bundle.restored",
];

/**
 * The custody events concerning one bundle, in journal (chronological)
 * order -- the chain reads forward, oldest first. Attribution reuses
 * `bundleForEvent` (the same best-effort extraction the index mirror uses),
 * so a `skill.routed` naming this bundle counts and a target-less `salvage`
 * never attributes to anyone.
 */
export const custodyEventsFor = (
  events: ReadonlyArray<JournalEvent>,
  slug: string,
): ReadonlyArray<JournalEvent> =>
  events.filter(
    (event) =>
      (CUSTODY_EVENT_TYPES as ReadonlyArray<string>).includes(event.type) &&
      bundleForEvent(event) === slug,
  );
