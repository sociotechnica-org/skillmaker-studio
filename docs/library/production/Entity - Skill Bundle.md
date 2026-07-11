---
type: Entity
prefLabel: Skill Bundle
context: production
status: migrated
links:
  contains:
    - "./Mechanism - Bundle Stage"
  conforms_to:
    - "./Mechanism - Guarded Transition"
  related_to:
    - "./Economy - Station Doer"
    - "./Economy - Awaiting-Review Substate"
    - "../outputs/Entity - Bundle Output"
    - "../evals/Entity - Fixture"
    - "../runs/Entity - Run"
    - "../runs/Reference - Canonical Store Split"
---

## WHAT

A Skill Bundle (formerly "Play") is the central, durable record the whole
Studio moves: one directory under `skills/<slug>/` holding everything a
skill's development touches — research, design, eval fixtures, output, and
run history. It replaces the old catalog "Play" model: there is no separate
catalog/registry entity, no Division/Function filing, and no Tier. A
bundle's identity is deliberately thin; almost everything else about it
(stage, substate, archived-ness) is journal-derived, not stored as identity.

## WHY

The old Play conflated identity (slug, filing, tier) with mutable status
(stage) in one registry-shaped record. The new model splits that cleanly:
`bundle.json` holds only what's true for the life of the bundle and rarely
changes; everything that changes over time is a journal fact, folded at
read time (see `Mechanism - Bundle Stage`). This is what makes "the board
is a journal replay" true — there is no mutable-in-anger file to drift out
of sync with the journal.

## HOW

`skills/<slug>/bundle.json` — identity only, append-slowly:

```jsonc
{
  "schemaVersion": 1,
  "slug": "frame-the-problem",   // = directory name; kebab-case; immutable
  "name": "Frame the Problem",
  "oneLiner": "Turn a fuzzy founder worry into a testable problem statement.",
  "tags": ["product", "discovery"],   // flat taxonomy (ruling B) — no Division/Function
  "created": "2026-07-10",
  "targets": ["claude-code", "codex"] // advisory: which agents it's written for
}
```

No `stage`, no `ready`, no `status`, no Tier field lives in `bundle.json` —
those are journal-derived (`Mechanism - Bundle Stage`,
`Mechanism - Guarded Transition`). Renames touch `name`; `slug` is forever
because it keys every journal event about the bundle. A bundle also carries
`stations.json` (per-state work config, see `Economy - Station Doer`) and
the rest of the file tree under `skills/<slug>/` (`design.md`, `research/`,
`evals/`, `output/`, `runs/`).

Verified: `packages/core/src/Bundle.ts`'s `BundleIdentity` schema class
(schemaVersion, slug, name, oneLiner, tags, created, targets) matches
data-model.md §2.3 exactly — no stage/ready/status field present; mutable
state is a separate `BundleState` class (slug, stage, substate, archived)
explicitly documented in the same file as "materialized by journal replay
... never stored as a mutable file."
