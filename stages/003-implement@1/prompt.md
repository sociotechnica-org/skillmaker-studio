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
Pipeline progress: 1 of 5 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Created the durable implementation plan at [2026-08-08-viewer-route-state.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-08-viewer-route-state.md).
  > 
  > It defines URL-authoritative project/skill/tab/version routing, cold-load and history synchronization, launcher/chat continuity, SPA fallback verification, project-safe data identity, and focused HTTP plus Playwright coverage. No implementation files were changed; `git diff --check` passes.
  > 
  > Plan ready for implementation: docs/proposals/2026-08-08-viewer-route-state.md


# Implement

Implement the plan under `docs/proposals/` named by the scope stage.
Package-local README/guidance files own workflow and testing for the
packages you touch.

Rules:

- Stay scoped to the plan and its package boundaries: domain logic and
  schemas in `packages/core`, deterministic CLI/server behavior in
  `packages/cli` (data on stdout, diagnostics on stderr, stable exit
  codes, black-box tests for behavior), browser UI state in
  `packages/viewer`. If the plan cannot be implemented coherently
  without expanding scope, implement the smallest coherent slice and
  leave a clear blocking note in your final response.
- Do not freehand-edit `docs/library` (the live product context
  library) unless the plan explicitly owns a library migration.
- Comments in the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings, the way
  `packages/core/src/Todo.ts` does.
- If you are here after a gate failure or a ReviewJudge fix verdict,
  read that stage's output from context and fix exactly what it names.
  Retries are capped in the graph, so make the fix count.

Gates. Before finishing, run and pass ALL of:

```bash
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

AND, whenever the diff touches `packages/viewer`:

```bash
bun run build:viewer
```

A script node reruns the same gates right after this stage; a failure
routes straight back here. Summarize the implemented changes at the end.
