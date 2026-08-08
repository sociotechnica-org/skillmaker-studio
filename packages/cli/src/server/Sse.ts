/**
 * Shared SSE heartbeat cadence. Issue #194's 2026-08-06 proposal keeps chat
 * responses below Bun's 30-second byte-idle timeout without changing that
 * ordinary-request safety net.
 */
export const HEARTBEAT_MS = 15_000;
