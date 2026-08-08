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
Pipeline progress: 6 of 5 stages completed

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
  > Implemented the Issue #208 routing fixes and resolved the review findings.
  > 
  > Highlights:
  > 
  > - URL routing is canonicalized and avoids duplicate history entries; project/task/skill/tab navigation uses shareable hrefs with guarded client-side interception.
  > - Version pins now serialize real short hashes, validate against live skill versions, and remove stale/ambiguous pins without losing the current skill/tab route.
  > - Route reconciliation now waits for healthy project bootstrap data, rejects broken project routes, and avoids stale project/skill data being shown after navigation.
  > - API data resets on fetcher/resource identity changes, preventing one skill’s failed fetch from leaving a previous skill visible.
  > - Project-qualified presence and launcher remounting prevent same-slug/project-switch leakage.
  > - Right-panel state remains local-only.
  > - Added a built-dist SPA preview server via `bun run --filter @skillmaker/viewer preview`; it serves arbitrary non-asset deep paths as the app shell. Verified `/p/team/s/alpha/research?v=deadbeef` returns HTTP 200.
  > - Expanded focused routing and identity regression coverage.
  > 
  > Key files include [router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx), [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx), [views.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/views.tsx), and [preview.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/scripts/preview.ts).
  > 
  > Validation passed:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun test packages` — 1077 passed
  > - `bun test test/e2e --timeout 30000` — 370 passed, 17 expected skips
  > - `bun run build:viewer`
  > - Built-viewer deep-route preview probe — HTTP 200

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (3524 lines omitted)
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
  Ran 387 tests across 48 files. [181.94s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:32:38 [content] Syncing content
  @skillmaker/viewer build: 11:32:38 [content] Synced content
  @skillmaker/viewer build: 11:32:38 [types] Generated 25ms
  @skillmaker/viewer build: 11:32:38 [build] output: "static"
  @skillmaker/viewer build: 11:32:38 [build] mode: "static"
  @skillmaker/viewer build: 11:32:38 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:32:38 [build] Collecting build info...
  @skillmaker/viewer build: 11:32:38 [build] ✓ Completed in 63ms.
  @skillmaker/viewer build: 11:32:38 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:32:38 [vite] ✓ built in 919ms
  @skillmaker/viewer build: 11:32:38 [build] ✓ Completed in 942ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:32:38 [vite] transforming...
  @skillmaker/viewer build: 11:32:40 [vite] ✓ 252 modules transformed.
  @skillmaker/viewer build: 11:32:40 [vite] rendering chunks...
  @skillmaker/viewer build: 11:32:41 [vite] computing gzip size...
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/NextShell.BAJyqgZt.js  184.15 kB │ gzip: 56.56 kB
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:32:41 [vite] ✓ built in 2.07s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:32:41 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:32:41   └─ /index.html (+5ms) 
  @skillmaker/viewer build: 11:32:41 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:32:41   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:32:41 ✓ Completed in 20ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:32:41 [build] 2 page(s) built in 3.10s
  @skillmaker/viewer build: 11:32:41 [build] Complete!
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

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented the Issue #208 routing fixes and resolved the review findings.
  > 
  > Highlights:
  > 
  > - URL routing is canonicalized and avoids duplicate history entries; project/task/skill/tab navigation uses shareable hrefs with guarded client-side interception.
  > - Version pins now serialize real short hashes, validate against live skill versions, and remove stale/ambiguous pins without losing the current skill/tab route.
  > - Route reconciliation now waits for healthy project bootstrap data, rejects broken project routes, and avoids stale project/skill data being shown after navigation.
  > - API data resets on fetcher/resource identity changes, preventing one skill’s failed fetch from leaving a previous skill visible.
  > - Project-qualified presence and launcher remounting prevent same-slug/project-switch leakage.
  > - Right-panel state remains local-only.
  > - Added a built-dist SPA preview server via `bun run --filter @skillmaker/viewer preview`; it serves arbitrary non-asset deep paths as the app shell. Verified `/p/team/s/alpha/research?v=deadbeef` returns HTTP 200.
  > - Expanded focused routing and identity regression coverage.
  > 
  > Key files include [router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx), [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx), [views.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/views.tsx), and [preview.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/scripts/preview.ts).
  > 
  > Validation passed:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun test packages` — 1077 passed
  > - `bun test test/e2e --timeout 30000` — 370 passed, 17 expected skips
  > - `bun run build:viewer`
  > - Built-viewer deep-route preview probe — HTTP 200

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (3524 lines omitted)
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
  Ran 387 tests across 48 files. [181.94s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:32:38 [content] Syncing content
  @skillmaker/viewer build: 11:32:38 [content] Synced content
  @skillmaker/viewer build: 11:32:38 [types] Generated 25ms
  @skillmaker/viewer build: 11:32:38 [build] output: "static"
  @skillmaker/viewer build: 11:32:38 [build] mode: "static"
  @skillmaker/viewer build: 11:32:38 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:32:38 [build] Collecting build info...
  @skillmaker/viewer build: 11:32:38 [build] ✓ Completed in 63ms.
  @skillmaker/viewer build: 11:32:38 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:32:38 [vite] ✓ built in 919ms
  @skillmaker/viewer build: 11:32:38 [build] ✓ Completed in 942ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:32:38 [vite] transforming...
  @skillmaker/viewer build: 11:32:40 [vite] ✓ 252 modules transformed.
  @skillmaker/viewer build: 11:32:40 [vite] rendering chunks...
  @skillmaker/viewer build: 11:32:41 [vite] computing gzip size...
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/NextShell.BAJyqgZt.js  184.15 kB │ gzip: 56.56 kB
  @skillmaker/viewer build: 11:32:41 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:32:41 [vite] ✓ built in 2.07s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:32:41 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:32:41   └─ /index.html (+5ms) 
  @skillmaker/viewer build: 11:32:41 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:32:41   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:32:41 ✓ Completed in 20ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:32:41 [build] 2 page(s) built in 3.10s
  @skillmaker/viewer build: 11:32:41 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```

## Current context
| Key | Value |
|-----|-------|
| verdict | fix |


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
