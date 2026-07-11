---
type: Role
prefLabel: Grader
context: authoring
status: migrated
links:
  operates_on:
    - "../evals/Entity - Read-Out"
  related_to:
    - "../evals/Capability - Eval Run"
    - "./Role - Director"
---

## WHAT
The human who grades a run's transcript in the viewer's read-out surface
and records a verdict. Director ruling E is explicit: "human-in-viewer from
day one — the graded read-out experience is core magic to port." The old
model's Grader was a fresh-eyes *agent* — blind to other graders, grading
against an answer key, never its own taste. That agent role does not
survive: grading is a human action in v1, full stop.

## WHY
The read-out is the ported magic, not the grading agent. What matters is a
human looking at a run against the risk-map coverage axis, the fixture's
`grading.checks` checklist, and the answer key (grading-only, never in the
agent's workspace) — and recording an honest verdict, not that the
comparison was performed by a second, isolated agent.

## HOW
Grading happens two ways into the same journal ("two doors, one journal"):
the viewer's grading panel, and the CLI door `skillmaker grade <slug>
<runId> --verdict pass|fail|partial [--notes <text>]`. Both append a single
`run.graded` event (verdict + optional notes). A run must be
`status: "completed"` to be graded — infra-error or still-running runs are
refused, since they carry no task-level verdict. Grading is idempotency-key-
free: a regrade is a genuinely new event, and the latest one wins at fold
time.

The read-out itself is a **viewer surface, not a stored artifact**
(`../evals/Entity - Read-Out`): for a chosen (bundle, version) it joins the
risk-map coverage axis and the measurements view per provider/model, lists
runs per fixture with transcript + artifacts inline, and offers the
grading panel.

**Honest gap:** the old blind-agent-grader pattern (fresh-eyes agent,
isolated from other graders, comparing against an answer key with no taste
of its own) has no stated home in the new model — the prep doc flags this
with a ⚠ open question, and nothing in `data-model.md` or the shipped code
resolves it. This card leaves it as an open gap rather than inventing a
successor.

What *does* exist, and is easy to mistake for a revival of agent grading,
is `packages/core/src/GraderSelfCritique.ts` — but it is not an agent
grader. It is a reindex-time analysis over already-human-graded runs: for
each `(bundle, fixtureCase, check text)` group with at least
`MIN_GRADED_RUNS_FOR_SELF_CRITIQUE` (2) graded runs, it flags checks that
passed on *every* graded run or failed on *every* graded run as
"non-discriminating" — a check that never distinguishes good runs from bad
ones. It never blocks a run or a grade (ruling I: warnings, never
hard-fails); it only surfaces as a reindex warning alongside fixture and
risk-map coverage warnings, so a human can reconsider a check's wording.
No agent evaluates transcripts under this mechanism — it purely
post-processes verdicts a human already recorded.

Verified: read `packages/cli/src/commands/Grade.ts` in full — confirms the
CLI signature, the `pass|fail|partial` verdict enum, the `completed`-only
gate, the `run.graded` journal event shape, and the no-idempotency-key
"latest wins" regrade behavior described above. Also read
`packages/core/src/GraderSelfCritique.ts` in full — confirms it operates
only on human-recorded `GradedRunChecks` input (no LLM/agent call anywhere
in the file) and produces reindex warnings, not grading decisions.
