---
type: Concept
prefLabel: Skillmaker Studio
context: _index
status: migrated
links:
  contains:
    - "../production/Entity - Skill Bundle"
    - "../production/Mechanism - Guarded Transition"
    - "../production/Mechanism - Bundle Stage"
    - "../production/Economy - Awaiting-Review Substate"
    - "../production/Economy - Station Doer"
    - "../production/Reference - Harden Interview Pattern"
  related_to:
    - "../board/Surface - Board"
    - "../authoring/Entity - Design Doc"
    - "../evals/Entity - Fixture"
    - "../outputs/Entity - Bundle Output"
    - "../runs/Entity - Run"
---

## WHAT

Skillmaker Studio lets a Director build and ship reliable agent skills by
growing a **Skill Bundle** — the durable asset (research, design thinking,
eval fixtures, runs, and status) — through a five-state production machine
(`idea → researching → drafting → evaluating → published`, plus `archived`).
**`SKILL.md` is one of a bundle's outputs, not the bundle itself**: a
distributable projection the bundle produces, tracks, and measures, but is
never reducible to. A bundle can be re-drafted, re-evaluated, and
re-published many times over its life; the bundle is what persists.

## WHY

Two things replace the old Playmaker's Studio wager ("the Director never
reads code, every checkpoint emits a plain-English artifact"):

- **Agent-first production.** Stations default to agent doers, executed as
  ACP subprocess runs — a skill bundle's own `researching`/`drafting`/
  `evaluating` work is done by agents (including the product's own agent,
  William) rather than authored by a human line-by-line. The Director's
  judgment is spent on review and the publish gate, not on writing prose
  artifacts by hand.
- **Graded read-out honesty, not code-avoidance.** The magic that's kept
  from the old model isn't "never touch code" — it's the graded read-out: a
  human-in-viewer grading surface that joins the risk-map coverage axis
  against measured runs and refuses to claim "proven" until graded evidence
  exists at the current version. "Not yet measured" is the honest default
  until a human has actually graded runs at that version.

## WHERE

Skillmaker Studio is **self-hosted**: this repo's own `skills/` +
`.skillmaker/` is a real Skillmaker workspace, developed in the product it
builds, with real shared journal history from day one (the
Alexandria-Prime pattern). The viewer surface is `skillmaker start` (see
`skillmaker.config.json`'s `viewer.port`). Product-knowledge cards for the
Studio itself live here under `docs/library/`, organized by target context:
`production/` (the state machine and its guards), `board/` (todos + viewer
board), `authoring/` (`design.md`, Director/Grader roles), `evals/` (risk
maps, fixtures, eval runs), `outputs/` (`SKILL.md`, versions, drift, the
skillbook), and `runs/` (the journal, run records, the ACP provider, the
review pair). Start at `production/Mechanism - Guarded Transition` for the
state machine, or `production/Entity - Skill Bundle` for the central
record.

## HOW

Concretely, per `skillmaker.config.json`: a workspace tracks `skills/<slug>/`
bundles and a `.skillmaker/events.jsonl` journal (git-tracked,
`merge=union`). See `production/Entity - Skill Bundle` for the identity
schema and `production/Mechanism - Guarded Transition` for the state
machine's guard table.

Verified: reworked WHAT/WHY against data-model.md §1.0 (one-sentence model),
§1.2 ruling E (graded read-out), and §2.13 (agent-first stations, William);
cross-checked the self-hosting claim against `skillmaker.config.json`'s
presence at the workspace root and Part 3's "Self-hosting" ruling.
