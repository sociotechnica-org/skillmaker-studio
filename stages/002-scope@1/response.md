Created the durable implementation plan at [2026-08-06-chat-sse-keepalive.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-06-chat-sse-keepalive.md).

It verifies the current defect, defines the shared heartbeat constant and per-response cleanup design, specifies deterministic 120-second fake-timer coverage, preserves `idleTimeout`, replay behavior, and viewer code, and documents risks and deferred work. No implementation files were changed.

Plan ready for implementation: docs/proposals/2026-08-06-chat-sse-keepalive.md