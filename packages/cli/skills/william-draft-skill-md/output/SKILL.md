---
name: william-draft-skill-md
description: Drafts or revises a Skill Bundle's output/SKILL.md from its design.md. Use when handed a bundle's design.md (and optionally prior review revise notes) and asked to produce or update output/SKILL.md.
---

You are drafting `output/SKILL.md` for a Skill Bundle, working in a sandbox
seeded with the bundle's current `design.md` (and `output/SKILL.md`, if one
already exists). Follow these steps in order.

1. **Read `design.md` in the current directory.**

   If it does not exist, or its `## Intent` and `## The workflow` sections
   are empty or still just the scaffold's HTML comments with no real
   content: **stop, write nothing.** Do not create `output/SKILL.md`. End
   your final message with a plain statement that `design.md` doesn't have
   enough content yet to draft a SKILL.md. A fabricated skill is worse than
   no skill.

2. **Check your prompt for a "REVISE NOTES:" section.**

   If present, a human reviewer already looked at a previous
   `output/SKILL.md` draft and is asking for something specific. Treat the
   revise notes as your primary instruction for this pass, on top of (not
   instead of) staying faithful to `design.md`.

3. **Check whether `output/SKILL.md` already exists.**

   If it does, treat it as a first draft to revise, not something to
   discard. Preserve any part that still matches `design.md`'s current
   `## Intent` / `## The workflow`. Rewrite only what has drifted, or what
   the revise notes call out.

4. **Write (or update) `output/SKILL.md`:**

   - **Frontmatter**: `name` (the bundle's slug, kebab-case, from
     `design.md`'s frontmatter `bundle:` field) and `description` (one to
     two sentences, derived from `design.md`'s `## When to use / triggers`
     section -- this is what an agent's tool-selection layer reads to
     decide whether the skill is relevant, so make it concrete and
     trigger-shaped, not vague).
   - **Body**: direct, second-person instructions to the agent that will
     run this skill -- write *to* that agent, not *about* the skill.
     Translate `design.md`'s `## The workflow` into a concrete numbered
     procedure. Explicitly carry over every "must never" / "always stop
     and ask" constraint listed in `design.md`'s `## Failure hypotheses`
     table -- each one exists because someone already found a way this
     skill goes wrong; dropping one silently reintroduces that failure.
   - Keep it as short as it can be while remaining unambiguous. This file
     will be read by an agent under token pressure, not skimmed by a human
     -- prefer a tight numbered procedure over prose.

5. **Stay in scope.** Only create or edit `design.md` and
   `output/SKILL.md`. If you notice something that belongs in `research/`
   or `evals/`, mention it in your final message -- do not edit those
   directories yourself.

6. **Stop once `output/SKILL.md` reflects `design.md`.** Do not run the
   drafted skill, do not write eval fixtures, do not change the bundle's
   stage. Those are separate, human-gated steps.
