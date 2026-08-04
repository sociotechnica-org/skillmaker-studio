---
title: Your first skill
description: A guided tour — start the Studio, describe a skill in a sentence, and walk it with an agent from research to a measured draft.
---

Welcome. This page walks you through making your first skill in Skillmaker
Studio — from one `npx` command to a drafted, honestly-measured `SKILL.md` —
with an agent doing the production work and you making the calls. No prior
setup, no cloned repo, no configuration files. Plan for a relaxed half hour;
most of it is conversation.

A quick word on what you're making. A **skill** is a `SKILL.md` file that
teaches a coding agent (Claude Code, Codex, and compatible tools) how to do
something your way. Skillmaker Studio's wager is that the file itself is the
least interesting part: the research behind it, the design reasoning, the
eval fixtures that probe where it might fail, and the measured evidence that
it works are the durable asset. Studio keeps all of that together in a
**Skill Bundle** — plain files in a directory you own — and `SKILL.md` is
one of its outputs.

## Before you start

Two things need to be true on your machine:

1. **Node.js** (for `npx`) and **git**. Your skills live in a git
   repository — Studio will set one up for you.
2. **A coding agent, installed and signed in.** Studio's conversations run
   through an agent you already have: either
   [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) or
   [Codex](https://developers.openai.com/codex/cli/). Install at least one
   and make sure it works on its own (`claude` or `codex` runs and is
   authenticated) before you start — Studio drives these tools; it can't
   sign in for you. If chat never answers, this is the first thing to check:
   see [Provider auth & troubleshooting](/getting-started/provider-auth/).

And two things worth knowing before you're surprised by them:

- **The agent works in your real project.** Its edits land as actual files
  in the directory you choose — nothing is sandboxed away from you. That's
  the point: everything it produces is yours, on disk, diffable.
- **You are the gate.** The pipeline moves at human speed, on your say-so.
  Studio will never advance a skill past a stage without you.

## 1. Start the Studio

From any terminal, in any directory:

```sh
npx skillmaker-studio start
```

This starts a small local server and opens your browser to the Studio
(default: `http://localhost:4323`). On a first run with nothing set up yet,
you'll land on a welcome screen with one button: **Create your first
project**. Click it.

:::note[CLI equivalent]
`skillmaker start` serves every project registered on this machine, from
wherever you run it. Terminal-first users can do this whole setup as
`skillmaker init` + `skillmaker project add .` in a repo of their own —
see the [CLI Reference](/cli/). The rest of this page stays in the browser.
:::

## 2. Create a project

A **project** is just a directory on your machine where your skills will
live. The dialog lets you browse to an existing directory, type a path, or
create a new folder right there. Pick or create one — a fresh, empty folder
is perfect for today.

Don't worry about preparing the directory: anything that isn't already a
Skillmaker workspace gets set up automatically when you click **Create
project** (a git-friendly scaffold: one small config file and an append-only
journal — more on that at the end).

## 3. Describe the skill you want

You'll land on the new-skill launcher, which asks one question: *What skill
would you like to create? Tell us about it.*

Write real sentences, like you'd brief a colleague. Not a slug, not
keywords — the more intent you give, the better the conversation starts.
For example:

> A skill that writes release notes from merged PRs in my team's voice:
> grouped by user impact, no commit-hash soup, honest about breaking
> changes.

The picker at the bottom of the box lists the agents Studio found on your
machine — pick which model runs this skill's sessions. Then send.

(If Studio spotted existing `SKILL.md` files near your project, it offers
them under *Import one of these?* — a way to bring an existing skill under
management. For your first run, describing something new is more fun.)

## 4. Meet the agent

Sending drops you onto the new skill's page, and a chat opens on the right.
Your brief arrives with a context chip attached — machine-written context
telling the agent where it is: inside Skillmaker Studio, working on this
bundle, at this stage, with its production guidance to read before acting.

This matters more than it sounds. A bare agent told "write release notes"
would just... write release notes, once, for this repo. This agent knows its
job is to build the *reusable skill* that does it — so its first move is to
orient: it reads the bundle's actual state and asks you the one question
that moves things forward. Answer it. This is the rhythm of the whole
pipeline: the agent produces, you decide.

(Closing the panel or the tab loses nothing — reopening the chat resumes
the same session where you left off.)

## 5. Research — answer the open questions

First real station. The agent researches your skill's domain: real sources,
failure cases, the boundaries of what the skill should and shouldn't do.
Its notes land in `research/notes.md`, which you can watch fill in on the
skill page's **Research** tab.

Then comes the part to actually show up for: research ends with **open
design questions**, and the agent brings them to you **one at a time** —
ask, wait, fold your answer back into the notes, next question — until they
are all cleared or explicitly parked. These answers are where your judgment
enters the skill. Take them seriously; one honest "I don't know, park it"
beats a confident guess.

## 6. Design — co-author design.md

With research settled, the agent proposes the skill's design and you shape
it together in conversation: what the skill is for, when an agent should
reach for it, the workflow it teaches, and — most valuable — your **failure
hypotheses**: the specific ways you suspect it could go wrong. Those
hypotheses become your evals in step 8.

The result is `design.md` — the *why* behind the skill, the document most
skills never have. You can read it any time in the **Files** panel on the
right.

## 7. Draft — SKILL.md appears

Now the agent drafts. `output/SKILL.md` — the actual skill text an agent
will someday run — lands in the bundle, and the skill page's **Overview**
tab starts showing its summary. Read it. Push back in chat on anything that
doesn't sound like you; the draft is a conversation artifact like everything
else here.

## 8. Evals — measure it honestly

This is the station that separates a Skillmaker skill from a pasted gist.
The agent turns the design's failure hypotheses into **claims** (a risk map
of what the skill is supposed to get right) and **fixtures** — small
concrete test scenarios that probe them.

