---
type: Economy
prefLabel: Run State
context: runs
status: migrated
links:
  related_to:
    - "./Entity - Run"
    - "./Mechanism - Review Pair"
---

## WHAT
Two separate values, not one enum. Rewrite of the old Run State card, whose
on-track/running-slow/stuck/refused/blocked/failed/infra-error/done enum
shrinks to two independent facts:

- `run.json`'s `status: "running" | "completed" | "failed" | "infra-error"`
  — the execution outcome, set by the run engine.
- a separate `verdict: "pass" | "fail" | "partial"` on the `run.graded`
  journal event — a human judgment, recorded only for runs a human has
  graded, and never stored in `run.json` itself (grading is a decision, so
  it's a journal event, and regrades are naturally append-only history).

## WHY
Collapsing "did it run" and "was it good" into one status ladder is exactly
what produced the old model's Tracker/Ledger tension (hot-spot #9): the
ledger collapsed distinct failure exits to one value and the Tracker had to
re-split them by inference. Splitting execution status from grading verdict
at the source removes the need to re-split anything downstream.

## HOW — refused vs. failed, CONFIRMED against shipped code
The prep doc's open question 1 ("is 'refused' reintroduced as a verdict?")
is resolved here as **confirmed shipped reality, not speculation**:

```ts
// packages/core/src/Journal.ts
export const RunVerdict = Schema.Literals(["pass", "fail", "partial"]);
```

The shipped `RunVerdict` enum is exactly `["pass", "fail", "partial"]` —
**no `"refused"` value exists.** A refusal (the agent declining to act on
thin/adversarial input) is expected to be graded `verdict: "fail"`, with
the grading `notes` field explaining why it's a fail (e.g. "correctly
refused — this was the intended behavior for a refusal-class fixture" would
still be graded `pass`; an unwanted refusal is `fail` with notes). There is
no separate verdict slot for "refused-and-that-was-correct" vs.
"refused-and-that-was-wrong" — both are `pass`/`fail` plus notes.

This also resolves the prep doc's hot-spot #9 (collapsed failure exits)
directly: **the infra/skill failure split is kept** —

```ts
// packages/core/src/Run.ts
export const RunStatus = Schema.Literals(["running", "completed", "failed", "infra-error"]);
```

`infra-error` vs `failed` is enforced by `RunEngine.ts`'s and
`StationEngine.ts`'s `classifyAcpError()` (spawn failure, auth failure,
timeout → `infra-error`; a non-`end_turn` stop reason on a real session →
`failed`) — so auth/sandbox/connection faults never pollute pass rates. But
**no distinct `refused` verdict exists** on top of that split; `fail` +
grading notes covers it.

Verified: `packages/core/src/Journal.ts` — `RunVerdict = Schema.Literals(["pass", "fail", "partial"])`,
confirmed by direct grep, no `"refused"` literal anywhere in the file.
`packages/core/src/Run.ts` — `RunStatus = Schema.Literals(["running", "completed", "failed", "infra-error"])`.
`packages/core/src/RunEngine.ts`'s `classifyAcpError` and
`FAILURE_CLASSIFICATION_TABLE` confirm the infra/failed split is a real,
implemented classification, not just a schema-level distinction.
