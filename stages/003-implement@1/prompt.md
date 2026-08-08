Goal: GitHub Issue #195: SSE reconnect wipes the chat transcript and destroys the reader's scroll position

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/195

## Summary

On every SSE reconnect the chat panel clears its transcript to zero items and
lets the server replay the whole buffer. The intermediate empty render collapses
the scroll container, which destroys the reader's position and silently resets
the "stick to bottom only if already at bottom" guard — so a reader scrolled up
mid-transcript is thrown to the bottom. Make reconnect non-destructive: resume
from the last delivered event instead of wiping and replaying.

## Motivation / Problem

The panel already has a correct guard against yanking a reader who has scrolled
up (`RightPanel.tsx:769`, with a 100 px slop). This defect defeats it, so the
guard's protection is illusory whenever the stream reconnects.

Today the stream reconnects roughly every 30 seconds because it has no keepalive
— filed as the companion issue, which removes that cadence. **This issue is
still worth building after that fix lands**, because reconnects will still
happen: laptop sleep, network blips, a server restart during development, a
paused tab. Each one silently destroys the reader's place in a long transcript,
and there is no signal that anything happened. Fixing only the cadence leaves a
loaded gun.

There is a second, quieter cost: every reconnect re-sends the entire event
buffer, which grows without bound over a long session.

## Observed behavior

With a chat panel open, scroll to the middle of a long transcript. When the
stream reconnects (today: ~30 s of idle; or kill and restart the server to force
it), the transcript position is lost — in practice the panel lands at the
bottom.

Which end you land on is incidental: the reading position is destroyed either
way. If the container's clamp fires a `scroll` event you land at the bottom (the
observed case); if it does not, you land at the top. Neither is where you were.

## Current shape

The client treats every reconnect as a fresh mount.
`packages/viewer/src/app/next/chatApi.ts:196-221`:

```ts
    const source = new EventSource(apiPath(`/api/chat/${encodeURIComponent(skill)}/stream`));
    const onOpen = () => {
      // The server replays the live session's whole buffer on connect:
      // start from a clean slate so a reconnect never duplicates items.
      setEvents([]);
    };
```
```ts
      setEvents((prev) => [...prev, parsed]);
```

The server unconditionally replays the full buffer on connect,
`packages/cli/src/server/ChatSessions.ts:702-707`:

```ts
        sendEvent({ type: "state", state: this.state(skill) });
        if (chat !== undefined) {
          for (const event of chat.events) sendEvent(event);
```

The scroll machinery it collides with, `packages/viewer/src/app/next/RightPanel.tsx:759-770`:

```tsx
  const pendingRestore = useRef<number | null>(recallScroll(skill));
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingRestore.current !== null && items.length > 0) {
      el.scrollTop = pendingRestore.current;
      pendingRestore.current = null;
      return;
    }
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, active?.status]);
```

and its only writer besides `sendDraft`, `RightPanel.tsx:809-812`:

```tsx
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
        }}
```

Failure sequence:

1. Reconnect fires `open` → `setEvents([])` → `items.length` N → 0. The effect
   runs with `nearBottom.current === false`, so it correctly does nothing.
2. The DOM empties. The browser clamps `scrollTop` on the now-short container
   and dispatches a `scroll` event.
3. The handler computes `0 + clientHeight >= smallScrollHeight - 100` → **`nearBottom.current = true`**.
   The guard has been reset by the wipe, not by the user.
4. Replayed events arrive as separate messages; `items.length` climbs 0 → N; the
   effect fires with the corrupted guard → `el.scrollTop = el.scrollHeight`.

`pendingRestore` does not help: it is consumed on the first replay after mount
and set to `null`, so every later reconnect falls through to line 769.

The trap worth naming: the `setEvents([])` comment says it exists "so a
reconnect never duplicates items" — the wipe is a *deduplication* strategy, and
it works. The bug is that dedup-by-wipe is indistinguishable from a fresh
transcript. SSE has a purpose-built mechanism for exactly this (`Last-Event-ID`)
that the stream does not use.

## Proposed contract

Buffered event frames become resumable, and the client stops wiping.

Server, `/api/chat/:skill/stream`:

```
: connected

data: {"type":"state","state":{...}}          <- no id (not part of the ordered buffer)

id: 0
data: {"type":"user_message",...}

id: 1
data: {"type":"update",...}
```

On connect the server reads the `Last-Event-ID` request header:

| `Last-Event-ID` | Server replays |
|---|---|
| absent | `{type:"replay_reset"}`, then the full buffer with ids |
| parses to index `i`, `i < buffer.length`, same live session | `buffer.slice(i + 1)` — normally nothing |
| stale, unparseable, or the session was replaced/restarted | `{type:"replay_reset"}`, then the full buffer with ids |

**Decisions:**

- Ids are the **0-based index into `chat.events`**. The buffer is already an
  ordered append-only array, so no new identity needs inventing.
- The connect-time `state` frame carries **no id** — it is not part of the
  ordered buffer, and giving it one would corrupt the offset.
- The keepalive comment frame carries no id (it is a comment; it cannot).
- A new `{type:"replay_reset"}` frame is added to `ChatStreamEvent`. It is the
  **only** thing that clears the client's transcript. The client's `open`
  handler no longer clears anything.
