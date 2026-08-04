Ready for pull request.

The committed delta from `main` is limited to the #194 chat-SSE transport fix, shared server-side heartbeat cadence, targeted CLI lifecycle coverage, and a black-box E2E test. It leaves `packages/core`, `packages/viewer`, `docs/library`, chat event types, replay behavior, and `idleTimeout: 30` unchanged.

The implementation emits `: keepalive\n\n` per chat connection every shared 15 seconds, including no-session streams, routes writes through the existing disconnect-safe enqueue path, and clears the exact response timer on cancellation. Existing chat-session E2E coverage is unchanged.

Validation evidence is clean: typechecks, targeted tests, and the full repository gate all passed (371 E2E passes, 16 intentional skips). The viewer build was correctly skipped because no viewer files changed. The only noted coverage opportunities—active-session heartbeat timing and an explicit post-cancel tick—are non-blocking because existing replay/session E2E coverage remains intact and the write path is guarded.

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```