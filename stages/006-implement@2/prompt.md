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
Pipeline progress: 4 of 5 stages completed

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

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented the Issue #208 core routing slice.
  > 
  > Key changes:
  > 
  > - Added URL-authoritative next-shell routing in [router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx):
  >   - `/board`, `/tasks`, project Board, project Tasks, New Skill, skill tabs, and `?v=<shortHash>`.
  >   - `pushState` navigation, `replaceState` canonicalization/recovery, and `popstate` Back/Forward handling.
  >   - Invalid/stale project or skill routes recover to `/board`.
  > 
  > - Converted the mounted shell in [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx) from in-memory center/pin state to route-derived rendering.
  >   - Sidebar, Board cards, launcher handoff, tabs, and version picker now update the URL.
  >   - Project scope is synchronized before routed project content runs.
  >   - Right-panel open state is persisted locally and remains out of the URL.
  >   - New-skill chat handoff is qualified by project and skill.
  > 
  > - Updated [Sidebar.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/Sidebar.tsx), [views.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/views.tsx), and [SkillPage.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/SkillPage.tsx) for controlled route navigation, project-filtered Board, and route-controlled skill tabs with `aria-current`.
  > 
  > - Prevented cross-project stale API data flashes in [api.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/api.ts).
  > 
  > - Switched the Astro shell to client-only mounting in [index.astro](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/pages/index.astro), and applied SPA fallback to preview as well as dev in [astro.config.mjs](/home/daytona/workspace/skillmaker-studio/packages/viewer/astro.config.mjs).
  > 
  > - Added pure route coverage in [router.test.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.test.ts) and updated the server E2E to request a canonical deep skill URL in [phase3.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/phase3.e2e.test.ts).
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: viewer TypeScript check, router unit tests, and `bun run build:viewer`
  > - Passed once: `bun test test/e2e --timeout 30000` — 370 passed, 17 expected skips.
  > - Verified manually: `skillmaker start` serves the rebuilt shell at `/` (200); the existing server fallback handles arbitrary-depth non-asset paths.
  > 
  > One gate remains externally blocked: `bun test packages` fails in the pre-existing `packages/cli/test/JournalWatcher.test.ts` test (“fires (debounced) on appends to an existing journal”). It also fails identically when run alone, and no watcher/server code was changed by this routing work.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1734 lines omitted)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   17 skip
   0 fail
   1639 expect() calls
  Ran 387 tests across 48 files. [178.14s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:12:58 [content] Syncing content
  @skillmaker/viewer build: 11:12:58 [content] Synced content
  @skillmaker/viewer build: 11:12:58 [types] Generated 38ms
  @skillmaker/viewer build: 11:12:58 [build] output: "static"
  @skillmaker/viewer build: 11:12:58 [build] mode: "static"
  @skillmaker/viewer build: 11:12:58 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:12:58 [build] Collecting build info...
  @skillmaker/viewer build: 11:12:58 [build] ✓ Completed in 70ms.
  @skillmaker/viewer build: 11:12:58 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:12:59 [vite] ✓ built in 981ms
  @skillmaker/viewer build: 11:12:59 [build] ✓ Completed in 1.00s.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:12:59 [vite] transforming...
  @skillmaker/viewer build: 11:13:01 [vite] ✓ 252 modules transformed.
  @skillmaker/viewer build: 11:13:01 [vite] rendering chunks...
  @skillmaker/viewer build: 11:13:01 [vite] computing gzip size...
  @skillmaker/viewer build: 11:13:01 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:13:01 [vite] dist/_astro/NextShell.CG879Gff.js  183.01 kB │ gzip: 56.13 kB
  @skillmaker/viewer build: 11:13:01 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:13:01 [vite] ✓ built in 1.94s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:13:01 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:13:01   └─ /index.html (+23ms) 
  @skillmaker/viewer build: 11:13:01 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:13:01   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:13:01 ✓ Completed in 48ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:13:01 [build] 2 page(s) built in 3.07s
  @skillmaker/viewer build: 11:13:01 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```

## Stage: review_judge
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > **fix**
  > 
  > The deterministic repo gates passed, and package boundaries are clean, but the change is not yet mergeable. Acceptance-critical behavior is broken or untested.
  > 
  > Required fixes:
  > 
  > 1. Fix built-preview SPA fallback. A direct probe of `/p/team/s/alpha/research?v=12345678` through `astro preview` returns 404. Correct [astro.config.mjs](/home/daytona/workspace/skillmaker-studio/packages/viewer/astro.config.mjs:11) and add the planned preview HTTP E2E so this cannot pass unnoticed.
  > 
  > 2. Repair version routing. [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx:214) slices the full `sha256:` hash instead of using `SkillVersion.shortHash`, producing an invalid query and dropping every picker-selected pin. Resolve URL pins against live versions, require exactly one match, and replace stale or ambiguous pins with the same skill/tab URL without `v`.
  > 
  > 3. Implement safe route reconciliation:
  > 
  >    - Keep project-scoped descendants behind a route/project-scope agreement boundary.
  >    - Make `/tasks` wait for bootstrap and choose only a healthy stored-or-first project. It currently remains unresolved when storage is empty and selects stale/broken stored projects otherwise.
  >    - Replace the inline registry check with authoritative tri-state validation. Broken projects, malformed identity rows, and unavailable skill lists must not prove a route stale.
  >    - Prevent bootstrap from temporarily serving another project’s data under the routed URL.
  > 
  > 4. Correct request and project identity handling. `useApiData` must include resource/fetcher identity, not only project identity, or same-project skill navigation can show the previous skill indefinitely after a failed request. Project-qualify chat effects, drafts, scroll positions, tab-seen state, and presence as specified in the proposal. Also remount/reset the launcher when its routed project changes so project A’s candidates and collision set cannot be used for project B.
  > 
  > 5. Complete the navigation contract. Use real `href` links with guarded History API interception for Sidebar, Board, and tabs, preserving modified clicks and copy/open-in-new-tab behavior. Avoid redundant history entries for same-location navigation.
  > 
  > 6. Add the missing acceptance coverage. The current E2E only proves that the CLI server returns shell HTML; it does not prove a deep route renders the requested project, skill, tab, or version. Add the planned focused browser suite covering cold load/reload, tab navigation, Back/Forward, conflicting stored project preference, same-slug cross-project navigation, and launcher handoff. Add focused unit coverage for route canonicalization, registry reconciliation, stale versions, bare Tasks, and request identity.
  > 
  > Imperfections to note in the eventual PR body:
  > 
  > - The parser currently accepts interior duplicate slashes and explicit `/overview`.
  > - The breadcrumb displays the project slug rather than its resolved display name.
  > - The fallback plugin retains a dev-only name despite serving dev and preview.
  > 
  > No `docs/library`, core, or CLI implementation files were improperly changed.
  > 
  > {"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}

## Current context
| Key | Value |
|-----|-------|
| verdict | fix |


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
