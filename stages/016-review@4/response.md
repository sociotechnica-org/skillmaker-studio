The Issue #190 implementation itself is ready: chat resolves each helper workspace-first and packaged-second, preserves unresolved destinations, replaces resolved stale copies, and reports provenance. Direct coverage exercises packaged-only, workspace-only, mixed/layout precedence, missing-source preservation, and repeat replacement; the server E2E verifies a fresh project receives both packaged helpers without leaking them into project bundles or catalog APIs. No `docs/library` files changed, and comments cite #190 and the D6 proposal appropriately.

One blocking scope issue remains: [JournalWatcher.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:33) gained a 150 ms watcher-readiness delay solely to make an unrelated package-test gate pass. This is not part of #190 and conflicts with the request to stay minimal and fix nothing adjacent. Remove that unrelated test change; then rerun the relevant package gate (retrying the flaky test if needed) and retain only the chat fallback implementation, its focused tests, E2E coverage, and the approved proposal.

The recorded gate run otherwise passed, including 375 E2E tests (9 environment-gated skips); there are no current validation failures to diagnose.

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```