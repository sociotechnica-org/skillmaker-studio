Implemented Issue #194.

- Chat SSE responses now emit `: keepalive\n\n` every 15 seconds, including no-live-session picker streams, with a response-owned interval cleared on cancellation: [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:688).
- `HEARTBEAT_MS` is shared by chat and machine event streams through [Sse.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Sse.ts:1); `idleTimeout: 30` is unchanged.
- Added deterministic timer/cleanup coverage: [ChatSessions.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSessions.test.ts:14).
- Added real-server no-session SSE coverage across the 30-second idle window, verifying two keepalives, one connection frame, and no extra data frames: [chat-keepalive.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/chat-keepalive.e2e.test.ts:31).
- While running the mandated package gate, an existing `JournalWatcher` test consistently exposed a Bun native-watch registration race. I added a one-turn signature check to preserve its existing freshness guarantee: [JournalWatcher.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/JournalWatcher.ts:45).

Validation passed:

```text
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages                  # 1061 pass
bun test test/e2e --timeout 30000  # 371 pass, 16 intentional skips
```

Also passed the viewer build and focused chat stream regressions. `git diff --check` is clean; the diff is 6 files, 177 added / 7 removed lines.