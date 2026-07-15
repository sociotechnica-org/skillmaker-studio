---
type: Surface
prefLabel: Board
context: board
status: migrated
links:
  contains:
    - "./Component - Board Column"
  derived_from:
    - "../production/Mechanism - Bundle Stage"
  related_to:
    - "./Component - Bundle Card"
    - "./Surface - Activity Feed"
    - "../authoring/Role - Director"
    - "../production/Entity - Skill Bundle"
    - "./Entity - Todo"
    - "../_index/Vision - Board Lab Ship Receive"
---

## WHAT

The home Director/human surface: bundles rendered as cards in stage
columns, one column per state in the production state machine, plus a
final Archived column. It is the shipped viewer's default route (`/`),
implemented as `Board` in `packages/viewer/src/app/components/Board.tsx`.

## WHY

Still the studio's single "where does everything stand" view — but the
old six-stage ladder (Backlog→Sourced→Designed→Built→Proven→Live) and the
mutable `board-state.json` it rendered from are both gone. The Board now
has nothing to be out of sync with: it is a live projection of the
journal, not a second copy of the truth.

Director ruling (2026-07-15, #80 — "stock and flow"): **the Board is the
flow view.** It tracks skills in genesis and re-conception — the one
unit of work every brand-new skill has, "bring this thing into
existence," whose phases are exactly the stage columns above. That is
also its limit: work that changes how well an existing skill does what
it already is (bugs, evals, improvements) is a todo, not a stage move,
and it lives in the Lab (`../_index/Vision - Board Lab Ship Receive`),
the ruling's stock view — see `./Entity - Todo` for the todo/stage split
itself. Only work that changes what a skill *is* — its frame, its
design — re-enters this Board, as the already-legal backward stage move.

The same ruling makes the Published column a **doorway, not a shelf**
(#82, proposed, not yet built): recently graduated bundles should pass
through it into the Lab rather than accumulate here indefinitely. This
card does not yet implement that — `STAGE_COLUMNS`' `published` bucket
below has no time window today, so every published, non-archived bundle
renders there for as long as it stays published. #82 specs a derived
`stageChangedAt` timestamp (the `at` of the last `bundle.stage_changed`,
same pattern as `isArchived`'s window in `../board/Entity - Todo`) and a
`DOORWAY_WINDOW_DAYS` cutoff, past which a graduated bundle drops off
this column with a "N in the Lab →" pointer instead of silently vanishing.

## HOW

`Board.tsx` defines `STAGE_COLUMNS` as the five production states (`idea`,
`researching`, `drafting`, `evaluating`, `published`) plus a sixth,
always-present `archived` column. Bundles are bucketed by
`bundle.archived ? "archived" : bundle.stage` — archived status wins over
whatever stage the bundle is nominally parked at, so a bundle never
appears in two columns. Each column is a `BoardColumn` (see
`Component - Board Column`) holding `BundleCard`s (see
`Component - Bundle Card`). The data itself comes from `useBundles()`,
which reads the `bundles` materialized table (journal fold, data-model.md
§2.11) via the viewer's API — there is no `board-state.json` descendant
anywhere in the shipped code; `Bundle selection is a real navigation
(navigate(bundleHref(slug)))`, per the component's own comment, not local
panel state.

Verified: read `packages/viewer/src/app/components/Board.tsx` directly —
`STAGE_COLUMNS` is exactly `idea/researching/drafting/evaluating/published`
plus a literal `"Archived"` column appended outside the array, and
`bundlesByColumn` keys strictly off `bundle.stage`/`bundle.archived` (both
journal-fold-derived fields per `IndexService.ts`'s `bundles` table), never
off any mutable per-bundle ordering file.
