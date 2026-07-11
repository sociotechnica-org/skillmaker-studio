---
title: Introduction
description: What Skillmaker Studio is and why it exists.
---

Skillmaker Studio is a tool for designing, evaluating, and shipping **agent
skills** — `SKILL.md` files for Claude Code, Codex, and compatible agents —
where the skill's research, design thinking, eval fixtures, runs, and status
are the durable asset (a **Skill Bundle**) and `SKILL.md` is one of its
*outputs*.

## Why

Anyone can paste a `SKILL.md` of unknown pedigree. Skillmaker skills come
with documented reasoning (a design doc that explains *why* the skill is
shaped the way it is), a human-gated production history, and measured
evidence — pass rates per fixture, per provider, pinned to the exact version
they exercised. Coverage and validation never merge: "a fixture exists" and
"it passes at rate *r* over *n* runs" stay separate facts, honestly
displayed.

## How it's built

- **CLI-first, bun-native.** The `skillmaker` CLI is TypeScript run directly
  by [bun](https://bun.sh) (no build step to run it from source), and is
  designed to ship as a `bun build --compile` single binary.
- **One origin.** `skillmaker start` runs one `Bun.serve` process that
  serves the static viewer *and* its API from the same origin — no CORS, no
  second server.
- **Prose in files, state in events, queries in SQLite.** Sources (research,
  design, fixtures) and outputs live as files you can read and git-diff;
  decisions and state transitions are events on an append-only journal;
  the SQLite index is fully disposable — `skillmaker reindex` rebuilds it
  from files + the journal at any time.

## What's in these docs

- **[Getting Started](/getting-started/install/)** — install from source,
  walk through creating your first Skill Bundle and opening the board, and
  build the desktop app.
- **[Concepts](/concepts/skill-bundle/)** — the Skill Bundle's anatomy, the
  production state machine, the journal, and versions/drift.
- **[Evals](/evals/fixtures-and-risk-maps/)** — the fixture kit, risk
  families, the coverage-vs-validation honesty rule, and grading runs into
  measurements.
- **[CLI Reference](/cli/)** — one page per command, generated from the
  CLI's own router.
- **[Contributing](/contributing/repo-layout/)** — repo layout and build
  discipline for anyone working on Skillmaker Studio itself.
- **[Roadmap](/roadmap/)** — what's planned but not built yet.

:::note
This site documents only what's merged and runnable on the current
codebase. Planned-but-not-built functionality (agent-first production
stations, publishing, the skillbook) is described once, on the
[Roadmap](/roadmap/) page, linking the build plan — not scattered across
these pages as half-true promises.
:::
