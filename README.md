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
curl -fsSL https://skillmaker.studio/install.sh | sh   # macOS arm64 + Linux x64

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
  refusal / empty / rerun / hard-case / trigger), risk maps over five risk
  families (Input / Reasoning / Output / Adversarial / Chain), a coverage
  surface with validation honestly reading "not yet measured" until real
  runs land.
- **Agent-driven eval runs, on two providers** — `skillmaker run` drives a
  real coding agent over ACP — **claude-code and codex are both full eval
  peers** — through a fixture case, end to end, capturing the full
  transcript and diffing artifacts. A `trigger`-class fixture grades
  whether the skill activated on its own, provider-tolerant either way.
- **Grading + measurements** — grade a run pass/fail/partial in the CLI
  (`skillmaker grade`) or the board's run-detail read-out; graded runs join
  into *n · pass-rate · confidence-interval* measurements
  (`skillmaker measurements`), never pooled across fixture, version,
  provider, or model.
- **Agent-first production stations** — `skillmaker station run` drives an
  agent through a stage's work over ACP, requesting review on completion;
  William, the product's own skill-writing agent, ships skills through
  this loop today.
- **Publish, with receipts** — `skillmaker publish` sends a bundle's
  `output/` to a git directory or a marketplace manifest once it clears
  the publish gate, from the CLI or the board's guided flow. The
  Claude-marketplace target round-trips losslessly; the Codex-marketplace
  manifest shape is still best-effort (no published spec to conform to
  yet).
- **The skillbook** — `skillmaker book build` renders a static site with
  one page per skill: design prose, version-pinned measurement receipts,
  and a journal-replayed changelog.
- **Adopt an existing repo** — `skillmaker adopt` wraps pre-existing
  `SKILL.md` files as bundles in place, no files moved; QA'd against two
  real skills repos (gstack: 59/60 adopted; mattpocock/skills: 39/39).
- **Live viewer** — Astro + React + Tailwind board on one origin, SSE
  updates on every journal change, no reload.
- **Desktop app** — a Tauri shell (macOS, built from source) that wraps the
  compiled `skillmaker` binary as a sidecar: the same board, no terminal.

**Coming next** (see [the build plan](docs/_archive/plans/2026-07-10-playmaker-to-skillmaker-migration/plan.md)):
William's skills fully self-hosted through the studio's own board — every
William skill measured on both providers and published through the same
gated loop any bundle uses — plus a cross-platform, signed desktop build.

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

Full model: [data-model.md](docs/_archive/plans/2026-07-10-playmaker-to-skillmaker-migration/data-model.md) ·
Build log: [build-log.md](docs/_archive/plans/2026-07-10-playmaker-to-skillmaker-migration/build-log.md)

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
