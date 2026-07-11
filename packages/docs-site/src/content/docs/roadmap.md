---
title: Roadmap
description: What's planned but not yet built, and where the plan lives.
---

This site documents only what's merged and runnable. Everything below is
planned but **not yet built** on the current codebase — rather than
scatter half-true promises across the concept and reference pages, they're
collected here once, pointing at the actual planning document.

The full, current build plan (phase scope, ordering, and verify recipes)
lives in the product repo at
[`docs/plans/2026-07-10-playmaker-to-skillmaker-migration/plan.md`](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/plans/2026-07-10-playmaker-to-skillmaker-migration/plan.md).
A running narrative of what's actually shipped, phase by phase, is in the
build log at
[`docs/plans/2026-07-10-playmaker-to-skillmaker-migration/build-log.md`](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/plans/2026-07-10-playmaker-to-skillmaker-migration/build-log.md).

## What's coming

- **Agent-first production stations.** `stations.json` is scaffolded on
  every bundle today, but agent-driven station execution — an agent doing a
  stage's work over ACP, requesting review, a human resolving in the viewer
  — isn't wired up yet. This is where **William**, the product's own
  skill-writing agent, ships.
- **Publishing.** `skill.published` and real publish targets (starting
  with a git-directory target) so a Skill Bundle can leave the studio with
  receipts attached.
- **The skillbook.** `skillmaker book build` and a skillbook viewer tab —
  auto-generated documentation for a whole skill set: design prose per
  skill, measured receipts pinned to versions, and journal-replayed
  changelogs. Same artifact class as `SKILL.md` (an output), one level up.
- **A second provider (codex) + real distribution.** Provider parity beyond
  `claude-code`, per-provider measurement columns, and an installable
  product (the `bun build --compile` binary described in
  [Install from source](/getting-started/install/) is the first piece of
  this; the full tarball/install story is still ahead — see
  [Desktop app](/getting-started/desktop-app/) for the current
  build-from-source path).
- **The predecessor studio's library, migrated last.** The Playmaker's
  Studio product-knowledge library — its concepts, mechanisms, and
  hard-won laws — gets cleaned up against this leaner data model and
  adopted as Skillmaker's own, deliberately scheduled *after* everything
  else ships, so the library describes the software that actually exists.
- **Desktop app: Windows/Linux and a signed, downloadable build.** The
  macOS build-from-source shell is documented in
  [Desktop app](/getting-started/desktop-app/); a cross-platform, installable
  version is still ahead, along with an in-app reconnect for the
  "attached-but-dead server" limitation noted there.

## Why nothing above has its own page yet

Every other page on this site was written and verified against the real,
running CLI and viewer on this branch — including pasted command output
from an actual fresh-directory walkthrough. None of the features above
exist to run yet, so writing detailed pages for them would either go stale
immediately or read as marketing rather than documentation. This page will
be broken up into real sections as each phase ships.
