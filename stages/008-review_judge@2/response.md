**surface**

The second implementation round did not resolve the acceptance-critical defects identified in the first review:

- Route reconciliation still treats broken or malformed registry evidence as authoritative absence and redirects valid routes to `/board` ([NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx:94)).
- Malformed or duplicate version pins invalidate the entire route instead of removing only `v` ([router.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/router.tsx:41)).
- API state remains keyed only by project, allowing prior-skill data to render briefly after same-project navigation ([api.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/api.ts:385)).
- Chat drafts, transcript positions, and tab-seen state remain slug-only, leaking state between projects with identical skill slugs.
- The required browser suite is absent. Cold load, reload, Back/Forward, conflicting localStorage, cross-project same-slug navigation, version retention, and launcher handoff are therefore unverified.
- Preview and distributed fallback parity lack the planned E2E coverage; the custom preview server also diverges from existing serving behavior for internal paths, methods, and directory indexes.

The deterministic gates passed, focused router tests passed, the source `skillmaker start` deep-path test passed, package boundaries are clean, and no `docs/library` files were changed. Those positives do not cover the broken reconciliation behavior or missing acceptance-level browser tests.

Imperfections that would otherwise only need PR-body notation include accepting interior duplicate slashes, displaying project slugs instead of resolved names, and re-fetching registry identity on tab-only navigation.

{"preferred_next_label":"Surface","outcome":"failed","failure_reason":"The fix round still leaves broken route reconciliation and version recovery, cross-project state leakage, and no browser-level proof of cold-load or Back/Forward behavior.","context_updates":{"verdict":"surface"}}