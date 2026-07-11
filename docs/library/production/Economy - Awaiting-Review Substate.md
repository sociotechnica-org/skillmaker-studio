---
type: Economy
prefLabel: Awaiting-Review Substate
context: production
status: migrated
links:
  related_to:
    - "./Entity - Skill Bundle"
    - "./Mechanism - Bundle Stage"
    - "./Mechanism - Guarded Transition"
    - "../runs/Mechanism - Review Pair"
---

## WHAT

Every state a Skill Bundle sits in carries a substate: `working` or
`awaiting-review`. `awaiting-review` means "the current station's work is
done and a human needs to look at it" — the same idea the old model called
the Ready Marker (a `ready[]` toggle on a Board card, separate from the
stage itself), now a first-class substate on the journal fold rather than a
flag in a mutable JSON file.

## WHY

The Ready Marker and the runs-context "Needs-You State" (on-track /
running-slow / stuck / refused / blocked / failed / infra-error / done,
Raven's "needs you" framing) were two cards recording variants of the same
underlying fact: work is done, and it's specifically the human's turn, with
no change to the bundle's position in the ladder. Both merge into this one
substate. (Note: `Economy - Needs-You State` is sourced from the `runs`
sweep dir, not this worker's assignment to migrate directly — its
runs-context successor, if any, belongs to the `runs/` context group; this
card only accounts for it as a merge target, per the coordinating brief.)

## HOW

`substate: "working" | "awaiting-review"` on the journal-folded
`BundleState` (`packages/core/src/Bundle.ts`). The transitions are exact
and symmetric: `review.requested` (an agent ends its turn on a station's
work) enters `awaiting-review`; `review.resolved` (either `approve` or
`revise`) leaves it and returns the bundle to `working` — `approve`
additionally satisfies the forward guard on `Mechanism - Guarded
Transition`, `revise` notes become the next station run's prompt input
(`StationEngine.ts`'s `latestReviseNotes`). SQLite's `bundles` table
carries `substate` as a materialized column (data-model.md §2.11), so the
Board/viewer can show it without replaying the journal on every read.

Verified: `packages/core/src/Bundle.ts`'s `BundleSubstate` schema
(`Schema.Literals(["working", "awaiting-review"])`) with its doc comment
("the [inherited] `ready` flag dissolved into a proper substate ...
`review.requested` enters `awaiting-review`, `review.resolved` leaves
it"); `packages/core/src/StationEngine.ts`'s `runStation` appends
`review.requested` on a completed run, and `latestReviseNotes` reads the
latest `review.resolved` to fold `revise` notes into the next run's prompt.
