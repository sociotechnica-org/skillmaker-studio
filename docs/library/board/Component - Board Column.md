---
type: Component
prefLabel: Board Column
context: board
status: migrated
links:
  contains:
    - "./Component - Bundle Card"
  derived_from:
    - "../production/Mechanism - Bundle Stage"
  related_to:
    - "./Surface - Board"
---

## WHAT

One vertical lane of the Board: a title, a count, and the `Bundle Card`s
currently in that lane. Implemented as `BoardColumn` in
`packages/viewer/src/app/components/BoardColumn.tsx`.

## HOW

`BoardColumn` is a plain presentational component — it takes `title`,
`bundles`, and per-bundle fixture counts as props and renders a header plus
a stack of `BundleCard`s; it holds no logic of its own about which bundles
belong in which column (that bucketing happens one level up, in
`Board.tsx`'s `bundlesByColumn`). The column set itself is
`derived_from` the state list of the production state machine (five
states + `archived`, see `Mechanism - Bundle Stage`), not the old
six-stage ladder — the same "one column per state" shape survives, only
the state set underneath it changed.

Verified: `packages/viewer/src/app/components/BoardColumn.tsx` — the
component signature (`title`, `bundles`, `fixtureCounts?`, `onSelect?`) has
no stage-specific branching; the five-states-plus-archived column list it
renders is supplied entirely by `Board.tsx`'s `STAGE_COLUMNS` array.
