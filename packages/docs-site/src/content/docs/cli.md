---
title: CLI Reference
description: Every skillmaker command, generated from the CLI's own router.
---

This reference is generated from `packages/cli/src/Cli.ts` — the same
argument router the CLI itself runs — so it lists exactly the commands and
flags that exist on this branch, nothing aspirational.

```text
skillmaker — Skillmaker Studio CLI

Usage: skillmaker <command> [options]
```

## Global options

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON instead of text, on every command that produces output |
| `-h`, `--help` | Show the top-level usage text |

## Commands

| Command | Purpose |
|---|---|
| [`init`](/cli/init/) | Initialize a skillmaker workspace in the current directory |
| [`new <slug>`](/cli/new/) | Create a new Skill Bundle under `skills/<slug>/` |
| [`list`](/cli/list/) | List Skill Bundles by stage/substate |
| [`status <slug>`](/cli/status/) | Show one Skill Bundle's identity, state, and event history |
| [`reindex`](/cli/reindex/) | Rebuild `.skillmaker/studio.db` from files + the journal |
| [`fixture add <slug> <case>`](/cli/fixture-add/) | Scaffold `evals/fixtures/<case>/` for a bundle |
| [`run <slug>`](/cli/run/) | Run a fixture case through an ACP provider |
| [`grade <slug> <runId>`](/cli/grade/) | Record a run's grading verdict |
| [`measurements <slug>`](/cli/measurements/) | Show measurement cells: n, pass rate, CI, guidance |
| [`start`](/cli/start/) | Serve the viewer + API |
| [`review request <slug>`](/cli/review-request/) | Request review of the bundle's current stage work |
| [`review resolve <slug>`](/cli/review-resolve/) | Resolve a pending review (`approve`/`revise`) without leaving the terminal |
| [`advance <slug>`](/cli/advance/) | Move a bundle along the state machine (guarded) |
| [`version record <slug>`](/cli/version-record/) | Record a version: hash `design.md` + `output/` |
| [`todo add/list/done/start/drop/reopen`](/cli/todo/) | The journal-native todo system |
| [`adopt [path]`](/cli/adopt/) | Import pre-existing `SKILL.md` files as in-place Skill Bundles |
| [`publish <slug>`](/cli/publish/) | Publish a bundle to its configured publish targets |
| [`book build`](/cli/book-build/) | Render the Skillbook to a static site |

## Exit codes

Every command uses `0` for success and `2` for a usage error. `skillmaker
run` additionally distinguishes `1` (task failed) from `3` (infra-error) —
see [`skillmaker run`](/cli/run/).

## Running it

There's no published package yet — see
[Install from source](/getting-started/install/) for how to run
`skillmaker <command>` from a checkout, and
[Your first Skill Bundle](/getting-started/first-bundle/) for a full
walkthrough with real output.
