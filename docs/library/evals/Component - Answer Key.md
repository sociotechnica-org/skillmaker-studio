---
type: Component
prefLabel: Answer Key
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Fixture"
    - "./Entity - Read-Out"
---

## WHAT
The grading material a fixture carries under `expected/` — written when the
fixture is built, blind to any run, and never passed as input to the agent.
When grader variance appears, suspect the key before the doers.

## HOW
`skills/<slug>/evals/fixtures/<case>/expected/answer-key.md` (or whatever
path `case.json`'s `grading.answerKey` names). Grading-only, never enters
the agent's workspace — verbatim inherited rule, restated in
`packages/core/src/Fixtures.ts`'s `FixtureGrading` schema comment
("Grading-only; never enters the agent's workspace [inherited]") and
enforced structurally: `RunEngine.runFixture` copies `setup.files` into the
sandboxed run workspace, never `expected/`.

An Answer Key lives inside an [[Entity - Fixture]] and is what the human
grader checks the [[Entity - Read-Out]] against, via the grading panel's
`grading.checks` checklist plus free-text notes — never what the run
consumes.

Verified: `FixtureGrading` class in `packages/core/src/Fixtures.ts`
(`answerKey?`, `checks?`) and `scanFixtures`'s check that a declared
`grading.answerKey` path actually exists on disk (warning if not).
