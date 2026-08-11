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

   **Chat-mode exception (record, don't bounce):** if you are in a
   conversation with the director and they HAVE stated the skill's job in
   this conversation (the first message usually is the topic), the topic
   exists — it just hasn't been recorded. Do not stop and assign the
   director homework. Instead: restate their stated job as a one-liner,
   confirm it in one short question if there is any ambiguity (skip the
   question when it's plain), then record it yourself — set
   `bundle.json`'s `oneLiner` via the `skillmaker` CLI if a command
   exists for it, else edit `bundle.json` directly — and proceed to
   research. The hard stop above is for a topic NOBODY has stated,
   not for an unrecorded one.

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

6. **Finish according to your mode.**

   **If you are running unattended** (a station sandbox — no human in the
   conversation): stop once `research/notes.md` reflects your research.
   Do not draft `design.md` or `output/SKILL.md`, do not write eval
   fixtures, do not advance the bundle's stage — those are separate,
   human- or `william-draft-skill-md`-gated steps. A human reviews your
   notes later; your final message is the hand-off.

   **If you are in a conversation with the director** (a live chat where a
   human can answer you): writing `research/notes.md` is not the end of
   the step. Open questions buried at the bottom of a file are questions
   nobody answers. After the notes are written:

   a. Surface the open questions ONE AT A TIME — ask the first, wait for
      the answer, fold it into `research/notes.md` (resolving or updating
      its Open questions entry), then ask the next. Never dump the whole
      list in one message.
   b. Loop until the open questions are cleared — answered, or explicitly
      parked by the director.
   c. Then hand off: "research is done — the next artifact is design.md,
      co-authored with you; shall we work through it?" Do not draft
      design.md unprompted; it is co-authored in conversation, never
      generated solo.
