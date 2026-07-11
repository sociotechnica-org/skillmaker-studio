---
type: Role
prefLabel: Director
context: authoring
status: migrated
links:
  related_to:
    - "../production/Mechanism - Guarded Transition"
    - "./Entity - Design Doc"
    - "./Role - Grader"
---

## WHAT
The human who owns intent and judgment over a Skill Bundle: picks what gets
built, clarifies purpose and constraints, and is the approving party at
every guarded transition — both the per-station forward advance and the
terminal publish gate. Every artifact along the way (`design.md`,
`output/SKILL.md`, fixtures) is agent-drafted from the Director's intent
and approved by the Director, never Director-authored.

## WHY
Unchanged from the old model: the studio is agent-first in execution but
human-gated in judgment. Stations default to agent doers (§2.13), but
forward progress is never automatic — a station's work only advances the
bundle once a human has looked at it. This keeps the Director as the
single point of "does this actually satisfy the intent," distinct from the
mechanical work of producing drafts.

## HOW
The old Board's single "▸ advance" confirm button splits into two distinct
journal-backed mechanisms the Director operates in the viewer:

- **The per-station review pair** (non-blocking, `../production/Mechanism
  - Guarded Transition`): a station's agent finishes a unit of work and
  emits `review.requested`, putting the bundle into the `awaiting-review`
  substate. The Director resolves it in the viewer with `review.resolved`:
  `approve` satisfies the forward guard for that state (`bundle.stage_changed`
  requires `review.resolved: approve` for the current state since the last
  stage change); `revise` attaches notes that become the agent's next
  instruction at the same station, without advancing anything. Human gates
  are data, never a blocked process — the agent's turn simply ends.
- **The publish gate**: `evaluating → published` requires an *additional*
  guard beyond an approved review — `bundle.gate_decided: approved`
  (Director ruling C, "one publish gate"). This is the one remaining
  terminal confirm, distinct from every other forward transition.
- Backward transitions (any state to an earlier one) are always legal and
  require no Director guard at all — journaled with a reason, since
  regression (evals regress, models change) is a modeled fact, not an
  embarrassment needing approval.

Both guards are enforced at journal-append time by the state machine
(`packages/core/src/Machine.ts`), not by viewer convention alone.

Verified: `packages/core/src/Machine.ts` — forward-transition guard text
reads `"forward transition from ... requires an approved review
('review.resolved' with decision 'approve' for state ... ) recorded since
the last stage change"`, and the publish guard reads `"publishing requires
an approved publish gate decision ('bundle.gate_decided' with gate
'publish', decision 'approved') recorded since the last stage change"` —
both guards exist in the shipped code exactly as described above.
