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
    - "../machine/Mechanism - Machine Registry"
    - "../machine/Entity - Registered Project"
    - "../brand/Concept - LifeBuild Brand"
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
Alexandria-Prime pattern). Since the machine-registry re-architecture
(director rulings 2026-07-27), the viewer surface is `skillmaker start`
serving **per machine, not per workspace**: it ignores cwd entirely, reads
the project list from `~/.skillmaker-studio/config.json` (the
[[../machine/Mechanism - Machine Registry|machine registry]]), and serves
every [[../machine/Entity - Registered Project|registered project]] at
`/api/projects/:project/...`. An empty registry starts fine — the UI can
add the first project. Product-knowledge cards for the Studio itself live
here under `docs/library/`, organized by target context: `production/`
(the state machine and its guards), `board/` (todos + viewer board),
`authoring/` (`design.md`, Director/Grader roles), `evals/` (risk maps,
fixtures, eval runs), `outputs/` (`SKILL.md`, versions, drift, the
skillbook), `runs/` (the journal, run records, the ACP provider, the
review pair), and `machine/` (the registry, projects, the hosted-ASAP
intent). Start at `production/Mechanism - Guarded Transition` for the
state machine, or `production/Entity - Skill Bundle` for the central
record.

## HOW

Concretely, per `skillmaker.config.json`: a workspace tracks `skills/<slug>/`
bundles and a `.skillmaker/events.jsonl` journal (git-tracked,
`merge=union`). Per-project data stays IN the project directory; the
machine registry is only a list of paths. Stations' default skills
(William's bundles) no longer need to be hand-carried into every
workspace: the station engine resolves a station's skill from the
workspace first, falling back to the product-packaged copies
([[../production/Mechanism - Packaged Station Skills]]). See
`production/Entity - Skill Bundle` for the identity schema and
`production/Mechanism - Guarded Transition` for the state machine's guard
table.

Verified: reworked WHAT/WHY against data-model.md §1.0 (one-sentence model),
§1.2 ruling E (graded read-out), and §2.13 (agent-first stations, William);
cross-checked the self-hosting claim against `skillmaker.config.json`'s
presence at the workspace root and Part 3's "Self-hosting" ruling. WHERE
re-verified 2026-08-03 against `packages/cli/src/commands/Start.ts` (doc
comment: "serves the REGISTRY ONLY: it ignores cwd entirely";
`DEFAULT_START_PORT = 4323` — the registry has no per-machine port config,
so `viewer.port` no longer governs `start`) and
`packages/core/src/MachineConfig.ts` (`~/.skillmaker-studio/config.json`,
`SKILLMAKER_STUDIO_HOME` override); packaged-fallback claim against
`packages/cli/src/PackagedSkills.ts` and `StationEngine.ts`'s
`resolveStationSkillDir` (workspace wins, packaged is fallback).
