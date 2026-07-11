---
type: Mechanism
prefLabel: Guarded Transition
context: production
status: migrated
links:
  operates_on:
    - "./Entity - Skill Bundle"
  contains:
    - "./Mechanism - Bundle Stage"
  related_to:
    - "./Economy - Awaiting-Review Substate"
    - "./Economy - Station Doer"
    - "../runs/Mechanism - Review Pair"
    - "../runs/Reference - Canonical Store Split"
---

## WHAT

The one advancement mechanism for a Skill Bundle: a **guarded**
`bundle.stage_changed` journal event. There are exactly five states plus a
separate `archived` flag — `idea → researching → drafting → evaluating →
published` — and a Skill Bundle advances one state at a time, only when its
transition's guard is satisfied. This replaces the old six-rung Production
Ladder (Backlog → Sourced → Designed → Built → Proven → Live) and both of
its checkpoints (Design Confirm / Gate 1, Proven Confirm / Gate 2), which
collapse into the same guard shape applied uniformly at every forward step,
plus one additional gate at the very end (the publish gate).

## WHY

The old ladder had two different kinds of advance-confirming machinery
living side by side: the Director Gate (two named human checkpoints,
`Design Confirm` and `Proven Confirm`) and the separately-specced
Auto-Advance Contract (a five-condition self-promotion rule that could
auto-advance a play on an all-pass graded campaign, tagging it
probationary). Which one was canonical for a given play was explicitly
unstated — a recorded hot spot ("two advancement mechanisms").

**This is resolved, not ported forward: the Auto-Advance Contract does not
survive.** There is exactly one guarded-transition mechanism in the new
model. No self-promotion path exists; every forward move — including the
old model's two named gates — is now the *same* mechanism applied at every
state boundary, with one extra guard clause at the last boundary. `Design
Confirm` and `Proven Confirm` are not separate mechanisms anymore; they are
just what the guard looks like when `from` happens to be `drafting` or
`evaluating`, respectively.

## HOW

**States:** `idea → researching → drafting → evaluating → published`, plus
`archived` (a boolean flag, not a stage — see `Economy - Awaiting-Review
Substate` for the `working`/`awaiting-review` substate each state carries).

**Guard table** (`bundle.stage_changed`, checked at append time):

| Transition | Guard |
|---|---|
| forward one state | an approved review of the current state's work — `review.resolved: approve`, recorded since the last `bundle.stage_changed` for the bundle |
| `evaluating → published` | forward guard, **plus** the publish gate: `bundle.gate_decided: { gate: "publish", decision: "approved" }` recorded since the last stage change |
| backward (any → earlier state) | always legal, but requires a non-empty `reason` — regression is a modeled fact (evals regress, models change), not an embarrassment, never blocked |
| any ↔ `archived` | `bundle.archived` / `bundle.restored` — off/on the active board, reversible |
| `override: true` | always allowed regardless of guards — the escape hatch for station-less bundles (imported skills, quick captures) |

A transition also fails if the request's `from` doesn't match the bundle's
current folded stage (stale-state rejection) or if a forward move tries to
skip more than one state.

The per-station **review pair** (`review.requested` / `review.resolved`,
[inherited] non-blocking — see `../runs/Mechanism - Review Pair`) is
what supplies the ordinary forward guard; the **publish gate**
(`bundle.gate_decided`) is a second, terminal-only decision distinct from
any review — "N review pairs (one per state) + one terminal gate" replaces
the old "two gates, both Director."

Verified: `packages/core/src/Machine.ts`'s `checkTransition` implements
exactly this guard table — forward requires `hasApprovedReviewAfter`
(`review.resolved` with `decision: "approve"` for the `from` state, after
the last `bundle.stage_changed`); `evaluating → published` additionally
requires `hasApprovedGateAfter` (`bundle.gate_decided` with `gate:
"publish"`, `decision: "approved"`); backward transitions require a
non-empty `reason`; `override: true` bypasses all guards; stale `from` and
non-adjacent forward jumps are both rejected. No auto-advance / self-
promotion code path exists anywhere in `Machine.ts`.
