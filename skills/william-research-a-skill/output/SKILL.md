---
name: william-research-a-skill
description: Researches a skill's topic and writes research/notes.md before design.md or SKILL.md is drafted. Use when handed a bundle's topic (bundle.json name/oneLiner and any existing design.md content) and asked to research it and write research/notes.md.
---

You are researching a Skill Bundle's topic, working in a sandbox seeded with
the bundle's current `bundle.json` and `design.md` (and `research/notes.md`,
if one already exists). Follow these steps in order.

1. **Read `bundle.json` and `design.md` in the current directory.**

   If `bundle.json`'s `oneLiner` is empty AND `design.md`'s `## Intent`
   section is empty or still just the scaffold's HTML comments with no real
   content: **stop, write nothing.** Do not create `research/notes.md`. End
   your final message with a plain statement that there's no topic here yet
   to research. Invented research about a topic no one has stated yet is
   worse than no research.

2. **Check your prompt for a "REVISE NOTES:" section.**

   If present, a human reviewer already looked at a previous
   `research/notes.md` draft and is asking for something specific. Treat
   the revise notes as your primary instruction for this pass, on top of
   (not instead of) researching the topic itself.

3. **Check whether `research/notes.md` already exists.**

   If it does, treat it as a first pass to extend or correct, not something
   to discard. Preserve findings that still hold. Add what's missing.
   Correct what the revise notes call out.

4. **Research the topic and write (or update) `research/notes.md`:**

   - A one-paragraph restatement of the topic in your own words, so a
     reader can tell you understood the task, not just repeated it.
   - **Facts / conventions the skill needs to get right** — concrete,
     checkable things (exact strings, formats, commands), not vague
     guidance. If you are not confident in a fact, say so explicitly
     rather than presenting a guess as settled.
   - **Edge cases and gotchas** — situations a naive implementation would
     get wrong, framed as "the skill must handle X" or "the skill must
     never do Y", so they translate directly into a later `design.md`'s
     `## Failure hypotheses` table.
   - **Open questions** — anything you could not resolve, named explicitly
     rather than silently papered over. Three honest open questions beat
     one confident wrong answer.

5. **Do not touch anything outside `research/notes.md`.**

   If you find yourself wanting to edit `design.md`, `output/`, or
   `evals/`, that belongs to a different station. Leave a note in your
   final message instead of editing it.

6. **Stop once `research/notes.md` reflects your research.**

   Do not draft `design.md` or `output/SKILL.md`, do not write eval
   fixtures, do not advance the bundle's stage — those are separate,
   human- or `william-draft-skill-md`-gated steps.
