Goal: GitHub Issue #194: Chat SSE stream has no keepalive — Bun's idleTimeout tears it down every 30s, jumping the reader to the bottom

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/194

## Summary

The chat SSE stream sends no periodic keepalive, so Bun's `idleTimeout: 30`
tears the connection down every 30 seconds of quiet. The browser's `EventSource`
silently reconnects, the server replays the transcript buffer, and the reader —
who may be scrolled up mid-transcript — is yanked to the bottom. The
machine-level `/api/events-stream` already solves this with a 15 s heartbeat;
the chat stream never got one.

## Motivation / Problem

Observable cost: you cannot read a chat transcript. Scroll up to reread
something the agent said and roughly every 30 seconds, with no interaction and
no agent activity, the panel jumps to the bottom. On a long research
conversation — exactly the material worth rereading — the transcript is
effectively unreadable while the session is open.

Underneath the visible symptom, every idle chat session is churning: a
connection torn down and re-established twice a minute, each reconnect replaying
the entire event buffer over the wire, forever, for as long as the panel is
open.

The transcript-position damage on reconnect is a **separate defect** and is
filed alongside this one — this issue removes the 30-second cadence; the
companion makes any future reconnect (network blip, laptop sleep, server
restart) harmless. Either can be built first.

## Observed behavior

Open a chat panel on any skill, let the session go quiet, scroll to the middle
of the transcript, and touch nothing. In roughly 25-30 seconds the panel jumps
to the bottom. Repeats indefinitely. Confirmed by hand at >25 s.

The server log shows no error; nothing in the UI indicates the stream dropped
and came back.

## Current shape

The machine-level events stream is the working sibling — it has a heartbeat.
`packages/cli/src/server/Server.ts:89`:

```ts
const HEARTBEAT_MS = 15_000;
```

driven at `Server.ts:2911` and written at `Server.ts:2535`:

```ts
  const heartbeat = setInterval(broadcaster.onHeartbeat, HEARTBEAT_MS);
```
```ts
    onHeartbeat: () => broadcast(": heartbeat\n\n"),
```

The chat stream is built separately, in `ChatSessions.streamResponse`
(`packages/cli/src/server/ChatSessions.ts:688-719`), and has **no interval at
all** — one comment frame at connect, then bytes only when a real session event
occurs:

```ts
        controller.enqueue(encoder.encode(": connected\n\n"));
        sendEvent({ type: "state", state: this.state(skill) });
        if (chat !== undefined) {
          for (const event of chat.events) sendEvent(event);
          subscriber = sendEvent;
          chat.subscribers.add(sendEvent);
          chat.lastActivityAt = Date.now();
        }
```

Meanwhile `Server.ts:2914-2923` sets a 30-second per-connection idle timeout,
with a comment that explains what it was reasoning about — cold-start request
bursts — and does not consider long-lived SSE streams, which are idle by design:

```ts
    // Explicit safety net, not a fix by itself: Bun's default per-connection
    // idle timeout is 10s, which a concurrent-request burst on cold start
    // ... 30s gives real (non-runaway) requests headroom without hiding a
    // genuine hang.
    idleTimeout: 30,
```

Sequence: 30 s of no bytes → Bun closes the socket → `EventSource` reconnects
(UA default retry, ~3 s in Chrome; the server never sends a `retry:` field) →
observed period ≈ 30-33 s, matching the report.

Note `streamResponse` also serves the case where **no live session exists** (the
pre-session model picker holds this stream open). That connection produces no
events by definition, so it is torn down every 30 s too.

The trap worth naming: `idleTimeout` is a *global* server setting and the chat
stream is the only long-lived SSE endpoint that was added without the heartbeat
its sibling already had. The fix belongs on the stream, not on the timeout.

## Proposed contract

`ChatSessions.streamResponse` writes an SSE comment frame on an interval, the
same shape and cadence the events stream already uses:

```
: keepalive\n\n
```

every **15 000 ms** — half the 30 s idle timeout, matching `HEARTBEAT_MS`.

**Decisions:**

- The frame is an SSE **comment** (`:` prefix), not a data frame. `EventSource`
  ignores it, so no client-side handling is needed and `ChatStreamEvent` is
  unchanged.
- Cadence is 15 000 ms, reusing the existing `HEARTBEAT_MS` value rather than
  introducing a second number.
- The interval is **per connection**, started in the stream's `start` and
  **cleared in its `cancel`**, so a closed connection cannot leak a timer.
- The keepalive runs **regardless of whether a live chat session exists** — the
  pre-session picker's connection needs it just as much.
