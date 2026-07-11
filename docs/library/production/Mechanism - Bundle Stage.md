---
type: Mechanism
prefLabel: Bundle Stage
context: production
status: migrated
links:
  related_to:
    - "./Entity - Skill Bundle"
    - "./Mechanism - Guarded Transition"
    - "./Economy - Awaiting-Review Substate"
    - "../runs/Reference - Canonical Store Split"
---

## WHAT

`bundle.stage` is the single field that holds a Skill Bundle's current
position on the production state machine — one state set, folded entirely
from the journal, never stored as a mutable value in a file. It replaces
two old concepts at once: the old `Mechanism - Stage` (one rung of the
six-stage ladder) and the old `Economy - Stage Status` (the enum value a
Play carried) collapse into this one field, and it also absorbs the old
library set's `Value - Stage` / `Value - Status` pair — which the earlier
library had already flagged as the same "stage vs status" polysemy under
`thread:studio-board-stage-status-polysemy`.

## WHY

The old model had two names circling the same idea — a Play's "stage" on
the production ladder and its "status" in the proving ladder — never fully
reconciled, and the Board's own `board-state.json` made the value doubly
concrete as a mutable, hand-editable JSON file (a slug living under exactly
one stage-list key). That's the polysemy this card resolves: there is now
exactly one state set (`Mechanism - Guarded Transition`'s five states +
archived), exactly one field name (`bundle.stage`), and exactly one
canonical source (the journal) — no separate mutable status ladder, no
`registry.js`-style `status:` field (that card, `Reference - Legacy
Status`, retires outright as doubly moot).

## HOW

`bundle.stage` is materialized, not stored: `packages/core/src/Bundle.ts`'s
`BundleState` schema (`slug`, `stage`, `substate`, `archived`) is produced
entirely by folding the journal's `bundle.stage_changed` (and
`bundle.archived`/`bundle.restored`) events (`Fold.ts`'s
`foldBundleStates`), never read from or written to a JSON file on disk.
SQLite's `bundles` table (`packages/core/src/` reindex path, per
data-model.md §2.11) carries `stage`/`substate`/`archived` as a
materialized view of this same fold, rebuildable at any time via
`skillmaker reindex` — it is an index, not a second source of truth.

Verified: `packages/core/src/Bundle.ts`'s `BundleState` class declares
`stage: BundleStage` as the only stage-shaped field on the mutable side of
a bundle, with a doc comment explicitly stating "materialized by journal
replay ... never stored as a mutable file — there is no board-state.json
descendant"; `packages/core/src/Machine.ts`'s `currentStageOf` reads it via
`foldBundleStates(events).get(bundle)?.stage ?? "idea"`, confirming the
journal-fold-only sourcing.
