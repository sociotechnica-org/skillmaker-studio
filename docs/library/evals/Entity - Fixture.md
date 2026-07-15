---
type: Entity
prefLabel: Fixture
context: evals
status: migrated
links:
  contains:
    - "./Component - Answer Key"
  conforms_to:
    - "./Reference - Fixture Kit"
  related_to:
    - "./Capability - Eval Run"
    - "./Reference - Untrusted-Input Rule"
    - "./Reference - Measurements Bind To Version"
    - "../outputs/Entity - Field Report"
---

## WHAT
A behavior case bought by failure class, not difficulty — each fixture earns
its place by exposing a failure mode no other does. One directory per case,
holding the task prompt, any workspace input files, and (optionally) grading
material.

## WHY
Fixtures are the unit the whole eval surface is built on: a fixture case is
what an [[Capability - Eval Run|eval run]] runs, what a
[[Entity - Risk Map|risk-map]] row cites for coverage, and what a graded
read-out groups by.

## HOW
Lives at `skills/<slug>/evals/fixtures/<case>/`. The directory name is the
case name, and it must match `case.json`'s `case` field (mismatch is a
reindex warning, not a hard failure).

`case.json` shape (per `packages/core/src/Fixtures.ts`):

```jsonc
{
  "schemaVersion": 1,
  "case": "refusal-thin-input",
  "class": "refusal",
  "risks": ["RE-1", "IN-2"],
  "setup": { "files": "files/", "env": {} },
  "grading": { "answerKey": "expected/answer-key.md", "checks": ["..."] }
}
```

`source` is an optional fifth top-level field (issue #68, [[Entity - Field
Report]]'s harvest mechanism): `{"kind": "field-report", "eventId": "...",
"destination"?: "..."}`, present only on a fixture `skillmaker fixture
harvest` pulled from a `skill.field_report` event -- absent on every
hand-scaffolded (`fixture add`) case, so every `case.json` written before
harvest existed keeps validating unchanged.

Deviation from data-model.md §2.5 as written: the task prompt does **not**
live in `case.json`'s `prompt` field — it lives in a sibling `prompt.md`
(prose). A legacy `prompt` string in `case.json` is tolerated and produces a
reindex warning suggesting the move to `prompt.md`, never a hard failure
(Part 3 ruling I). `scanFixtures` reads fields defensively rather than a
strict schema decode, specifically so malformed fixtures degrade to
warnings instead of dropping the whole case.

A Fixture conforms to the [[Reference - Fixture Kit]] (its `class` is one of
the kit's enum values) and may carry a [[Component - Answer Key]] under
`expected/`; it is consumed by a [[Capability - Eval Run]]. An
untrusted-input fixture plants the [[Reference - Untrusted-Input Rule]] test
in `files/`.

Verified: `packages/core/src/Fixtures.ts` — `FixtureCase` schema
(`schemaVersion`, `case`, `class`, `risks`, `setup?`, `grading?`, legacy
`prompt?`, `source?`) and `scanFixtures`'s field-by-field tolerant parsing,
including the "case.json has a legacy prompt field", "prompt.md is
missing", and "case.json has a malformed source field" warnings.