Head to the **Eval** tab:

- Each claim shows its coverage — and until fixtures have been run and
  graded, its measurement honestly reads **not yet measured**. That's a
  feature, not a gap: Studio never lets "a test exists" masquerade as "it
  passes."
- **Run all fixtures** executes them against your chosen agent.
- When runs finish, read each response and grade it — **Pass** or
  **Fail**, your judgment, recorded. Grade honestly; a real Fail is worth
  more than a polite Pass, because it goes straight back into the
  conversation as the next thing to fix.

The [Evals section](/evals/fixtures-and-risk-maps/) covers this whole
machinery in depth when you want it.

## 9. Publish

<!-- TODO(#185): the install-door publish (Publish tab buttons "All my
     agents" / "This project's agents", provenance stamp, `skillmaker
     publish --to user|project`) is in flight on PR #185. When it merges,
     replace this section with the two-button walk. Until then this section
     documents what main actually has. -->

The **Publish** tab shows the skill's recorded versions next to their
evidence, but its buttons are disabled today — the in-Studio publish flow
is the one station still being built (see the
[Roadmap](/roadmap/)). What exists now is the CLI door for workspaces with
configured publish targets:
[`skillmaker publish`](/cli/publish/), and the broader story in
[Publishing and the skillbook](/concepts/publishing-and-the-skillbook/).

Until the door opens, your drafted, measured `SKILL.md` sits in
`output/SKILL.md` — a plain file you can copy wherever your agents read
skills from.

## Where everything lives

You've now seen the whole shape of the Studio; here's the map of it.

**The tabs are the stations.** Overview is the skill's front page (the
draft's summary), Research holds the notes and decisions, Eval holds
claims, fixtures, runs and grades, Publish holds versions and evidence.
Each tab shows the state of one leg of the pipeline.

**The Files panel is the whole bundle.** The right panel's **Files** tab
browses every file in the bundle — research, design, draft, fixtures, runs.
Nothing on the skill page is anything other than a view of these files.

**Everything is files in your project.** The bundle is a directory
(`skills/<your-skill>/`) inside the project directory you picked in step 2,
plus an append-only journal (`.skillmaker/events.jsonl`) recording every
decision. Commit them and your skill's entire history — reasoning, evidence,
and all — travels with your repo. See
[The Skill Bundle](/concepts/skill-bundle/) and
[The journal](/concepts/journal/) for the anatomy.

## When something doesn't work

- **Chat never answers, or no agents appear in the picker** — your provider
  isn't installed or isn't signed in. Fix it standalone first, then restart:
  [Provider auth & troubleshooting](/getting-started/provider-auth/).
- **On Windows** — support is new and lightly tested; if something breaks,
  please [open an issue](https://github.com/sociotechnica-org/skillmaker-studio/issues)
  with what you saw. That genuinely helps.
- **Anything else that stopped you or confused you** — we want to hear it,
  at the same place. You are exactly the reader this page was written for.

## Where to next

- [The production state machine](/concepts/state-machine/) — how a skill
  moves `idea → researching → drafting → evaluating → published`, and why
  every move waits for you.
- [Adopting an existing repo](/getting-started/adopting-an-existing-repo/)
  — bring the skills you already have under management.
- [CLI Reference](/cli/) — every station on this page has a terminal door.
