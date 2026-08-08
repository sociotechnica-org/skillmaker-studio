Implemented #195’s non-destructive SSE reconnect behavior.

- Buffered chat frames now have sequential SSE IDs; the server reads `Last-Event-ID` and replays only missed events. Invalid, stale, absent, or post-restart cursors receive the non-rendering `replay_reset` control frame before a full replay. See [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:717) and [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:2826).
- The viewer no longer clears transcript events when `EventSource` reopens. It clears only on `replay_reset`, so an ordinary reconnect cannot collapse the transcript or disturb the scroll/near-bottom state. See [chatApi.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/chatApi.ts:160).
- Added focused reconciliation and resumable-SSE coverage, plus e2e assertions for zero-replay reconnects, missed suffixes, ordered IDs, and duplicate prevention.

I removed an unrelated `JournalWatcher` polling change that had been added during the prior failed validation attempt, keeping the resulting diff scoped to this issue. The reported `IndexService` timeout was transient: it passed both in isolation and in the full package suite.

Validation passed:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun run build:viewer`
- `bun test packages` — 1077 passed
- `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips