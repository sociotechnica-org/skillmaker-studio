---
type: Entity
prefLabel: Bundle Output
context: outputs
status: new
links:
  contains:
    - "./Entity - Skill Version"
  related_to:
    - "./Mechanism - Drift Hint"
    - "./Mechanism - Publish"
    - "../production/Entity - Skill Bundle"
    - "../authoring/Entity - Design Doc"
---

## WHAT

`output/` is the flat, hand-editable directory under a Skill Bundle
(`skills/<slug>/output/`) that holds the bundle's distributable
artifact(s) — first and foremost `output/SKILL.md`, a standard agent
skill file (YAML frontmatter `name`/`description` + a body of
instructions), plus any sibling resources (scripts, references) the
skill bundles alongside it. There is no compile step and no separate
source format that `output/` is generated from mechanically — a station
agent (or a human) writes `output/SKILL.md` directly, and it can be
hand-edited afterward with no tooling objection (see `Mechanism - Drift
Hint`).

## WHY

This is a deliberate simplification of the old model's **Entity -
Workflow Package** (`workflow.fabro` + a `prompts/` directory of
per-move prompt files + a run config) — that source card lives in
another worker's `authoring/` assignment, which retires it outright, so
treat this card as the conceptually-superseding replacement, not a
migration of that card's content. The old package was a *compiled*
artifact: a move graph plus per-node prompts, assembled by a "derive"
step from the Brief. The new model drops the move graph and the derive
step entirely (data-model.md §1.1: "Deliberately dropped... move graph +
derived renderings"). `output/` is just files a skill-writing agent (or
a human) produces once and can keep touching — "outputs are produced
(and may be hand-finished)" (data-model.md §1.1, inherited law 2).
Future output *kinds* (e.g. a Fabro workflow returning as an additional
kind) can live as siblings under `output/` without changing this
entity's shape (data-model.md §2.7).

## HOW

Path: `skills/<slug>/output/SKILL.md` (+ any sibling files/dirs under
`output/`). `SKILL.md` frontmatter carries `name` (the bundle's slug)
and `description` (what makes an agent's tool-selection layer pick this
skill), followed by a body written in direct second-person instructions
to the agent that will run the skill.

The bundle's default drafting station (`stations.json`'s `drafting`
entry, `skill: "william/draft-skill-md"`) runs an agent that reads
`design.md` and writes/updates `output/SKILL.md` from it — but this is
station work, not a build step: nothing recomputes `output/` from
`design.md` automatically, and a human may edit `output/SKILL.md`
directly at any time (drift is then surfaced, not blocked — see
`Mechanism - Drift Hint`).

Verified against a real shipped output at
`skills/william-draft-skill-md/output/SKILL.md` — its own frontmatter is
exactly `name: william-draft-skill-md` / `description: <one sentence>`,
followed by a plain numbered-instructions body, no compiled sections, no
move-graph artifacts, confirming `output/` really is the flat
single-file (plus room for siblings) shape data-model.md §2.7 describes.
