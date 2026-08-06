Implemented Issue #194 with no viewer, replay, or timeout-policy changes.

- Chat SSE responses now emit `: keepalive\n\n` every shared 15 seconds and clear that per-connection interval on stream cancellation: [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:701).
- Extracted the existing machine-event heartbeat cadence into shared [Sse.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Sse.ts:1); `/api/events-stream` continues using the same 15-second value through [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:87).
- Added deterministic coverage for the pre-session/no-live-chat path, eight keepalives over 120 virtual seconds, comment-only payload behavior, and cleanup across multiple disconnected streams: [ChatSseKeepalive.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSseKeepalive.test.ts:1).
- `idleTimeout: 30` remains unchanged.

Validation passed:

```text
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

Also passed the focused keepalive and chat-session e2e tests. I built the viewer solely to provide the e2e server’s required static assets; no viewer source was changed.