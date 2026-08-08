Implemented and validated #195’s resumable chat SSE reconnect behavior.

- Chat stream frames now carry buffered event indices as SSE IDs and use `Last-Event-ID` to replay only missed suffix events.
- Fresh, invalid, stale, and post-restart streams emit the non-rendering `replay_reset` control frame before a full indexed replay.
- The viewer no longer clears transcript state on EventSource open; only `replay_reset` clears it, preserving scroll position and the near-bottom guard on ordinary reconnects.
- Added server/viewer/e2e coverage for reset framing, resume-without-replay, missed-event replay, ordered IDs, and duplicate prevention.

The prior validation failure was reproducible in the unrelated journal watcher test: Bun could miss an append made immediately after `fs.watch()` returned. I added a small stat-based polling backstop in [JournalWatcher.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/JournalWatcher.ts:18), with cleanup on close, so the required gate is reliable.

All required gates passed:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun run build:viewer`
- `bun test packages` — 1077 passed
- `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips

The working tree contains only the JournalWatcher validation fix; the #195 implementation is in the existing implementation commit.