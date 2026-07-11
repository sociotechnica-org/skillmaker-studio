---
bundle: william-draft-skill-md
---
# Design — William Draft Skill Md

## Intent

Skillmaker Studio's `drafting` station needs an agent that can turn a bundle's
`design.md` (a human-authored intent + workflow document) into a working
`output/SKILL.md` (the actual skill content an agent installs and runs with).
This is William's first skill: the skill that drafts skills. It exists so the
`drafting` station in every bundle's `stations.json` has a real, working agent
behind it rather than a placeholder skill slug -- the walking-skeleton
requirement from plan.md Phase 10 ("from a bare `skillmaker new`, drive a
bundle to a drafted SKILL.md entirely through agent stations + viewer
reviews") depends on this skill actually working, not just existing.

The skill produces for: any Skill Bundle author who has written (or is
revising) a `design.md` and needs a first-cut `SKILL.md`, including a
solo human working through the CLI, and the Skillmaker Studio `drafting`
station itself, running headless via `StationEngine.runStation`.

## When to use / triggers

Use this skill when you are handed a bundle's `design.md` (and, if it
exists, prior review "revise" notes) and asked to produce or update
`output/SKILL.md`. Concretely: the station engine seeds a sandbox with the
current `design.md` and `output/SKILL.md` (if any already exists) and asks
this skill's agent to draft/update `output/SKILL.md`, optionally addressing
revise notes from a prior review round.

Do not use this skill to research a topic from scratch (that is the
`researching` station's job -- `design.md`'s `## Intent` and
`## The workflow` sections should already exist, even if thin) or to write
eval fixtures (that is the `evaluating` station's job).

## The workflow

1. **Read `design.md` in the current directory.** If it does not exist, or
   its `## Intent` and `## The workflow` sections are empty or still just
   the scaffold's HTML comments with no real content, stop: do not write
   `output/SKILL.md` at all. Say so plainly in your final message instead
   ("design.md doesn't have enough content yet to draft a SKILL.md") --
   an honest no-op beats a fabricated skill.

2. **Check for revise notes.** If the prompt you were given includes a
   "REVISE NOTES:" section, treat it as the primary instruction for this
   pass: a human reviewer already looked at a previous `output/SKILL.md`
   draft and asked for something specific. Address the revise notes
   directly, in addition to (not instead of) staying faithful to
   `design.md`.

3. **Check for an existing `output/SKILL.md`.** If one already exists,
   treat it as a first draft to revise, not something to discard and
   rewrite from nothing -- preserve any parts that still match
   `design.md`'s current `## Intent` / `## The workflow`, and rewrite only
   what has drifted or what the revise notes call out.

4. **Draft `output/SKILL.md` with this shape:**
   - YAML frontmatter: `name` (the bundle's slug, kebab-case) and
     `description` (one or two sentences an agent's tool-selection layer
     will read to decide whether this skill is relevant -- write it from
     `design.md`'s `## When to use / triggers` section, since that section
     exists specifically to seed this).
   - A body written as direct, second-person instructions to the agent
     that will run this skill -- not prose *about* the skill, prose *to*
     the agent doing the work. Translate `design.md`'s `## The workflow`
     into concrete numbered steps. Carry over every "must never" /
     "always stop and ask" constraint from `## Failure hypotheses`
     explicitly -- those exist because someone already thought through a
     way this skill goes wrong, and a SKILL.md that omits them silently
     reintroduces the failure.
   - Keep it as short as it can be while remaining unambiguous. A SKILL.md
     is read by an agent under token pressure, not by a human skimming
     documentation -- prefer a tight numbered procedure over an essay.

5. **Do not touch anything outside `design.md` and `output/SKILL.md`.** The
   station's `produces` list is exactly `["design.md", "output/SKILL.md"]`
   -- if you find yourself wanting to edit `research/` or `evals/`, that
   belongs to a different station; leave a note in your final message
   instead of editing it.

6. **Stop once `output/SKILL.md` reflects `design.md`.** Do not run the
   skill, do not write eval fixtures, do not advance the bundle's stage --
   those are separate, human-gated steps (the `evaluating` station and the
   viewer's review-pair loop).

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | `design.md` has no real `## Intent`/`## The workflow` content yet, and the agent fabricates a plausible-sounding SKILL.md anyway instead of stopping | IN |
| 2 | Revise notes from a prior review are silently ignored in favor of just re-deriving from `design.md` | IN |
| 3 | The agent rewrites `output/SKILL.md` wholesale instead of preserving still-valid parts of a prior draft, discarding earlier reviewer-approved phrasing for no reason | OUT |
| 4 | The agent omits a `## Failure hypotheses` constraint (a "must never") when translating `design.md` into `output/SKILL.md`, silently reintroducing a known failure mode | ADV |
| 5 | The agent edits files outside `design.md`/`output/SKILL.md` (e.g. touches `research/` or `evals/`), which the station engine's copyback filter would then also have to guard against | OUT |

## Proof spec

- **golden-basic**: a bundle with a fully fleshed-out `design.md` (real
  Intent, workflow, and at least one failure hypothesis) and no existing
  `output/SKILL.md` -- expect a `SKILL.md` with matching frontmatter
  `description` and a body that reflects the workflow and carries the
  failure hypothesis's constraint. Covers risk #1 (positive case) and #4.
- **refusal-empty-design**: a bundle whose `design.md` is still the bare
  scaffold (empty `## Intent`/`## The workflow`) -- expect no
  `output/SKILL.md` written, and a final message that says so plainly.
  Covers risk #1 (negative case).
- **revise-round**: a bundle with an existing `output/SKILL.md` and a
  revise-notes prompt asking for a specific change (e.g. "the description
  is too vague, name the exact trigger phrase") -- expect the redrafted
  `SKILL.md` to address that change while leaving the rest of the prior
  draft recognizably intact. Covers risk #2 and #3.
