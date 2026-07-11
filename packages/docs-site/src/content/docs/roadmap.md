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

## Recently shipped (see the concept/CLI pages, not this list)

Agent-first production stations, publishing, the skillbook, a second
provider (codex), and brownfield adoption of existing skills repos all
shipped since this page last listed them as "coming." They're documented
where the rest of this site documents merged, runnable features, not here:

- **Agent-first production stations** — `skillmaker station run`, backing
  William's own skill-drafting. See [The Skill Bundle](/concepts/skill-bundle/)
  (`stations.json`) and the build log.
- **Publishing** — [`skillmaker publish`](/cli/publish/), git-dir and
  marketplace targets.
- **The skillbook** — [`skillmaker book build`](/cli/book-build/), and
  [Publishing and the skillbook](/concepts/publishing-and-the-skillbook/)
  for how the two relate.
- **Codex, a full second provider** — a real eval peer to `claude-code`,
  not just configured; see [Running fixtures](/evals/running-fixtures/).
- **Adopting an existing repo** — [`skillmaker adopt`](/cli/adopt/) and the
  [getting-started walkthrough](/getting-started/adopting-an-existing-repo/),
  including real numbers from adopting two real-world skills repos.
- **The predecessor studio's library** — migrated and Raven-reviewed
  against the shipped data model (Phase 14).
- **William, self-hosted for real (Phase 19).** The repo's own studio is
  William's actual working environment: real `design.md`s, fixtures by
  failure class, a risk map, recorded versions, and measured runs on both
  providers, staged through the board like any other bundle.
- **Phase 20 — six real personas, six friction logs, four fix PRs
  (v0.2.0 → v0.2.1).** Six fresh-install stories (first bundle, model
  selection, vendored-adopt, publish/storefront, maintain/re-earn,
  failure-iteration) each drove real friction logs against the shipped
  CLI, closed by PRs #47/#49/#51/#54: layout-aware runs, journal safety,
  sandbox isolation, `--model` selection with resolved-id recording,
  storefront receipts, `response.md`, honest confidence intervals, `run
  repair`, `adopt --source` provenance, and — the story's sharpest
  finding — a credential-leak P0 in sandboxed auth, fixed structurally in
  v0.2.1. See the [build log](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/plans/2026-07-10-playmaker-to-skillmaker-migration/build-log.md)
  for the full phase entry and
  [Provider auth & troubleshooting](/getting-started/provider-auth/) for
  what shipped.

## What's coming

- **Desktop app: Windows/Linux and a signed, downloadable build.** The
  macOS build-from-source shell is documented in
  [Desktop app](/getting-started/desktop-app/); a cross-platform,
  installable version is still ahead, along with an in-app reconnect for
  the "attached-but-dead server" limitation noted there.
- **Iteration ergonomics: a `runs list` command and grading at volume.**
  Story 6's friction log found real pain grading 8+ runs in a row: no
  `skillmaker runs list` (run ids currently live only in dir names, and
  must be copy-pasted from `run` output), and no `--fixture ... --latest`
  or similar selector to queue grading without hand-tracking which run is
  which. A `-k`/count-oriented flag for driving several runs of the same
  fixture in one invocation (instead of N separate `skillmaker run`
  calls) is in the same backlog bucket. Not yet built.
- **Drift vs. upstream.** `adopt --source`/`--ref` (shipped in v0.2.1)
  records where an adopted skill came from at adopt time, but the product
  still can't answer "has the *source repo* changed since I adopted?" — a
  `skillmaker upstream diff` (or similar) that re-fetches `--source` and
  compares would close that. Today "drift" only means drift vs. your own
  adopt-time snapshot, not vs. upstream.

## Why nothing above has its own page yet

Every other page on this site was written and verified against the real,
running CLI and viewer on this branch — including pasted command output
from an actual fresh-directory walkthrough. Nothing in **What's coming**
exists to run yet, so writing detailed pages for it would either go stale
immediately or read as marketing rather than documentation. This page will
be broken up into real sections as each phase ships — most recently, that's
exactly what happened to agent-first stations, publishing, the skillbook,
codex, and adopt.
