---
type: Mechanism
prefLabel: Bundle Archive
context: board
status: migrated
links:
  operates_on:
    - "../production/Entity - Skill Bundle"
  related_to:
    - "../production/Mechanism - Guarded Transition"
    - "./Entity - Todo"
    - "./Surface - Board"
---

## WHAT

The rule that moves a Skill Bundle off the active Board into the Archived
column and back: the `any ↔ archived` transition on the production state
machine (data-model.md §2.13), journaled as `bundle.archived` /
`bundle.restored` (§2.9) and materialized as the boolean `bundles.archived`
column (§2.11). This is what the old model's `Mechanism - Archive` (for
Work Orders) and `Capability - Graduate` (for Live plays leaving the
board) both collapse into, on the bundle side.

## WHY

Bundles need a reversible way to leave the active Board without losing
their stage — e.g. a bundle that's paused, superseded, or intentionally
shelved. The old model had two separate verbs for two separate things that
turn out to be the same idea (a terminal-work-order archive rule, and a
one-way "Graduate" action for Live plays); the new model has one journal
event pair covering both, and it's explicitly reversible in both
directions — `bundle.restored` is a first-class event, not a manual
un-graduate hack.

## HOW

`bundle.archived` / `bundle.restored` fire with payload `{bundle}` and are
folded by `Fold.ts` into the `bundles.archived` boolean; nothing else about
the bundle's `stage` changes when it archives — a bundle keeps whatever
stage it was in, it just stops rendering under that stage's Board column
and renders in the Archived column instead (`Board.tsx`'s
`bundlesByColumn`: `bundle.archived ? "archived" : bundle.stage`). Unlike
the old model's terminal + N-day-window + pinned-override auto-archive
rule for Work Orders, bundle archiving is not time-derived or automatic —
it is an explicit `any ↔ archived` transition on the state machine
(§2.13's transition table), always legal, requiring no guard.

**Be precise about the distinction this card exists to draw:** this
mechanism is about **bundles** entering/leaving the archived state
(`bundle.archived`/`bundle.restored`, no time component, always-legal,
manual). It is a *different* mechanism from a **Todo's own** `archived`
field (`Entity - Todo`), which *is* a derived, time-based rule (terminal
status + ≥7 days + not pinned) inherited near-verbatim from the old
model's Work-Order archive window. Two mechanisms, same English word
("archived"), two different subjects (bundle vs. todo) and two different
triggers (explicit event vs. time-derived). This is exactly the kind of
polysemy the old library's own hot-spot tracking flagged elsewhere
(Tier, Bank) — don't let it recur here silently.

Cross-ref `../production/Mechanism - Guarded Transition` — the
`any ↔ archived` transition is one row of that mechanism's guard table
(always legal, no guard), not a separate state-machine concept; this card
documents the archive-specific journal events and viewer behavior, that
one documents the transition table as a whole.

Verified: `packages/core/src/Fold.ts` — `bundle.archived` sets
`archived: true` and `bundle.restored` sets `archived: false` on the
folded `BundleState`, with no other field touched; and
`packages/viewer/src/app/components/Board.tsx`'s `bundlesByColumn`
confirms archived status is checked ahead of stage when bucketing bundles
into columns.
