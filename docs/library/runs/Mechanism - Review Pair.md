---
type: Mechanism
prefLabel: Review Pair
context: runs
status: migrated
links:
  operates_on:
    - "./Component - Review Unit"
  related_to:
    - "../production/Mechanism - Guarded Transition"
    - "../production/Economy - Awaiting-Review Substate"
    - "./Entity - Run"
---

## WHAT
The non-blocking, event-sourced human gate: an agent finishes one station's
unit of work, appends `review.requested`, and ends its turn — the bundle
enters the `awaiting-review` substate. The human resolves asynchronously in
the viewer with `review.resolved`, decision `approve` or `revise`. Rewrite
of the old Human-Input Pair card, verbs renamed `human_input_requested` /
`human_input_resolved` → `review.requested` / `review.resolved`.

This card is the spine card resolving the prep doc's hot-spot #2 (two
human-gate models: a blocking Fabro hexagon node vs. this non-blocking
event-sourced pair). **Only the non-blocking pair survives.** There is no
Fabro node of any kind in v1 — the blocking model has no substrate left to
exist in, not merely a deprecated alternative.

## WHY
A blocking gate deadlocks a detached, long-running process — the agent
can't hold a turn open indefinitely waiting on a human. Making the gate
data (a pair of journal events) rather than a suspended process means the
agent always ends cleanly, and the human resolves whenever they get to it
without anything timing out.

## HOW
- Agent side (`packages/core/src/StationEngine.ts`, `runStation`): after a
  station run completes successfully, it appends `review.requested` with
  `{bundle, state, artifacts, question}` — `question` is a short templated
  one-liner from `buildReviewQuestion(state, changedPaths)`, not
  LLM-generated, grounded in exactly what files changed.
- Human side: the viewer's review panel resolves with `review.resolved`
  `{bundle, state, decision: "approve" | "revise", notes?}`.
- `approve` satisfies the forward guard on `bundle.stage_changed` for that
  station's state — see `../production/Mechanism - Guarded Transition`,
  where this pair plugs in as the forward-transition guard
  (`packages/core/src/Machine.ts`'s `hasApprovedReviewAfter`). `revise`
  notes become the agent's next instruction: `StationEngine.ts`'s
  `latestReviseNotes()` finds the latest `review.resolved` with
  `decision: "revise"` for the same `(bundle, state)` and folds its `notes`
  into the next station run's prompt via `buildStationPrompt()`.
- The substate itself (`working` ↔ `awaiting-review`) is documented in
  `../production/Economy - Awaiting-Review Substate` (another worker's
  card) — this card only describes the request/resolve mechanism that
  drives it.

**Needs-You merge.** The old Economy - Needs-You State card ("Raven needs
you" badge, `needs_human_feedback`) merges here as a short note rather than
a separate card: the same "a run is waiting on a human" idea generalizes
directly to `awaiting-review` — a bundle sitting in that substate is exactly
the "needs you" condition, just modeled as a substate on the journal fold
instead of a Tracker-only status value. The substate's full shape (fields,
derivation) is documented in `../production/Economy - Awaiting-Review
Substate`; this note only records the lineage.

Verified: `packages/core/src/Machine.ts`'s guard table comment and
`hasApprovedReviewAfter()` grep for `review.resolved`/`decision: "approve"`
confirm the forward-guard wiring; `packages/core/src/StationEngine.ts`'s
`runStation()` (appends `review.requested` only when `status === "completed"`)
and `latestReviseNotes()`/`buildStationPrompt()` confirm the revise-notes
loop. `grep -n "review" packages/core/src/Machine.ts
packages/core/src/StationEngine.ts` — both files use `review.requested` /
`review.resolved` verbatim, confirming the rename from
`human_input_requested`/`human_input_resolved`.
