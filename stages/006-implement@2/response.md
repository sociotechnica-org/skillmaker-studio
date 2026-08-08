Implemented the Issue #208 routing fixes and resolved the review findings.

Highlights:

- URL routing is canonicalized and avoids duplicate history entries; project/task/skill/tab navigation uses shareable hrefs with guarded client-side interception.
- Version pins now serialize real short hashes, validate against live skill versions, and remove stale/ambiguous pins without losing the current skill/tab route.
- Route reconciliation now waits for healthy project bootstrap data, rejects broken project routes, and avoids stale project/skill data being shown after navigation.
- API data resets on fetcher/resource identity changes, preventing one skill’s failed fetch from leaving a previous skill visible.
- Project-qualified presence and launcher remounting prevent same-slug/project-switch leakage.
- Right-panel state remains local-only.
- Added a built-dist SPA preview server via `bun run --filter @skillmaker/viewer preview`; it serves arbitrary non-asset deep paths as the app shell. Verified `/p/team/s/alpha/research?v=deadbeef` returns HTTP 200.
- Expanded focused routing and identity regression coverage.

Key files include [router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx), [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx), [views.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/views.tsx), and [preview.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/scripts/preview.ts).

Validation passed:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages` — 1077 passed
- `bun test test/e2e --timeout 30000` — 370 passed, 17 expected skips
- `bun run build:viewer`
- Built-viewer deep-route preview probe — HTTP 200