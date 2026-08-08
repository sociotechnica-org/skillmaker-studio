I’m unable to write files in this interface. The requested file contents are:

`/tmp/fabro-pr-title.txt`
```text
Fix chat transcript loss on SSE reconnect
```

`/tmp/fabro-pr-body.md`
```md
## Suggested PR title

Fix chat transcript loss on SSE reconnect

## Summary

Implements the resumable SSE reconnect plan in `docs/proposals/2026-08-08-chat-sse-resumable-reconnect.md`.

- Server-side buffered chat events are emitted with sequential SSE IDs and resume from `Last-Event-ID`.
- Initial, invalid, stale, or replaced-session cursors receive a `replay_reset` control frame followed by a full indexed replay.
- Valid reconnects replay only events missed while disconnected, avoiding duplicate transcript items.
- The viewer no longer clears events when `EventSource` opens; it clears only when receiving `replay_reset`.
- This preserves the existing transcript DOM, scroll position, and `nearBottom` guard across ordinary reconnects.
- Added focused resumable-stream coverage and updated e2e assertions for replay framing, missed suffixes, ordering, and duplicate prevention.

## Validation

Passed:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages` — 1077 passed
- `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips
- `bun run build:viewer`
- `./.fabro/scripts/fabro-validate` — all repository gates passed

## Imperfections to note

- Header-validation tests use an empty manager, so malformed and out-of-range IDs are not directly exercised against a populated live buffer.
- The e2e test does not explicitly combine prefix and resumed suffix IDs for its duplicate assertion.
- The scroll-sentinel test is contract-level and somewhat tautological; it does not directly exercise `RightPanel` or guard against reintroducing an `open`-time clear. The repository has no browser/component test harness, and the production path itself is correct.

## Remaining risks and follow-up

No browser-level manual scroll test was run. Scroll preservation is achieved by avoiding the reconnect-time transcript wipe, and is covered indirectly by the reconnect/replay contract rather than by a mounted `RightPanel` test. Keepalive behavior remains separate from this change and is not modified here.
```