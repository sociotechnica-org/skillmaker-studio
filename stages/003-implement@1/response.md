Implemented #195’s non-destructive SSE reconnect path.

- Server chat streams now assign each buffered event its zero-based SSE `id`, read `Last-Event-ID`, and replay only the missing suffix on a valid reconnect.
- Fresh, stale, malformed, out-of-range, or post-restart cursors receive an unindexed `replay_reset` followed by the full indexed buffer.
- `replay_reset` is transport-only and excluded from buffered history/subscriber delivery.
- The viewer no longer clears events on `EventSource` open; it clears only on `replay_reset`. `RightPanel` was intentionally left unchanged, so valid reconnects preserve both item count and its scroll/near-bottom state.
- Added focused viewer reconciliation/model tests, server framing/validation tests, and e2e coverage for initial framing, no-miss resumes, missed suffix replay, ordered IDs, and duplicate prevention.

Key files: [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts), [chatApi.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/chatApi.ts), [chat-sessions.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/chat-sessions.e2e.test.ts).

Validation:

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: `bun run build:viewer`
- Passed: `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips
- Passed: all new/focused chat tests

One required gate is blocked by an unrelated existing test: `bun test packages` consistently fails `packages/cli/test/JournalWatcher.test.ts` (“fires (debounced) on appends to an existing journal”), while its other two tests pass. This failure reproduces when that file runs alone and is outside this issue’s scope.