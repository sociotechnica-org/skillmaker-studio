---
bundle: william-research-a-skill
---
# Design — William Research A Skill

## Intent

Skillmaker Studio's `researching` station needs an agent that can gather
what a not-yet-built skill should know before anyone tries to draft its
`design.md`'s `## The workflow`/`## Failure hypotheses` sections or its
`output/SKILL.md`. This is William's second skill: the skill that
researches skills. It exists so the `researching` station in every
bundle's `stations.json` has a real, working agent behind it, matching
`william-draft-skill-md`'s role in the `drafting` station -- both are real
Skill Bundles in this self-hosted workspace, not placeholder slugs (Phase
19, plan.md).

The skill produces for: any Skill Bundle author who has a topic in mind
(a rough idea of what the skill should do) but hasn't yet worked out the
concrete facts, conventions, edge cases, or prior art the skill will need
to get right -- including a solo human working through the CLI, and the
Skillmaker Studio `researching` station itself, running headless via
`StationEngine.runStation`.

## When to use / triggers

Use this skill when you are handed a bundle's topic (a slug and a short
description of what the skill is supposed to do -- from `bundle.json`'s
`name`/`oneLiner`, and any existing scaffold content already in
`design.md`) and asked to research it: gather the facts, conventions, and
gotchas a correct skill would need to know, and write them to
`research/notes.md` in the target bundle. Concretely: the station engine
seeds a sandbox with the target bundle's current `design.md` and
`bundle.json`, and asks this skill's agent to research the topic and write
`research/notes.md`, optionally addressing revise notes from a prior
review round.

Do not use this skill to draft `output/SKILL.md` (that is the `drafting`
station's job -- `william-draft-skill-md`) or to write eval fixtures (that
is the `evaluating` station's job). This skill's only output is
`research/notes.md` -- it does not touch `design.md` itself, even though
its findings are meant to feed whoever writes `design.md`'s `## The
workflow` and `## Failure hypotheses` sections next.

## The workflow

1. **Read `bundle.json` and `design.md` in the current directory.** If
   `bundle.json`'s `oneLiner` is empty AND `design.md`'s `## Intent`
   section is empty or still just the scaffold's HTML comments, stop: do
   not write `research/notes.md`. Say so plainly in your final message
   instead ("there's no topic here yet to research -- bundle.json's
   oneLiner and design.md's Intent are both empty") -- an honest no-op
   beats invented research with nothing real behind it.

2. **Check for revise notes.** If the prompt you were given includes a
   "REVISE NOTES:" section, a human reviewer already looked at a previous
   `research/notes.md` draft and asked for something specific (e.g. "dig
   deeper into X", "this missed the actual edge case"). Treat the revise
   notes as your primary instruction for this pass, on top of (not instead
   of) the topic itself.

3. **Check for existing `research/notes.md`.** If one already exists,
   treat it as a first pass to extend or correct, not something to
   discard -- preserve findings that still hold, add what's missing,
   correct what the revise notes call out.

4. **Research the topic using the tools available to you** (reading any
   relevant files already in the workspace, and your own knowledge) and
   write `research/notes.md` with this shape:
   - A one-paragraph restatement of the topic in your own words, so a
     reader can tell you understood the task (not just repeated it).
   - **Facts / conventions the skill needs to get right** -- concrete,
     checkable things (exact strings, exact formats, exact commands), not
     vague guidance. If you are not confident in a fact, say so explicitly
     rather than presenting a guess as settled.
   - **Edge cases and gotchas** -- situations a naive implementation would
     get wrong, framed as "the skill must handle X" or "the skill must
     never do Y", so they translate directly into `design.md`'s eventual
     `## Failure hypotheses` table.
   - **Open questions** -- anything you could not resolve with the
     information available, named explicitly rather than silently
     papered over. It is better to hand off three honest open questions
     than one confident wrong answer.

5. **Do not touch anything outside `research/notes.md`.** The station's
   `produces` list is exactly `["research/"]` -- if you find yourself
   wanting to edit `design.md`, `output/`, or `evals/`, that belongs to a
   different station; leave a note in your final message instead of
   editing it.

6. **Stop once `research/notes.md` reflects your research.** Do not draft
   `design.md` or `output/SKILL.md`, do not write eval fixtures, do not
   advance the bundle's stage -- those are separate, human- or
   `william-draft-skill-md`-gated steps.

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | `bundle.json`'s `oneLiner` and `design.md`'s `## Intent` are both empty, and the agent invents a topic and researches it anyway instead of stopping | IN |
| 2 | Revise notes from a prior review are silently ignored in favor of re-researching from scratch | IN |
| 3 | A stated-but-unconfident fact is written into `research/notes.md` as if it were settled, with no hedge or open-question flag, and a later drafter treats it as ground truth | OUT |
| 4 | The agent edits files outside `research/` (e.g. touches `design.md` or `output/`), which the station engine's copyback filter would then also have to guard against | OUT |
| 5 | `research/notes.md` restates the topic and general platitudes without any concrete, checkable facts or edge cases -- research that reads as if it happened but adds nothing a drafter couldn't have guessed | RE |

## Proof spec

- **golden-basic**: a bundle with a real `bundle.json` `oneLiner` and a
  `design.md` with real `## Intent` content -- expect `research/notes.md`
  with a topic restatement, at least one concrete fact/convention, at
  least one edge case framed as a "must never"/"must handle", and no
  fabricated-but-unconfident facts presented as settled. Covers risk #1
  (positive case) and #5.
- **refusal-empty-topic**: a bundle whose `bundle.json` `oneLiner` is
  empty and whose `design.md` `## Intent` is still the bare scaffold --
  expect no `research/notes.md` written, and a final message that says so
  plainly. Covers risk #1 (negative case). Not yet authored in this pass;
  tracked as a todo alongside `william-draft-skill-md`'s own
  `revise-round` gap.
