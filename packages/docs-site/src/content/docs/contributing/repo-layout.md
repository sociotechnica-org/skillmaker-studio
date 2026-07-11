---
title: Repo layout
description: How the Skillmaker Studio monorepo is organized.
---

Skillmaker Studio is a bun-workspaces monorepo, with package-local guidance
in each package's own README:

```text
packages/core/            # @skillmaker/core — domain: schemas, journal, fold, machine, index
packages/cli/             # @skillmaker/cli — the skillmaker CLI + server (bin: skillmaker)
packages/viewer/          # @skillmaker/viewer — Astro 5 + React 19 + Tailwind 4 board
packages/marketing-site/  # @skillmaker/marketing-site — public landing site
packages/docs-site/       # @skillmaker/docs-site — this documentation site (Astro + Starlight)
docs/                     # product plans and design docs
test/e2e/                 # end-to-end tests that spawn the real CLI
skills/                   # the repo's own self-hosted Skillmaker workspace
.skillmaker/              # this repo's own journal — real, git-tracked history
```

## `packages/core`

The domain layer everything else depends on: journal append/idempotency,
the fold (`Fold.ts` — the board-is-a-replay law made code), the guarded
state machine (`Machine.ts`), fixture/risk-map scanning, version hashing +
drift, and the SQLite index (via `bun:sqlite`, no dependency).

## `packages/cli`

`skillmaker`'s argument router (`Cli.ts`) and one command module per
command under `src/commands/`. `main.ts` is the only place that touches the
Effect runtime edge (`Effect.runPromise`); everything else stays a pure
Effect value until then. The CLI also hosts the `Bun.serve` server behind
`skillmaker start` — one process, one origin, `/api/*` + static viewer +
SSE.

## `packages/viewer`

Astro 5 + React 19 + Tailwind 4, built to static `dist/` and served by the
CLI's server (never its own dev server in production). Effect is confined
to a typed client boundary (`src/app/runtime`, fetch → schema decode →
tagged errors → hooks) — viewer components themselves are plain React.

## `packages/docs-site`

This site: Astro + Starlight, static build, no analytics. See
[Build discipline](/contributing/build-discipline/) for how it's verified.

## Self-hosting

The repo carries its own Skillmaker workspace at the root (`skills/` +
`.skillmaker/`) — the studio's own skills are developed in the studio, and
its journal is real, git-tracked shared history from the first commit. QA
state committed into that journal (bundles, todos, journal events) is
dogfooded, not scratch data.
