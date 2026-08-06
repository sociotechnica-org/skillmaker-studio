**ready**

The change is mergeable. It matches the approved scope:

- Per-connection 15-second comment keepalive, including the no-live-session path.
- Interval cleanup on stream cancellation.
- Shared cadence without changing `/api/events-stream` behavior or `idleTimeout: 30`.
- No viewer, event-schema, replay, or transcript changes.
- Deterministic tests cover 120 virtual seconds, wire shape, no data events, and cleanup.
- Existing chat e2e tests remain unmodified and pass.
- No `docs/library`, core, or viewer files were changed.
- Final repository gates passed: 370 passed, 16 skipped, 0 failed.

Imperfections to note in the PR body:

- The cadence test advances all eight intervals together before draining frames rather than checking each period individually. It still verifies the production delay, exact frame count and shape, and open-stream behavior.
- The 120-second survival test operates at the stream layer with deterministic timers rather than holding a real HTTP connection for two minutes. A live connection was separately observed surviving the relevant 30-second Bun idle boundary with keepalives around 15 and 30 seconds.

{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}