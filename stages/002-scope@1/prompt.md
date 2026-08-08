Goal: GitHub Issue #208: The shell has no routes — every view lives behind '/' with no shareable or navigable URLs

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/208

## Summary

The entire product renders behind `/`: center view, selected project, selected skill, active tab, and version pin are all in-memory React state (`NextShell`'s `center`/`pinned`, `SkillPage`'s `tab`, projectScope's localStorage slug). Nothing is in the URL. Consequences: no copy-paste links to a skill or tab, refresh loses your place, browser back/forward do nothing, and nothing can deep-link into the app (docs, issues, chat messages, factory PR bodies all *want* to link to skill pages). Poor behavior for a browser-based app — and blocking for sharing-with-teammates workflows.

## Direction

Client-side routing via the History API (the viewer is an Astro-served SPA; no server changes should be needed beyond ensuring the existing SPA fallback serves all route paths — verify).

Proposed scheme (adjust to code reality):
- `/board` (default landing), `/tasks`
- `/p/<projectSlug>` → project (board scoped or first skill — pick the honest one)
- `/p/<projectSlug>/s/<skillSlug>` → skill page, Overview tab
- `/p/<projectSlug>/s/<skillSlug>/<tab>` for research|eval|publish
- Version pin as query (`?v=<shortHash>`), since it's a lens not a place

## Acceptance criteria

1. Every navigation the sidebar/Board/tabs perform updates the URL (pushState); active project changes reflected in URL rather than only localStorage.
2. Cold-loading any URL (paste into a fresh tab) reconstructs the exact view: project selected, skill open, tab active, version pinned. Unknown/stale routes fall back to `/board` without crashing.
3. Browser back/forward traverse navigation history correctly (popstate).
4. The right-panel open/closed and panel widths stay OUT of the URL (device-local state, keep localStorage).
5. Server: direct-loading deep paths serves the SPA (dev + built dist + `skillmaker start`) — verify the existing fallback covers arbitrary depth, fix if not.
6. e2e coverage: direct-load of a skill-tab URL renders that skill's tab; back/forward test if the harness allows.
7. No regression to live-refresh, chat panel state, or the launcher flow (the new-skill → skill-page handoff should land on the new skill's URL).

Implement this issue. Verify current state against the code (NextShell.tsx center-view state, projectScope.ts, SkillPage tab state, astro SPA fallback + Server.ts static serving). This is a MEDIUM-LARGE change — take the scope stage seriously; if the honest scope exceeds one coherent PR, implement the core (routes for board/tasks/project/skill/tab + cold-load + back/forward) and note deferred slices in the PR body rather than sprawling.

Run ID: 01KZGEY5FAPKGK8R4MRQKG9NSV
Pipeline progress: 0 of 5 stages completed


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
