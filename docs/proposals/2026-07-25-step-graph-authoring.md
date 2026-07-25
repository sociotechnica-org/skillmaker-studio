# Proposal: Step-Graph Authoring — Skills as Steps, SKILL.md as the Render

*Proposal — Jess × Raven, 2026-07-25, out of the PMS click-through.
Status: **draft for discussion** — not ruled. Deliberately written for the
Danvers conversation (~2026-08-01): the graph heritage is his, and this
partially revisits a founding cut of the simplification.*

## The idea

Author a skill as a **series of steps** — each step one of:

- **agent** — a model does judgment work (with its own prompt/criteria),
- **software** — a deterministic script/command runs,
- **human feedback** — the person reacts, approves, or redirects,

with edges for the golden path and the off-paths (revision loops,
failure sinks). Then **render the graph out to the flat `SKILL.md`** that
actually installs — prose compiled from structure, the way PMS plays
compile authored moves into a runnable workflow.

## Why (what it buys)

1. **Play Walk — the skill as a story.** PMS's strongest presentation: one
   run end-to-end, per-move cards with "the story" and "the machinery" as
   two lenses, golden path + tone-colored branch callouts. Impossible to
   derive reliably from freeform prose; trivial from structure.
2. **"The play, drawn."** A diagram of the skill (postponed until the
   format exists, but this is the door).
3. **Structure-aware everything else:** Preflight checks become graph
   checks (every step reachable, no dead ends, loops bounded — PMS runs
   exactly these); diffs between versions become step diffs; evals can
   target steps; William can draft step-by-step instead of
   one-giant-prose-pass.
4. **Authoring honesty.** Most real skills already *are* sequences with
   branches — to-tickets is literally "gather → explore → draft → quiz →
   publish" with a revision loop. The prose flattens structure the author
   had in mind anyway.

## The tension (said out loud)

The simplification's founding cut was **fabro workflows → flat skills**
(D1-era, "60% too large"). This proposal walks part of that road back.
The defensible line: what was cut was a *runtime* — orchestration,
gates, execution machinery. What's proposed is an *authoring and
presentation layer*: the runtime remains "an agent reads SKILL.md."
This fits the house's deepest ruling — **D4c: SKILL.md is an output of
the bundle, not the bundle** — by giving the projection a structured
source. But the burden of proof sits with the proposal: if the graph
format grows gates, execution semantics, or its own runner, we have
rebuilt fabro and should say so.

## Sketch (to be designed, not yet ruled)

- A structured source in the bundle (working name `steps.yaml` or a
  structured section of `design.md` — **open question**): steps with
  `kind: agent|software|human`, prose per step, edges with conditions.
- `skillmaker` compiles it to `SKILL.md` deterministically (the render is
  reviewable; hand-edits to SKILL.md either forbidden or round-tripped —
  **open question, the hard one**).
- Versions snapshot both source and render (snapshot store already
  landed).
- Skills without a graph stay legal forever: flat SKILL.md remains a
  first-class citizen; the graph is opt-in richness.
- The Skill page gains Walk (story view) and, later, Drawn (diagram).

## What it changes if adopted

- **Drafting**: William authors steps, not one prose block → his prompts
  (queued workstream) should anticipate this.
- **Review**: step-level review becomes possible (PMS's per-move cards).
- **Evals**: claims can bind to steps; Preflight gains graph checks.
- **Publish/versions**: the render is what installs; the source is what's
  edited — drift gets a second meaning (source vs render) to keep honest.

## Open questions for the ruling

1. Source-of-truth format and location (new file vs design.md section)?
2. Hand-edit policy on the rendered SKILL.md (forbid / round-trip / warn)?
3. Migration: do existing flat skills ever need graphs? (Proposed: no —
   opt-in only.)
4. How far is *too* far — the explicit fabro line: no gates, no runner,
   no execution semantics in the format. Agree?
5. Does this land before or after the from-scratch user test and the
   stage-model verdict? (Proposed: after — one identity question at a
   time.)
