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
Pipeline progress: 3 of 5 stages completed

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


# ReviewJudge

You are the single review-and-verdict gate before the PR. Review the
implementation diff against the scope plan (under `docs/proposals/`, named
by the scope stage) and the house rules, read the gates output from the
previous stage, and deliver ONE verdict. Do not edit any files.

Check:

- The diff stays within the plan's scope and package boundaries: domain
  logic and schemas in `packages/core`, deterministic CLI/server behavior
  in `packages/cli`, browser UI in `packages/viewer`.
- Comments are plain English prose explaining WHY, citing issues, dated
  proposals, and rulings (`packages/core/src/Todo.ts` is the standard).
- Behavior changes have tests (black-box CLI tests for CLI behavior,
  `test/e2e` for server-surface changes).
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- The deterministic gates output shows the repo gates passed on the final
  diff.

Grading bar — this line is load-bearing: a mergeable change with noted
imperfections is a PASSING grade — perfectionism is the expensive failure
mode; note imperfections in the PR body instead of bouncing. Only route
Fix for real defects: broken or untested behavior, scope/plan mismatch,
boundary violations, failing gates. Style nits, minor gaps, and "could be
better" observations go in a short "Imperfections to note in the PR body"
list in your response, which the Prepare PR stage will include.

Verdicts (exactly one):

- **ready** — the change is mergeable. List any imperfections for the PR
  body, then route to Prepare PR.
- **fix** — a real defect blocks merge. Allowed AT MOST ONCE per run (the
  graph enforces this: this node runs at most twice, so on your second
  run Fix is off the table — choose ready or surface). Give concrete,
  actionable fix items so the implement stage can act without guessing.
- **surface** — you and the implementation cannot converge (e.g. the fix
  round did not resolve the defect, or the plan itself is wrong). Stop
  the run with a clear summary of the disagreement for a human.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}
```

or:

```json
{"preferred_next_label":"Surface","outcome":"failed","failure_reason":"<one-line summary of the disagreement>","context_updates":{"verdict":"surface"}}
```
