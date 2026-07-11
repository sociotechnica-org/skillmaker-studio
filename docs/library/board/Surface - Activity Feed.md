---
type: Surface
prefLabel: Activity Feed
context: board
status: migrated
links:
  derived_from:
    - "../runs/Component - Journal Event"
  related_to:
    - "./Surface - Board"
    - "../production/Entity - Skill Bundle"
---

## WHAT

The journal rendered as a feed: a paginated, newest-first list of every
event in `.skillmaker/events.jsonl`, not scoped to any one bundle.
Implemented as `ActivityFeed` at the viewer's `/activity` route
(`packages/viewer/src/app/components/ActivityFeed.tsx`), backed by
`GET /api/events` and the `useEvents()` hook.

## WHY

Gives the Director one place to watch everything happening across the
whole studio — every stage change, review, grade, todo edit, publish — in
raw chronological order, independent of which bundle it belongs to. This
is the direct successor to the old runs-context `Surface - Play Tracker`
("plays in flight," per-run progress, the "Raven needs you" badge) — that
card's `MERGE` target per the prep doc, though it lands here in the
`board` context rather than staying in `runs` since the shipped surface is
board-adjacent nav, not a runs-specific view. (`Play Tracker` itself is
out of this worker's assignment to migrate — it lives under
`studio/sweeps/playmaker-studio/runs/Surface/`, another context's scope;
this card is only the destination it merges into. Flagging so the
migration coordinator doesn't double-count that source card.)

## HOW

Each row shows the event's `type`, formatted timestamp, `actor` (kind:name,
plus provider when the actor is an agent), and — when the payload carries a
`bundle` field, which most event types do — a link to that bundle's page.
The full JSON payload is available per-row behind a collapsed
`<details>/<summary>`. Pagination is "load more," newest-first. This is a
generic, un-opinionated raw-event view: every event type in the catalog
(`bundle.*`, `todo.*`, `run.*`, `station.*`, `review.*`, `skill.*`) renders
through the same `EventRow`, with no per-type formatting or filtering.

**⚠ per the prep doc's own flag, carried forward:** data-model.md does not
describe a dedicated in-flight-runs surface as explicitly as the old Play
Tracker did — there is no per-run progress/ETA display, and no distinct
"needs you" visual state beyond what a `review.requested` event's raw row
shows in the feed. What's shipped is the generic activity feed described
above, not a Tracker-equivalent live-run-status view. This is worth
confirming at build time (per the prep doc's own note) whether a
narrower, run-focused surface is still wanted on top of this — as of this
migration, `ActivityFeed` is what exists and it is comprehensive but not
run-specialized.

Verified: `packages/viewer/src/app/components/ActivityFeed.tsx` — reads
directly off `useEvents()` / `GET /api/events`, is a whole-journal view (no
bundle-scoping prop), and every row is rendered generically off
`event.type`/`event.at`/`event.actor`/`event.payload` with no per-event-type
special-casing, confirming the "no dedicated in-flight-runs surface" gap
noted above is real and not just an omission from this card.
