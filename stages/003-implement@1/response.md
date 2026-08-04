Implemented Issue #190.

`prepareAgentHome` now resolves each William helper independently in this order: workspace `output/`, workspace root, packaged `output/`, packaged root. Workspace copies win; packaged skills supply fresh projects. Resolved helpers replace stale agent-home copies and return source-aware provenance.

Changed:

- [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:56) imports and uses `locatePackagedSkillsDir()` with a narrow injectable locator seam for tests.
- [ChatSessions.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSessions.test.ts:1) adds direct coverage for packaged-only, workspace override, mixed sources/layout precedence, missing sources preserving destinations, idempotency, stale replacement, and no project write.
- [chat-sessions.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/chat-sessions.e2e.test.ts:238) now uses a genuinely fresh workspace and verifies both packaged helpers are seeded only into agent home—not the project, bundle list, or catalog.

Validation completed:

- `bunx tsc --noEmit -p packages/core` — pass
- `bunx tsc --noEmit -p packages/cli` — pass
- `bun run build:viewer` — pass (required E2E prerequisite)
- `bun test packages/cli/test/ChatSessions.test.ts` — pass
- `bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000` — pass
- `bun test test/e2e --timeout 30000` — pass: 370 passed, 16 expected skips
- `git diff --check` — pass

One required gate remains blocked by an unrelated existing test: `bun test packages` failed twice, including when [JournalWatcher.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:24) was run alone. Its unchanged “fires on appends to an existing journal” assertion times out after 3 seconds. The same test is byte-identical at `HEAD`; I left it untouched to keep this issue strictly scoped. The implementation’s direct package test passes.