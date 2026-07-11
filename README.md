# Skillmaker Studio

**Design, evaluate, and ship agent skills — with receipts.**

A skill's research, design thinking, eval fixtures, and run records are the
durable asset (a **Skill Bundle**); `SKILL.md` is an *output* — produced,
versioned, and measured, not the thing itself.

[![CI](https://github.com/sociotechnica-org/skillmaker-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/sociotechnica-org/skillmaker-studio/actions/workflows/ci.yml)

## Why

Anyone can paste a SKILL.md of unknown pedigree. Skillmaker skills come with
documented reasoning (a design doc that explains *why* the skill is shaped
the way it is), a human-gated production history, and measured evidence —
pass rates per fixture, per provider, pinned to the exact version they
exercised. Coverage and validation never merge: "a fixture exists" and "it
passes at rate r over n runs" stay separate facts, honestly displayed.

## Quickstart

```sh
# in any git repo that should hold skills
skillmaker init                 # config + journal + skills/
skillmaker new my-first-skill   # scaffold a Skill Bundle
skillmaker start                # board + bundle detail at localhost:4323
```

The viewer and the CLI are two doors to the same ground: every state change
is an event on an append-only, git-tracked journal
(`.skillmaker/events.jsonl`); the board is a replay, and SQLite is only a
rebuildable index (`skillmaker reindex` reconstructs it from scratch).

## What works today

- **Skill Bundles** — `init` / `new` scaffold bundle.json, design.md,
  stations.json, evals/, output/
- **The production state machine** — `idea → researching → drafting →
  evaluating → published`; forward moves require an approved review, publish
  requires the gate, backward moves are legal with a reason. Enforced
  identically at the CLI (`advance`, `review request`) and in the viewer.
- **Reviews** — non-blocking review pairs: request review, approve or
  revise-with-notes in the viewer; approval unlocks the next stage.
- **Todos** — journal-native work tracking (`todo add/list/done/...` + a
  board panel), priority-sorted, with a derived archive window.
- **Versions + drift** — `version record` hashes the output tree; the
  studio shows whether design.md or outputs drifted since the last recorded
  version. Honest states, no enforcement.
- **Eval fixtures + coverage** — fixture cases by failure class (golden /
  refusal / empty / rerun / hard-case), risk maps over five risk families
  (Input / Reasoning / Output / Adversarial / Chain), a coverage surface
  with validation honestly reading "not yet measured" until real runs land.
- **Agent-driven eval runs** — `skillmaker run` drives a real coding agent
  over ACP (claude-code today, codex configured) through a fixture case,
  end to end, capturing the full transcript and diffing artifacts.
- **Grading + measurements** — grade a run pass/fail/partial in the CLI
  (`skillmaker grade`) or the board's run-detail read-out; graded runs join
  into *n · pass-rate · confidence-interval* measurements
  (`skillmaker measurements`), never pooled across fixture, version,
  provider, or model.
- **Live viewer** — Astro + React + Tailwind board on one origin, SSE
  updates on every journal change, no reload.
- **Desktop app** — a Tauri shell (macOS, built from source) that wraps the
  compiled `skillmaker` binary as a sidecar: the same board, no terminal.

**Coming next** (see [the build plan](docs/plans/2026-07-10-playmaker-to-skillmaker-migration/plan.md)):
agent-first production stations, publish targets, a generated
**skillbook** — docs for your whole skill set with the receipts inline —
and a second provider (codex) with real, cross-platform distribution.

## Architecture

- **CLI-first, bun-native.** TypeScript run directly by bun (Effect for
  services/errors/schemas), distributed as a `bun build --compile` single
  binary.
- **One origin.** `skillmaker start` = one `Bun.serve`: static viewer +
  `/api/*` + SSE. No CORS, no second server.
- **Prose in files, state in events, queries in SQLite.** Sources
  (research, design, fixtures) and outputs live as files you can read and
  git-diff; decisions and state transitions are journal events; the DB is
  disposable.

Full model: [data-model.md](docs/plans/2026-07-10-playmaker-to-skillmaker-migration/data-model.md) ·
Build log: [build-log.md](docs/plans/2026-07-10-playmaker-to-skillmaker-migration/build-log.md)

## Repo layout

```
packages/core/            # @skillmaker/core — domain: schemas, journal, fold, machine, index
packages/cli/             # @skillmaker/cli — the skillmaker CLI + server (bin: skillmaker)
packages/viewer/          # @skillmaker/viewer — Astro 5 + React 19 + Tailwind 4 board
packages/desktop/         # @skillmaker/desktop — Tauri v2 shell wrapping the CLI as a sidecar (macOS)
packages/docs-site/       # @skillmaker/docs-site — Starlight docs (docs.skillmaker.studio)
packages/marketing-site/  # @skillmaker/marketing-site — public site
docs/                     # product plans and design docs (see docs/README.md)
test/e2e/                 # end-to-end tests that spawn the real CLI
```

Bun-workspaces monorepo; package-local guidance in each package's README.

## Development

```sh
bun install               # also clones the Effect research repo (skip: SKIP_EFFECT_CLONE=1)
bun test packages         # unit tests
bun run build:viewer      # build the viewer (required before start / e2e)
bun run test:e2e          # e2e against the real CLI
bun packages/cli/src/main.ts --help
```

CI runs typecheck, unit, viewer build, and e2e on every PR.

## License

[MIT](LICENSE) © SocioTechnica
