# Source — The skills-only repo / marketplace thesis

> **Type:** source note (frozen provenance — director's original thinking,
> captured 2026-07-11 during the phased build). Feeds a future library
> update (Phase 14+); not itself a plan or ruling. Interpretive notes below
> the line are Raven's, from the same conversation.

## Director's thinking (2026-07-11)

Where should Skillmaker Studio run?

1. **In a project** (a git dir) — skills specific to that project or repo.
   The obvious mode; what the build has implicitly assumed.
2. **The more interesting one: working in / managing a skills-only repo**
   that publishes a marketplace (Claude and/or Codex) file.

There are probably competitive products doing something similar — but this
could be a **"full stack" solution**: research, develop, eval, publish, and
maintain your skills-only repo **all the way through the lifecycle**. Not
what Skillmaker was built for initially, but a really solid follow-on
feature — **might be what gets the most usage**.

## Raven's interpretive notes (same conversation)

- The data model already supports this with near-zero delta: the workspace
  was never coupled to a project; `publishTargets` sketched a
  `claude-marketplace` kind from the first draft (data-model §3.1), and
  §2.14 established **workspace-level outputs** — the skillbook is the
  human-facing projection of "publish the whole set," a marketplace file is
  the machine-facing projection of the same fact. Same generator pattern.
- The value stack compounds in a skills-only repo in a way it doesn't
  in-project: per-version measurements (which skills regressed when a new
  model shipped), drift badges (hand-patched but never re-evaled), journal
  provenance, todo maintenance queue.
- **"Maintain" is the differentiating lifecycle phase**: version-pinned
  measurements mean "new model → validation honestly resets → re-earn
  campaign" falls out of the existing model with no schema change (the
  descendant of the old studio's E13 re-earn discipline).
- Plan impact if ruled in: Phase 11's publish targets gain a marketplace
  kind; possibly an `init` template for skills-repo workspaces. No new
  entities.

## Open (for a future ruling)

- Competitive landscape scan (proposed, not yet run).
- Whether skills-repo mode becomes the *primary* positioning or a follow-on.
- Claude vs Codex marketplace file specs — what the artifact actually is.
