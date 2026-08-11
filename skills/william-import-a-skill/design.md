---
bundle: william-import-a-skill
---
# Design — William Import A Skill

## Intent

Take a skill that already exists somewhere else and bring it into our format —
without silently reshaping the maker's work.

Importing is not writing from scratch, and treating it as such is the failure
mode. The facts are already there; the job is to find them, put them where our
four pieces expect them, and then **show the delta**: what was added, what
moved, what was left alone.

Much of the machinery exists. `skillmaker adopt` discovers `SKILL.md` files
anywhere under a root and wraps each containing directory as a bundle IN
PLACE — no files moved, the repo's own layout untouched. `adopt --triage`
writes `adopt-manifest.md`, a table the maker edits by hand, whose Job /
Out-of-scope / Basis columns seed the dossier. This skill is the agent half of
that: the part that reads what's there and proposes the fill.

## When to use / triggers

Use when a bundle was adopted in place and its four pieces are empty or
scattered, or when a maker points at a directory of existing skills and wants
them brought in.

## The workflow

<!-- Unwritten on purpose. Open questions the maker has to settle first: does
     an import propose and wait, or write and diff? Is the delta a report, a
     surface, or a review card? What happens to prose that fits no piece? -->

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | Rewrites the maker's own words while "reformatting" | OUT |
| 2 | Reports no delta, so the maker can't see what happened to their work | OUT |
| 3 | Drops content that fit none of the four pieces | OUT |
| 4 | Moves or edits files outside the studio-owned set, breaking the in-place promise | ADV |

## Proof spec

<!-- Follows the workflow. -->
