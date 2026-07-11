---
type: Reference
prefLabel: Harden Interview Pattern
context: production
status: migrated
links:
  related_to:
    - "./Economy - Station Doer"
    - "../authoring/Entity - Design Doc"
    - "../_index/Role - William"
---

## WHAT

A fresh-eyes interview pattern for attacking a design document's content
and shape one question at a time, before it's treated as settled: three
questions (Outcome / Reasoning / Breakdown) plus a state audit (does every
step name what it consumes and emits). This is guidance a station skill's
author can adopt when writing that station's skill description — it is
**not** a standing studio-core mechanism or a dedicated pipeline step
anymore.

## WHY

In the old model, Harden was a named step in the ladder (README "The loop"
Step 2) performed by a standing Role, the Hardener — a distinct agent
persona that interviewed every brief before the Design Confirm gate. The
new production model has no separate "harden" phase or role: a bundle's
`researching` or `drafting` station either does or doesn't build this kind
of adversarial self-check into its own skill's workflow. There is no
mechanism forcing it to happen; it survives only as a technique available
to whoever writes a station's skill (e.g. William, for `researching` or
`drafting` stations).

## HOW

The three-question interview plus state audit, portable to any
`design.md`-facing skill's own `## The workflow`:

1. **Outcome** — what result is this design actually claiming to produce?
2. **Reasoning** — why does the author believe the proposed approach gets
   there?
3. **Breakdown** — does the step-by-step logic hold together, or does it
   skip a beat?
4. **State audit** — for every step in "The workflow", can you name what
   it consumes and what it emits? A step that can't be pinned down this way
   is a soft spot.

A station's skill (a `design.md` under `skills/<slug>/`, per
`Entity - Skill Bundle`) can write this pattern directly into its own
`## The workflow` section as a self-check the station-agent runs before
handing work to `review.requested` — William's shipped
`skills/william-draft-skill-md/design.md` is a concrete example of a
station skill with an explicit "stop and say so" failure-hypothesis
discipline in the same spirit, though it does not name this pattern by
name.

Verified: cross-checked against `skills/william-draft-skill-md/design.md`'s
`## Failure hypotheses` / `## The workflow` sections, which apply an
analogous fresh-eyes discipline (explicit stop conditions, "an honest no-op
beats a fabricated skill") without naming a formal Harden step — supporting
the card's claim that this pattern now lives as station-skill guidance, not
studio-core machinery.
