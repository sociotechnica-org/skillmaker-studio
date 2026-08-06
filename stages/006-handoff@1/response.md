I’ll create the requested PR title and reviewer-context body, including the validation results and the review notes verbatim.I can’t write to the requested filesystem paths from this environment. The intended contents are:

`/tmp/fabro-pr-title.txt`
```text
fix(cli): keep chat SSE streams alive
```

`/tmp/fabro-pr-body.md`
```md
## Summary

Implements Issue #194 following `docs/proposals/2026-08-06-chat-sse-keepalive.md`.

- Adds a per-chat-stream SSE comment keepalive (`: keepalive\n\n`) every 15 seconds, including streams opened before a live chat session exists.
- Clears each connection’s interval when the stream is cancelled.
- Moves the existing machine-events heartbeat cadence into shared SSE configuration; `/api/events-stream` continues to use the same 15-second cadence.
- Leaves `idleTimeout: 30`, chat replay behavior, `ChatStreamEvent`, and viewer handling unchanged.
- Adds deterministic coverage for keepalive wire shape and cadence, the no-live-session case, comment-only behavior, and interval cleanup across disconnected streams.

## Validation

Passed:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages`
- `bun test test/e2e --timeout 30000`
- Repository validation gates: 370 passed, 16 skipped, 0 failed.

`bun run build:viewer` was not run as a validation gate because no viewer source changed. Viewer assets were built only as required for the e2e server setup.

## Review notes

- The cadence test advances all eight intervals together before draining frames rather than checking each period individually. It still verifies the production delay, exact frame count and shape, and open-stream behavior.
- The 120-second survival test operates at the stream layer with deterministic timers rather than holding a real HTTP connection for two minutes. A live connection was separately observed surviving the relevant 30-second Bun idle boundary with keepalives around 15 and 30 seconds.

## Remaining gaps

The automated survival test does not keep a real HTTP connection open for a full two minutes; it verifies the stream behavior with deterministic timers. Sixteen unrelated integration tests remain skipped because they require distributed binaries or real external ACP/Codex configuration.
```