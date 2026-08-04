The #194 keepalive implementation remains intact and its focused tests pass. I removed the unrelated `JournalWatcher` change identified in review, leaving the issue diff scoped to:

- `ChatSessions` per-connection `: keepalive\n\n` timer and cancellation cleanup
- shared `HEARTBEAT_MS` in `Sse.ts`, imported by chat and machine SSE
- deterministic chat-stream lifecycle test
- 30-second real-server keepalive E2E

Focused validation passed:

```text
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages/cli/test/ChatSessions.test.ts
bun test test/e2e/chat-keepalive.e2e.test.ts --timeout 45000
```

I cannot truthfully complete the required full package gate after enforcing the scope correction: the pre-existing [JournalWatcher.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:23) now fails its first existing-journal append test because Bun misses the write that races native `fs.watch` registration. The removed `JournalWatcher` change was specifically added to mask that race, but it is unrelated to #194 and violates the issue’s explicit scope fence.

The scoped Issue #194 diff is clean: 5 files, 162 additions / 6 deletions. The only current working-tree change is the deliberate removal of the out-of-scope watcher workaround in [JournalWatcher.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/JournalWatcher.ts:15).

A decision is needed: either accept the unrelated watcher fix in this change solely to make the full gate pass, or land/repair that watcher race independently and then rerun the full gates for #194.