Implemented the Issue #208 core routing slice.

Key changes:

- Added URL-authoritative next-shell routing in [router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx):
  - `/board`, `/tasks`, project Board, project Tasks, New Skill, skill tabs, and `?v=<shortHash>`.
  - `pushState` navigation, `replaceState` canonicalization/recovery, and `popstate` Back/Forward handling.
  - Invalid/stale project or skill routes recover to `/board`.

- Converted the mounted shell in [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx) from in-memory center/pin state to route-derived rendering.
  - Sidebar, Board cards, launcher handoff, tabs, and version picker now update the URL.
  - Project scope is synchronized before routed project content runs.
  - Right-panel open state is persisted locally and remains out of the URL.
  - New-skill chat handoff is qualified by project and skill.

- Updated [Sidebar.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/Sidebar.tsx), [views.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/views.tsx), and [SkillPage.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/SkillPage.tsx) for controlled route navigation, project-filtered Board, and route-controlled skill tabs with `aria-current`.

- Prevented cross-project stale API data flashes in [api.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/api.ts).

- Switched the Astro shell to client-only mounting in [index.astro](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/pages/index.astro), and applied SPA fallback to preview as well as dev in [astro.config.mjs](/home/daytona/workspace/skillmaker-studio/packages/viewer/astro.config.mjs).

- Added pure route coverage in [router.test.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.test.ts) and updated the server E2E to request a canonical deep skill URL in [phase3.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/phase3.e2e.test.ts).

Validation:

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: viewer TypeScript check, router unit tests, and `bun run build:viewer`
- Passed once: `bun test test/e2e --timeout 30000` — 370 passed, 17 expected skips.
- Verified manually: `skillmaker start` serves the rebuilt shell at `/` (200); the existing server fallback handles arbitrary-depth non-asset paths.

One gate remains externally blocked: `bun test packages` fails in the pre-existing `packages/cli/test/JournalWatcher.test.ts` test (“fires (debounced) on appends to an existing journal”). It also fails identically when run alone, and no watcher/server code was changed by this routing work.