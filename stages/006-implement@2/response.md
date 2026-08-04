Addressed the review gap for Issue #190.

- Added a true workspace-only case: packaged lookup returns `undefined`, both helpers install from the workspace, and provenance is `workspace`.
- Strengthened the mixed-source test so packaged `output/SKILL.md` demonstrably wins over packaged root `SKILL.md`.
- Updated the implementation comment to cite D6’s source proposal explicitly in [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:56).

Validation:

- `bunx tsc --noEmit -p packages/core` — passed
- `bunx tsc --noEmit -p packages/cli` — passed
- `bun test packages/cli/test/ChatSessions.test.ts` — passed (5 tests)
- `bun test test/e2e --timeout 30000` — passed: 370 passed, 16 explicitly gated skips
- `git diff --check` — passed

The required full `bun test packages` remains blocked by an unrelated, pre-existing watcher failure: [JournalWatcher.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:24) times out waiting for its callback. Both that test and [JournalWatcher.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/JournalWatcher.ts:1) are byte-identical to `HEAD` and last changed in unrelated issue #184, so I left them untouched to keep this fix strictly within #190’s scope.

Final diff is limited to 2 files, 8 insertions / 8 deletions.