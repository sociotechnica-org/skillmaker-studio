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
| `fixture harvest <slug> <case>` | Turn a `skill.field_report` or intake into a Lab fixture (`--from-report` / `--from-intake`) |
| `dossier <slug>` | Print a bundle's dossier: job, contexts, out-of-scope, basis, evidence — honest gaps shown as "unrecorded" |
| [`run <slug>`](/cli/run/) | Run a fixture case through an ACP provider |
| [`run repair <slug> [runId]`](/cli/run-repair/) | Terminal-state stuck "running" run(s) so their transcripts become gradeable |
| `station run <slug>` | Run an agent station for a bundle (`--state`, `--provider`) |
| [`grade <slug> <runId>`](/cli/grade/) | Record a run's grading verdict |
| [`measurements <slug>`](/cli/measurements/) | Show measurement cells: n, pass rate, CI, guidance |
| [`start`](/cli/start/) | Serve the viewer + API for every registered project (machine registry; ignores cwd) |
| [`project add/list/remove`](/cli/project/) | Manage the machine-level project registry `start` serves |
| [`review request <slug>`](/cli/review-request/) | Request review of the bundle's current stage work |
| [`review resolve <slug>`](/cli/review-resolve/) | Resolve a pending review (`approve`/`revise`) without leaving the terminal |
| [`advance <slug>`](/cli/advance/) | Move a bundle along the state machine (guarded) |
| [`version record <slug>`](/cli/version-record/) | Record a version: hash `design.md` + `output/` and snapshot its content into the bundle |
| [`version show <slug> <hash>`](/cli/version-record/#version-show) | List a recorded version's snapshot files |
| [`todo add/list/done/start/drop/reopen`](/cli/todo/) | The journal-native todo system |
| [`adopt [path]`](/cli/adopt/) | Import pre-existing `SKILL.md` files as in-place Skill Bundles (`--triage` / `--from-manifest` for a sweep-then-act flow) |
| [`publish <slug>`](/cli/publish/) | Publish a bundle to its configured publish targets |
| `ship <slug>` | Ship a recorded version to a destination, with its measurement receipts snapshotted |
| `report <slug>` | Record a field report on a shipped skill (`--outcome worked\|failed\|surprise --note <text>`) |
| `receive <path>` | Receive an arriving skill crate at the dock (copies it to `receiving/<intake-id>/`) |
| `route <intake-id>` | Route a received crate: `--as return\|new\|upgrade\|fork\|salvage --reason <text>` |
| [`book build`](/cli/book-build/) | Render the Skillbook to a static site |

Commands without a linked page yet are documented in the CLI's own
`--help` output; run `skillmaker --help` for their full flag sets.

## Exit codes

Every command uses `0` for success, `1` for an expected refusal (a failed
guard, a missing bundle), and `2` for a usage error. `skillmaker run`
additionally distinguishes `1` (task failed) from `3` (infra-error) — see
[`skillmaker run`](/cli/run/).

## Running it

`skillmaker` is published on npm as
[`skillmaker-studio`](https://www.npmjs.com/package/skillmaker-studio)
(prebuilt binaries for macOS arm64/x64, Linux x64, and Windows x64):

```sh
npx skillmaker-studio --help
# or install it:
npm install -g skillmaker-studio
```

See [Install](/getting-started/install/) for the other install routes
(curl script, from source), and
[Your first Skill Bundle](/getting-started/first-bundle/) for a full
walkthrough with real output.
