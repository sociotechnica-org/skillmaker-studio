# Scope

Write a durable technical implementation plan for the requested
Skillmaker Studio feature to
`docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md` (refine an
existing relevant plan instead of duplicating it). Do not edit
implementation files in this stage.

## The repository

Skillmaker Studio is a bun + Effect TypeScript monorepo (bun workspaces):

- `packages/core` — the domain engine: skills, evals, journal, todos,
  triage. Effect-first; schemas live here and everything else consumes
  them.
- `packages/cli` — the `skillmaker` CLI and the local server the Studio
  UI rides on. Command data on stdout, diagnostics on stderr, stable
  exit codes.
- `packages/viewer` — the Studio browser UI (Astro + React).
- `packages/desktop`, `packages/docs-site`, `packages/marketing-site`,
  `packages/skill` — touch these only when the goal names them.
- `test/e2e` — black-box end-to-end tests over the CLI and server
  surfaces.
- `docs/proposals/` — dated proposal/plan documents. Do not
  freehand-edit `docs/library` (the live product context library)
  unless the plan explicitly owns a library migration.

Repository gates (mirrors `.github/workflows/ci.yml`): typecheck core
and cli, `bun test packages`, `bun test test/e2e`, and
`bun run build:viewer` when the viewer changes. A script node runs these
after implementation; plan work that passes them.

House comment style — plan for it now so implementation inherits it:
comments are plain English prose that explains WHY the code is shaped
this way, not what it does, and cites sources — issue numbers, dated
proposals, rulings — the way `packages/core/src/Todo.ts` does.

## Plan expectations

- Keep work scoped to the packages and surfaces named by the goal, with
  domain logic in core, deterministic CLI/server behavior in cli,
  browser UI state in viewer.
- Include tests for changed behavior, and risks, acceptance criteria,
  and deferred follow-ups.

End your response with `Plan ready for implementation: <plan-path>` and
a brief summary; the implement stage reads the plan file from disk.
