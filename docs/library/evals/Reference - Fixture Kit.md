---
type: Reference
prefLabel: Fixture Kit
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Fixture"
    - "./Entity - Risk Map"
---

## WHAT
The standard set of fixture classes a bundle's `case.json` may declare:
`golden | refusal | empty | rerun | hard-case` — the inherited five — plus a
sixth, `trigger`, added later (Phase 12) for testing whether a skill
self-activates rather than whether it performs the task correctly. Each
class buys a distinct failure mode; unknown classes are reindex warnings.

## HOW
The enum is `FIXTURE_CLASSES` in `packages/core/src/Fixtures.ts`:
`["golden", "refusal", "empty", "rerun", "hard-case", "trigger"]`, cited
verbatim in `case.json`'s `class` field. A `class` value outside this set
produces a reindex warning ("has unknown class ... expected
golden|refusal|empty|rerun|hard-case|trigger"), never a hard failure.

`trigger` is distinct in kind from the other five: its `prompt.md`
deliberately does not name the skill by slug, and grading asks "did the
skill activate on its own?" (does the run transcript contain a `Skill`
tool_call for the bundle) rather than "did the agent do the task
correctly." That grading primitive (`didSkillActivate`) lives alongside
`RunEngine`; full trigger-rate aggregation across fixtures is out of scope
for the current shipped model (measurements still aggregate per-fixture,
§2.11).

The kit is the standard each [[Entity - Fixture]] case conforms to; its
coverage seeds the bundle's [[Entity - Risk Map]].

**Cold-Reader Gate resolution (prep doc open question 3):** the old
studio's Cold-Reader Gate — a fresh agent reads an artifact cold and must
reconstruct context with no other briefing — has no standing mechanism in
the shipped model, and needs none. A cold-reader class can be authored as
an ordinary fixture case whose `grading.checks` assert the agent
reconstructed context correctly with no other briefing — no separate
mechanism is required. This resolves the prep doc's ⚠ open question:
fold it into the Fixture Kit as a *pattern* for how to write
`grading.checks`, not as a seventh entry in `FIXTURE_CLASSES`.

Verified: `FIXTURE_CLASSES` array and the "unknown class" / trigger-related
comments in `packages/core/src/Fixtures.ts`.
