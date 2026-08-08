**fix**

The deterministic repo gates passed, and package boundaries are clean, but the change is not yet mergeable. Acceptance-critical behavior is broken or untested.

Required fixes:

1. Fix built-preview SPA fallback. A direct probe of `/p/team/s/alpha/research?v=12345678` through `astro preview` returns 404. Correct [astro.config.mjs](/home/daytona/workspace/skillmaker-studio/packages/viewer/astro.config.mjs:11) and add the planned preview HTTP E2E so this cannot pass unnoticed.

2. Repair version routing. [NextShell.tsx](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/NextShell.tsx:214) slices the full `sha256:` hash instead of using `SkillVersion.shortHash`, producing an invalid query and dropping every picker-selected pin. Resolve URL pins against live versions, require exactly one match, and replace stale or ambiguous pins with the same skill/tab URL without `v`.

3. Implement safe route reconciliation:

   - Keep project-scoped descendants behind a route/project-scope agreement boundary.
   - Make `/tasks` wait for bootstrap and choose only a healthy stored-or-first project. It currently remains unresolved when storage is empty and selects stale/broken stored projects otherwise.
   - Replace the inline registry check with authoritative tri-state validation. Broken projects, malformed identity rows, and unavailable skill lists must not prove a route stale.
   - Prevent bootstrap from temporarily serving another project’s data under the routed URL.

4. Correct request and project identity handling. `useApiData` must include resource/fetcher identity, not only project identity, or same-project skill navigation can show the previous skill indefinitely after a failed request. Project-qualify chat effects, drafts, scroll positions, tab-seen state, and presence as specified in the proposal. Also remount/reset the launcher when its routed project changes so project A’s candidates and collision set cannot be used for project B.

5. Complete the navigation contract. Use real `href` links with guarded History API interception for Sidebar, Board, and tabs, preserving modified clicks and copy/open-in-new-tab behavior. Avoid redundant history entries for same-location navigation.

6. Add the missing acceptance coverage. The current E2E only proves that the CLI server returns shell HTML; it does not prove a deep route renders the requested project, skill, tab, or version. Add the planned focused browser suite covering cold load/reload, tab navigation, Back/Forward, conflicting stored project preference, same-slug cross-project navigation, and launcher handoff. Add focused unit coverage for route canonicalization, registry reconciliation, stale versions, bare Tasks, and request identity.

Imperfections to note in the eventual PR body:

- The parser currently accepts interior duplicate slashes and explicit `/overview`.
- The breadcrumb displays the project slug rather than its resolved display name.
- The fallback plugin retains a dev-only name despite serving dev and preview.

No `docs/library`, core, or CLI implementation files were improperly changed.

{"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}