- `idleTimeout: 30` in `Server.ts` is **not** changed. It is a deliberate safety
  net with a documented rationale; raising or removing it to paper over a
  missing keepalive would hide genuine hangs.
- No `retry:` field is introduced. Reconnect cadence is not the problem;
  reconnecting at all is.

## Acceptance criteria

- [ ] With a chat panel open and idle, the SSE connection survives at least
      120 seconds without the server closing it and without `EventSource`
      reconnecting.
- [ ] Keepalive comment frames are observable on the wire at ~15 s intervals on
      `/api/chat/:skill/stream`.
- [ ] The keepalive is emitted on a connection opened when **no live session
      exists** for that skill (pre-session picker case).
- [ ] Negative: the keepalive frame produces no transcript item and no state
      change — the client's `items` array and `state` are byte-identical before
      and after a keepalive.
- [ ] Negative / no leak: after the client disconnects, the connection's
      interval is cleared — opening and closing N chat streams leaves no
      accumulating timers.
- [ ] Regression: `/api/events-stream` behavior is unchanged, still at
      `HEARTBEAT_MS`, and `idleTimeout: 30` is still in force for ordinary
      requests.
- [ ] Regression: existing chat stream behavior is unchanged —
      `test/e2e/chat-sessions.e2e.test.ts` passes unmodified (connect replay,
      state frames, event ordering).
- [ ] Tests cover: long-idle connection survival, keepalive cadence,
      no-live-session case, and interval cleanup on disconnect.

## Implementation notes

The events stream's heartbeat is driven by one server-level `setInterval` over a
broadcaster with many subscribers; the chat stream is a per-skill `Response`
built inside `streamResponse`, so its keepalive is naturally per-connection
instead. Guard the enqueue the same way `sendEvent` already does — a client that
vanished mid-interval must not throw.

Scope fences:

- **Do not change `idleTimeout`.** See the decision above.
- **Do not add a data frame or extend `ChatStreamEvent`.** A comment frame
  requires no client change; a new event type would.
- **Do not touch the replay-on-connect behavior** — that is the companion
  issue's territory, and the two fixes must not collide.

Relevant current files, as orientation only:

- `packages/cli/src/server/ChatSessions.ts` — `streamResponse` (:688), its
  `cancel` (:710)
- `packages/cli/src/server/Server.ts` — `HEARTBEAT_MS` (:89), events-stream
  heartbeat wiring (:2535, :2911), `idleTimeout` (:2923)
- `packages/viewer/src/app/next/chatApi.ts` — the `EventSource` consumer (:196)

---

**Companion:** #195 — SSE reconnect wipes the transcript and destroys the reader's scroll position. This issue removes the ~30s cadence; #195 makes any reconnect harmless. Independent; either can be built first.


Implement exactly this issue. Verify every claim against the current code; the issue is a report, not a spec. Stay minimal: fix the reported defect with tests, nothing adjacent.

Run ID: 01KZBR06NBP0QTDJRCFJR37P3M
Pipeline progress: 1 of 5 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Created the durable implementation plan at [2026-08-06-chat-sse-keepalive.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-06-chat-sse-keepalive.md).
  > 
  > It verifies the current defect, defines the shared heartbeat constant and per-response cleanup design, specifies deterministic 120-second fake-timer coverage, preserves `idleTimeout`, replay behavior, and viewer code, and documents risks and deferred work. No implementation files were changed.
  > 
  > Plan ready for implementation: docs/proposals/2026-08-06-chat-sse-keepalive.md


# Implement

Implement the plan under `docs/proposals/` named by the scope stage.
Package-local README/guidance files own workflow and testing for the
packages you touch.

Rules:

- Stay scoped to the plan and its package boundaries: domain logic and
  schemas in `packages/core`, deterministic CLI/server behavior in
  `packages/cli` (data on stdout, diagnostics on stderr, stable exit
  codes, black-box tests for behavior), browser UI state in
  `packages/viewer`. If the plan cannot be implemented coherently
  without expanding scope, implement the smallest coherent slice and
  leave a clear blocking note in your final response.
- Do not freehand-edit `docs/library` (the live product context
  library) unless the plan explicitly owns a library migration.
- Comments in the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings, the way
  `packages/core/src/Todo.ts` does.
- If you are here after a gate failure or a ReviewJudge fix verdict,
  read that stage's output from context and fix exactly what it names.
  Retries are capped in the graph, so make the fix count.

Gates. Before finishing, run and pass ALL of:

```bash
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

AND, whenever the diff touches `packages/viewer`:

```bash
bun run build:viewer
```

A script node reruns the same gates right after this stage; a failure
routes straight back here. Summarize the implemented changes at the end.
