# Skillmaker Studio

Skillmaker Studio — design, evaluate, and ship agent skills. The skill's
research, design thinking, eval fixtures, and runs are the durable asset (a
Skill Bundle); SKILL.md is an output.

## What it is

A standalone product for designing, evaluating, and shipping **agent
skills** — SKILL.md files for Claude Code, Codex, and compatible agents.
The unit of work is the **Skill Bundle**: research, design thinking, eval
fixtures, run records, and status, from which the distributable SKILL.md is
produced, versioned, and measured.

## Status

Pre-alpha. Foundations only — the walking-skeleton floor. No features yet.

## Architecture sketch

- **CLI-first bun binary.** The `skillmaker` CLI is TypeScript run directly
  by bun, eventually distributed as a `bun build --compile` single binary.
- **`skillmaker start`** serves an Astro + React + Tailwind viewer and
  `/api` on one origin.
- **Storage:** prose in files, state in SQLite, history in an append-only
  JSONL journal (`.skillmaker/events.jsonl`, git-tracked, union-merge).
  SQLite is a rebuildable index, never a source of truth.

See [`docs/data-model.md`](docs/data-model.md) and
[`docs/plan.md`](docs/plan.md) for the full model and build order.

## Repo layout

```
packages/core/            # @skillmaker/core — shared domain types (schemas, journal, eval engine to come)
packages/cli/             # @skillmaker/cli — the skillmaker CLI (bin: skillmaker)
packages/viewer/          # @skillmaker/viewer — Astro 5 + React + Tailwind viewer (placeholder)
packages/marketing-site/  # @skillmaker/marketing-site — public marketing/landing site (placeholder)
docs/                     # product plans and design docs (see docs/README.md)
```

This is a bun-workspaces monorepo: the root `package.json` declares
`packages/*` workspaces, and package-local guidance lives in each package's
README.
