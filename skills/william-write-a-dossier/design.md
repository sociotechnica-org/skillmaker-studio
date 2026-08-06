---
bundle: william-write-a-dossier
---
# Design — William Write A Dossier

## Intent

Fill in a skill bundle's `dossier.md` so a person who has never seen the
skill can understand it in about twenty seconds.

The dossier is the Job piece of a skill: what it's for, what it must not be
used for, where it actually runs, whose method it follows, what evidence
exists, and the one test that would settle whether it works. Those six
sections already have a scaffold (`skillmaker dossier`) and a set of
questions. What they don't have is anyone who answers them *well*.

The failure this exists to fix is real and observable today. `set-have-agent-
manage-context`'s dossier answers every question and is still hard to read:
its `## Contexts` section runs to twenty-plus lines of nested handoffs, cites
four file paths and two unruled questions, and never once says the thing in
a sentence a newcomer could repeat. It is not wrong. It is unreadable — and
an unreadable dossier is worse than a blank one, because a blank invites you
to fill it and a wall invites you to skip it.

The audience is a human skimming a card, not an archivist. Depth belongs in
`research/`; the dossier is the part someone reads first and possibly only.

## When to use / triggers

Use this skill when a bundle needs its `dossier.md` written or tightened —
either it doesn't exist, or it exists and reads like internal notes.

Do not use it to research a topic (that's `william-research-a-skill`) or to
write the shipped skill file (that's `william-draft-skill-md`). This skill
adds no facts. It only writes down, plainly, what is already known — and
records honestly what isn't.

## The workflow

1. **Read what already exists.** `dossier.md` if present, `design.md`,
   `bundle.json`'s one-liner, and anything under `research/`. Every answer
   you write must be traceable to one of these or to the human you're
   talking to. You are a writer, not a source.

2. **Answer only what you can answer.** An unanswered section is an honest
   gap, not a defect — the product's own ruling
   (`docs/library/authoring/Entity - Dossier.md`). Leaving `## Basis` empty
   because nobody has decided is correct. Filling it with a plausible
   framework nobody chose is the worst thing this skill can do, because a
   confident wrong answer stops anyone from ever asking the question again.

3. **Write each section to its budget.** These are limits, not targets:

   | Section | Budget | Shape |
   |---|---|---|
   | Job | 1 sentence | What it does, plainly. No "leverages", no "enables". |
   | Out-of-scope | 1–2 sentences | What it refuses, and to whom that work belongs. |
   | Contexts | 3 lines per context, max 2 contexts | Upstream · downstream · stakes. |
   | Basis | 1 sentence + a name | A named method and *who* to ask. |
   | Evidence | 1–2 sentences | Whether data exists, where, and if we may use it. |
   | Fit criterion | 1 sentence, pass/fail | One test you could run today. |

   If a section won't fit its budget, that is a signal the thing isn't
   understood yet — say so in one line and move the detail to `research/`.
   Never solve an over-budget section by writing more.

4. **Use the house rules.** Every sentence:
   - names a concrete actor and a concrete thing ("the drafting station
     reads `design.md`", not "inputs are consumed");
   - survives being read aloud;
   - contains no file path unless the path is the point;
   - contains no unresolved parenthetical, no "TBD", no "see below".

   Prefer the shortest true sentence. If you can cut a clause and the
   meaning survives, the clause was decoration.

5. **Check it against the card.** The Overview surface synthesises these six
   answers into a short paragraph. Read your dossier as that paragraph: if
   the sentences don't join up into something a person would say out loud,
   rewrite them, not the surface.

6. **Never touch anything else.** `design.md`, `output/`, `evals/` and
   `research/` are other stations' work. Write `dossier.md` and stop.

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | Invents an answer — names a framework, context, or fit criterion nobody chose — rather than leaving the section empty | OUT |
| 2 | Ports the wall wholesale: copies `research/` prose into Contexts and calls it done | OUT |
| 3 | Blows the budget, producing accurate sections nobody will read | OUT |
| 4 | Writes for an archivist: correct, complete, and unreadable to a newcomer | OUT |
| 5 | Silently drops an answer that WAS already recorded, when tightening an existing dossier | OUT |
| 6 | Edits `design.md` or `output/SKILL.md` while it's in there | ADV |

## Proof spec

| Fixture | Buys | Shape |
|---|---|---|
| `golden-thin-bundle` | 1, 3 | A bundle with a one-liner and a thin `design.md`. Job and Out-of-scope get written; Basis and Evidence stay empty. Answer key checks the empty sections are *still empty*. |
| `tighten-the-wall` | 2, 3, 5 | `set-have-agent-manage-context`'s real dossier as input. Every existing answer must survive in compressed form; Contexts must come in under budget. |
| `refusal-nothing-to-go-on` | 1 | A bundle with an empty `design.md` and no one-liner. The agent must decline and say what it would need, not draft six plausible sections. |
| `scope-guard` | 6 | A bundle where `output/SKILL.md` is obviously wrong. The agent must leave it alone. |
