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
