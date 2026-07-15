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
flow view** — skills in genesis and re-conception only. Maintenance work
on an existing skill (bugs, evals, improvements) is a todo, not a stage
move, and lives in the Lab, the ruling's stock view (full ruling:
`../_index/Vision - Board Lab Ship Receive`; the todo/stage split:
`./Entity - Todo`).

The same ruling makes the Published column a **doorway, not a shelf**
(#82): a graduated bundle passes through it into the Lab rather than
accumulating there indefinitely. A published bundle keeps its Published
card only while its `stageChangedAt` (`../production/Mechanism - Bundle
Stage`) is within `DOORWAY_WINDOW_DAYS = 7` days; past that it renders no
card, and the column's footer reads "N in the Lab →" (linking `/lab`)
whenever at least one is elided — never a silent drop, always a counted
one. A bundle pulled backward out of Published (re-conception) reappears
in the flow automatically: that's just its stage changing, no special
case. This is display-only — `GET /api/bundles` and the `bundles`
materialized table still carry every published bundle regardless of age,
so the Lab lists all of them and a bundle's own page is unaffected; only
this one column's cards are windowed.

## HOW

`Board.tsx` renders a column per entry in `STAGES` (the five production
states — `idea`, `researching`, `drafting`, `evaluating`, `published` —
declared in `runtime/schemas.ts`) plus a sixth, always-present `archived`
column. Bundles are bucketed by
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

The Published column's doorway (#82) is computed by a pure, React-free
helper, `packages/viewer/src/app/runtime/boardDoorway.ts`'s
`partitionDoorway`, called from `Board.tsx` with `new Date()` on every
render (never memoized to a stale value) — mirroring `FoldTodos.ts`'s
`isArchived`/`ARCHIVE_WINDOW_DAYS` pattern: an explicit `now` threaded in,
never read from the wall clock inside the fold itself. It returns
`{ visible, elidedCount }`; `visible` becomes the column's card list and
`elidedCount` feeds a `Link` to `/lab` rendered through `BoardColumn`'s
existing generic `footer` slot — the same mechanism the Idea column
already used for `NewBundleForm`. Every other column is unaffected.

Verified: read `packages/viewer/src/app/components/Board.tsx` directly —
`STAGES` is exactly `idea/researching/drafting/evaluating/published`
plus a literal `"Archived"` column appended outside the array, and
`bundlesByColumn` keys strictly off `bundle.stage`/`bundle.archived` (both
journal-fold-derived fields per `IndexService.ts`'s `bundles` table), never
off any mutable per-bundle ordering file; `partitionDoorway` is applied
only to the `"published"` column's bundles before they reach `BoardColumn`.
