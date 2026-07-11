---
type: Component
prefLabel: Review Unit
context: runs
status: migrated
links:
  related_to:
    - "./Mechanism - Review Pair"
    - "./Entity - Run"
---

## WHAT
The thing a human reviews, one at a time — never a boolean "done or not."
In the shipped model, the unit is one station's completed work on one
bundle: a `(bundle, state)` pair, scoped by exactly which files that
station is allowed to touch (`stations.json`'s `produces` list). Rewrite of
the old Review Unit card — same "a slot/question/section, never a boolean"
idea survives, but the old canonical example (Vision's nine slots) was
Alexandria-specific and retires with it.

## WHY
Reviewing "is this bundle done" as a single yes/no collapses everything a
station produced into one undifferentiated judgment call. Scoping review to
one station's output at a time keeps each review small, specific, and
answerable — the human is looking at exactly what changed, not re-auditing
the whole bundle.

## HOW
A skillmaker-native example doesn't exist yet as a shipped fixture, but the
concrete shape of a review unit is fully specified by
`packages/core/src/StationEngine.ts`'s `buildReviewQuestion` function:

```ts
export const buildReviewQuestion = (state: BundleStage, changedPaths: ReadonlyArray<string>): string =>
  changedPaths.length === 0
    ? `Review the "${state}" station's run -- no files changed.`
    : `Review the "${state}" station's changes to ${changedPaths.join(", ")}.`;
```

This is the `question` field on `review.requested` — a templated,
deterministic one-liner grounded in exactly which paths the station's run
touched (filtered to that station's `produces` list, so the reviewer never
sees "changes" outside what the station was allowed to write). The unit is
therefore concretely: one `state` (which station), one bundle, and the set
of `changedPaths` that station's run actually produced — resolved via
`review.resolved`'s `{bundle, state, decision, notes}` before the human
moves to the next unit.

Verified: `packages/core/src/StationEngine.ts`'s `buildReviewQuestion` and
`filterToProduces`/`matchesProduces` (the produces-scoping filter that
determines exactly which `changedPaths` a review unit's question cites).
