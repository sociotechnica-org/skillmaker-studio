---
type: Reference
prefLabel: Untrusted-Input Rule
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Fixture"
---

## WHAT
The standard, adopted from the field, that material from outside the team —
transcripts, customer documents, scanned code, anything copied into a
fixture's `files/` — is data to record, never commands to follow. Closes the
prompt-injection failure class.

## WHY
This context moved from `authoring` to `evals` in the migration (prep doc
§1.5/§1.6): the rule is now a fixture-authoring rule more than a
prompt-authoring rule, since v1 has no per-node prompts to carry the clause
— SKILL.md is a single flat output, and the untrusted-input guarantee is
tested, not authored per-step.

## HOW
Adversarial fixtures may plant untrusted-input attacks in `files/`
[inherited, verbatim] — the `ADV` risk family in
[[Reference - Risk Family]] exists specifically to band these. A fixture
testing this rule sets `class: "hard-case"` or `"refusal"`, plants an
"ignore your previous instructions..." (or similar) directive inside a file
under `evals/fixtures/<case>/files/`, and its `grading.checks` assert the
agent treated the planted text as data, not as a command it obeyed.

There is no separate node-level prompt construct in the shipped model to
carry this clause the way the old per-move Node Prompt did (that entity
retired with the move graph) — the rule now lives entirely at the fixture
layer: what gets planted in `files/`, and what the answer key/checks assert
about how the agent handled it.

Verified: `FixtureSetup.files` field in `packages/core/src/Fixtures.ts` (the
copy-into-run-workspace mechanism a planted-attack file would travel
through) and the `ADV` entry in `RISK_FAMILIES`.