- `replay_reset` renders nothing — it is a control frame, not a transcript item,
  and must not appear in `items`.
- The common case — reconnect with a valid id against a live session — replays
  **zero** frames, so `items.length` never changes and no scroll effect fires.
- Scroll position and the `nearBottom` guard are untouched by a resumed
  reconnect. After a `replay_reset` the transcript is legitimately rebuilt and
  the existing mount behavior applies.
- `streamResponse` gains access to the request headers to read `Last-Event-ID`;
  its skill-only signature changes accordingly.

## Acceptance criteria

- [ ] With the reader scrolled to the middle of a transcript, forcing a
      reconnect leaves `scrollTop` unchanged — the reader stays exactly where
      they were.
- [ ] A reconnect against a live session with a valid `Last-Event-ID` replays no
      already-delivered events; `items.length` never transits through 0.
- [ ] Events that occurred *during* the disconnected window are delivered on
      reconnect, exactly once, in order.
- [ ] Negative / no duplicates: after a reconnect the transcript contains each
      event exactly once — the guarantee `setEvents([])` was protecting still
      holds.
- [ ] Negative: `replay_reset` produces no visible transcript item.
- [ ] A first connection with no `Last-Event-ID` receives `replay_reset` then
      the full buffer, and renders identically to today.
- [ ] Degraded state: after a server restart (buffer gone / session replaced), a
      client holding a stale `Last-Event-ID` receives `replay_reset` + full
      buffer and renders correctly, with no duplicated or missing items.
- [ ] The `nearBottom` guard is not reset by anything other than a real user
      scroll or `sendDraft` — a reconnect cannot flip it.
- [ ] Regression: live streaming during an active turn is unchanged — new events
      still append and still auto-scroll for a reader who is at the bottom.
- [ ] Regression: scroll retention across tab/view switches
      (`recallScroll`/`rememberScroll`, `RightPanel.tsx:759,771`) still works.
- [ ] Regression: `test/e2e/chat-sessions.e2e.test.ts` passes, updated only
      where it asserts connect-replay framing.
- [ ] Tests cover: resume-with-no-missed-events, resume-with-missed-events,
      no-`Last-Event-ID` first connect, stale-id after restart, and the
      scroll-position-preserved assertion.

## Implementation notes

The scroll guard itself is correct and should not be rewritten — the fix is to
stop corrupting it. If a belt-and-braces hardening is wanted, distinguishing
user-initiated scroll from a programmatic clamp is the direction, but it is not
required once the transcript stops emptying, and it should not be bundled here.

Note that `pendingRestore` (`RightPanel.tsx:759`) is consumed exactly once per
mount. That is correct under this design and needs no change; it is called out
only so it is not mistaken for the reconnect path.

Scope fences:

- **Do not solve this by preserving/restoring `scrollTop` around the wipe.**
  Snapshot-and-restore around an async replay has no well-defined completion
  point; the wipe itself is what must go.
- **Do not add the keepalive here** — that is the companion issue. These two
  touch the same function and must not collide.
- **Do not change the transcript rendering or `chatModel.ts`'s event→item
  transform** beyond ignoring the new control frame.
- **Do not persist the event buffer** or change its lifetime; resumability here
  is within a live session only.

Relevant current files, as orientation only:

- `packages/viewer/src/app/next/chatApi.ts` — `onOpen`/`onMessage` (:196-221)
- `packages/viewer/src/app/next/RightPanel.tsx` — scroll effect (:761), guard
  writer (:809), `sendDraft`'s reset (:798)
- `packages/cli/src/server/ChatSessions.ts` — `ChatStreamEvent` (:389),
  `streamResponse` (:688), the buffer `events` (:431)
- `packages/viewer/src/app/next/chatModel.ts` — event→item transform

---

**Companion:** #194 — the chat SSE stream has no keepalive, which is why reconnects currently happen every ~30s. #194 removes the cadence; this issue makes any reconnect harmless. Independent; either can be built first.


Implement exactly this issue. Verify every claim against the current code; the issue is a report, not a spec. NOTE: PR #206 (SSE keepalive heartbeats) may or may not be merged to main when you read the code — check, and build against what main actually has; the fix here is reconnect NON-DESTRUCTIVENESS (preserve transcript items across reconnect, reconcile replayed buffer against existing items instead of clear-and-replay, preserve scroll position and the stick-to-bottom guard). Stay minimal: fix with tests, nothing adjacent.

Run ID: 01KZGEASY58GAX3XWS3CS1SHGA
Pipeline progress: 1 of 5 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Created the implementation plan at [2026-08-08-chat-sse-resumable-reconnect.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-08-chat-sse-resumable-reconnect.md).
  > 
  > It reflects the current codebase, including the merged SSE keepalive, and specifies indexed replay, `Last-Event-ID` handling, `replay_reset`, non-destructive viewer reconciliation, focused regression tests, repository gates, browser scroll acceptance, risks, and scope exclusions. No implementation files were changed.
  > 
  > Plan ready for implementation: docs/proposals/2026-08-08-chat-sse-resumable-reconnect.md


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
