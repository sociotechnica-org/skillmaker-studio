# Resumable Chat SSE Reconnects

*Implementation plan — 2026-08-08. GitHub issue #195. Run
`01KZGEASY58GAX3XWS3CS1SHGA`.*

## Status

Ready for implementation. This is a narrow chat transport and viewer-state
repair. It makes reconnects within one live chat resume after the last
delivered buffered event, and reserves an explicit control frame for the cases
that genuinely require rebuilding the transcript.

Issue #194's keepalive implementation is already present on this branch. Its
per-response timer and `: keepalive` comment remain unchanged; this plan only
changes the framing and replay policy of buffered `data:` events.

## Outcome

The chat server will assign each buffered event its zero-based
`chat.events` index as the SSE `id`. Native `EventSource` will return the last
delivered id in the `Last-Event-ID` request header when that same connection
reconnects. The server will replay only the suffix after that index and then
continue with live indexed events.

A fresh or invalid resume instead receives an unindexed
`{"type":"replay_reset"}` control frame followed by the complete indexed
buffer. The viewer clears its transcript only for that control frame. Opening
or reopening the transport does not otherwise mutate transcript state.

The common live-session reconnect therefore consists of the connected
comment, an unindexed current-state snapshot, and no buffered events:

```text
: connected

data: {"type":"state","state":{...}}

```

If events arrived while the browser was disconnected, only those events
follow:

```text
id: 14
data: {"type":"update",...}

id: 15
data: {"type":"turn_ended",...}

```

On a first connection, restart, or stale offset, the stream explicitly
establishes a new transcript baseline:

```text
: connected

data: {"type":"state","state":{...}}

data: {"type":"replay_reset"}

id: 0
data: {"type":"state","state":{...}}

id: 1
data: {"type":"user_message",...}

```

The indexed state in that example is a state change previously broadcast into
the live session's ordered buffer. It is distinct from the unindexed
connect-time snapshot.

## Verified current state

The issue's failure report matches the current branch, with these routing and
keepalive refinements:

- `packages/viewer/src/app/next/chatApi.ts` creates a native `EventSource` and
  registers an `open` listener that calls `setEvents([])`. Every later
  non-state message appends to the array. The separate skill-change effect
  also clears events; that clear is a real navigation boundary and remains.
- A successful session start increments `streamEpoch`, which closes the old
  `EventSource` and constructs a new one. A new `EventSource` has no inherited
  last-event id, so the newly started or provider-resumed session receives a
  deliberate reset and full replay.
- `packages/cli/src/server/ChatSessions.ts` stores every `broadcast` in the
  append-only `LiveChat.events` array, including state changes, and sends the
  complete array on every connection. Buffered frames currently have no SSE
  ids.
- `streamResponse` takes only `skill`, so it cannot inspect
  `Last-Event-ID`. The project-scoped route is
  `/api/projects/:project/chat/:skill/stream`; `Server.ts` strips the project
  prefix and currently dispatches to `streamResponse(chatSkill)`.
- PR #206 is merged here: `streamResponse` starts one `: keepalive` comment
  interval per response using the shared `HEARTBEAT_MS`, and clears it in
  `cancel`. Comments are not buffered and are invisible to `EventSource`
  message handlers.
- `packages/viewer/src/app/next/chatModel.ts` already ignores every unknown
  event type. An explicit regression assertion is still needed for
  `replay_reset`, because its invisibility is now part of the protocol.
- `RightPanel.tsx` restores remembered scroll once per mount and otherwise
  auto-scrolls only while `nearBottom.current` is true. Its scroll handler is
  the only ordinary writer to that guard; `sendDraft` intentionally opts a
  new user message back into bottom-sticking.
- The destructive reconnect is what defeats that correct guard: rendering an
  empty transcript lets the browser clamp `scrollTop`, and the resulting
  scroll event marks the now-short container as near the bottom. No
  `RightPanel` policy change is required once a resumed reconnect leaves the
  event array alone.
- The repository has no browser test environment: there is no Playwright,
  jsdom, happy-dom, or React component test renderer. Existing viewer tests
  are pure Bun tests, and server e2e tests drive HTTP/SSE without a browser.
- `test/e2e/chat-sessions.e2e.test.ts` currently parses only `data:` lines and
  discards SSE ids. Its replay assertions must retain payload compatibility
  while its stream collector gains enough framing information to exercise
  resume.
- There is no existing issue #195 proposal to refine. The issue #194 proposal
  explicitly defers this work, so this is a separate plan rather than an edit
  to the completed keepalive plan.

## Protocol contract

### Buffered ids

Each event appended to a live chat's `events` array has the array index assigned
at append time. Every delivery of that buffered event—initial replay, suffix
replay, or live subscriber delivery—uses:

```text
id: <index>
data: <serialized event>

```

The index is assigned once in `broadcast` before subscribers are called. This
avoids deriving an id from mutable array length separately in each subscriber
and gives replay and live delivery the same ordering source.

These frames never carry an id:

- `: connected`;
- the connect-time current-state snapshot;
- `: keepalive`; and
- `replay_reset`.

An unindexed frame does not overwrite the native `EventSource` object's last
buffered id. In particular, reconnecting can refresh panel state without
moving the transcript resume cursor.

### Resume decision

`streamResponse` receives the `Request` from `Server.ts` and reads
`request.headers.get("last-event-id")` once before constructing the stream.
Interpret only canonical, non-negative, safe decimal integers as offsets.
Whitespace, signs, decimals, exponent syntax, empty strings, and values above
`Number.MAX_SAFE_INTEGER` are invalid rather than partially parsed.

The replay decision is:

| Request state | Frames after connect-time state |
| --- | --- |
| Header absent | `replay_reset`, then the entire indexed buffer |
| Valid index `i` and a live chat with `i < events.length` | Indexed `events.slice(i + 1)` |
| No live chat, invalid id, or `i >= events.length` | `replay_reset`, then the entire indexed buffer |

An empty live buffer cannot validate a prior id, so any supplied id resets.
The no-header first connection also resets when no live chat exists; this
keeps one deterministic initialization contract.

The index-only contract relies on the current lifecycle boundaries to
distinguish sessions: a supported session start creates a new `EventSource`
through `streamEpoch`, and a server restart creates a new manager with no live
buffers. No session generation id, persistence, cookie, query token, or custom
reconnect client is introduced.

### Reset control event

Add `{ readonly type: "replay_reset" }` to `ChatStreamEvent`. It is transport
control, not session history:

- emit it directly from `streamResponse`, never through `broadcast`;
- do not append it to `chat.events`;
- do not give it an SSE id;
- do not send it to chat subscribers; and
- do not render it as a transcript item.

Prefer a buffered-event subtype excluding `replay_reset` for `LiveChat.events`,
`broadcast`, and subscribers. The type boundary prevents a future caller from
accidentally consuming an index with a reset frame.

### Viewer reconciliation

Remove the `EventSource` `open` listener and its `setEvents([])`. Keep message
parsing and state handling, then apply this event policy:

- `state`: update `state`, do not touch `events`;
- `replay_reset`: set `events` to `[]`, render nothing;
- every other valid JSON event: append once in arrival order;
- malformed JSON: ignore as today.

The viewer does not manually set a resume header and does not track ids in
React state. Native `EventSource` owns `Last-Event-ID`; the server's indexed
frames are sufficient.

A valid reconnect with no missed events sends no transcript message, so
`events` preserves its array, `items.length` does not change, the transcript
effect does not run, the DOM height does not collapse, and neither
`scrollTop` nor `nearBottom.current` changes. Missed events use the existing
append path. A reader at the bottom keeps auto-scrolling; a reader above it
remains in place.

Do not change the skill-change clear, one-time `pendingRestore`, `sendDraft`,
the 100-pixel near-bottom threshold, or the scroll handler.

## File-level implementation plan

### 1. Add indexed resume framing on the server

Update `packages/cli/src/server/ChatSessions.ts`:

1. Add `replay_reset` to `ChatStreamEvent` and define the buffer/subscriber
   types so the control event cannot enter session history.
2. Change subscribers to receive both an event and its assigned index.
   Have `broadcast` push first, compute `events.length - 1`, and synchronously
   notify every subscriber with that index.
3. Change `streamResponse` to accept the current `Request`, parse its
   `Last-Event-ID`, and compute either a reset/full replay or a suffix replay
   against the captured live chat.
4. Keep the connect order `: connected`, unindexed state, replay decision,
   subscriber registration, then keepalive scheduling.
5. Encode every buffered and live event with `id: <index>` immediately before
   its `data:` line. Keep the current guarded raw writer for disconnect races.
6. Preserve subscriber removal and keepalive cleanup in `cancel`.
7. Update the stream and buffer comments to explain why indexed replay avoids
   destructive viewer reconciliation, citing issue #195 and this dated
   proposal. Preserve the adjacent issue #194 keepalive rationale.

The replay and subscriber setup contains no `await`, so no broadcast can
interleave between selecting the replay suffix and registering the subscriber
on the JavaScript event loop.

Update `packages/cli/src/server/Server.ts` only at the chat stream dispatch:
pass `request` to `chatManager.streamResponse(chatSkill, request)`. Do not
change project routing or any other endpoint.

### 2. Make viewer reconnect non-destructive

Update `packages/viewer/src/app/next/chatApi.ts`:

1. Remove the `open` callback, listener registration, listener cleanup, and
   stale “reset on each stream reconnect” API comment.
2. Recognize `replay_reset` after JSON decoding and before ordinary append;
   clear only in that branch.
3. Preserve the current special handling for state snapshots and buffered
   state changes.
4. Keep the `[skill, available, streamEpoch]` lifecycle. It remains necessary
   for navigation, API availability, and selecting the newly started live
   session.
5. Isolate only the small decoded-message reconciliation needed for a pure
   viewer test; do not introduce a custom EventSource implementation or a
   second id tracker.

Do not edit `RightPanel.tsx`. Its current guard and scroll-memory behavior are
the regression target, not the repair site.

Do not change the transform in `chatModel.ts`; add only the test proving the
new control frame yields no item.

### 3. Cover server resume behavior

Extend the SSE collector in `test/e2e/chat-sessions.e2e.test.ts` so it can:

- send an optional `Last-Event-ID` request header;
- retain each data frame's explicit SSE id separately from its decoded
  payload;
- continue exposing payloads conveniently to the existing assertions; and
- ignore connected/keepalive comments as it does today.

Add focused cases around the existing deterministic fake chat adapter:

1. **No header / first connect:** assert connect-time state and
   `replay_reset` are unindexed, reset precedes replay, buffered ids begin at
   zero and are strictly contiguous, and the rendered payload sequence is the
   same history expected today.
2. **No missed events:** reconnect from the latest observed id, then produce
   another turn. Assert no reset or earlier payload is delivered and the first
   new buffered frame continues at the next id.
3. **Missed events:** disconnect at a known id, complete a uniquely worded turn
   while disconnected, reconnect from that id, and assert the suffix ids are
   contiguous, ordered, unique, and contain the missed turn exactly once.
4. **Negative duplicate check:** combine the pre-disconnect prefix with the
   resumed suffix and assert every id appears once and the unique user/agent
   markers appear once.

Add a focused server test, preferably
`packages/cli/test/ChatSseResume.test.ts`, for validation edges that do not
need a provider process:

- absent, malformed, negative, fractional, unsafe, and out-of-range ids choose
  reset;
- a fresh `ChatSessionManager` (the exact post-restart in-memory state)
  receiving a stale id emits unindexed current state followed by unindexed
  `replay_reset`, with no fabricated buffered event;
- the existing keepalive still follows and cancellation clears its interval.

Factor a small deterministic replay-decision helper inside the server module
if needed to test valid-index arithmetic without exposing `LiveChat` or
mutating manager internals from tests. Do not add production dependency
injection solely for tests.

Update `packages/cli/test/ChatSseKeepalive.test.ts` for the new
`streamResponse` request argument and the one additional initial
`replay_reset` data frame. Keep all cadence, no-data-during-idle, and timer
cleanup assertions intact; `replay_reset` is initialization, not a heartbeat.

### 4. Cover viewer reconciliation and scroll invariants

Add `packages/viewer/src/app/next/chatApi.test.ts` around the small pure
decoded-message transition used by the hook:

1. Connect-time and buffered `state` messages preserve the transcript array.
2. A resumed connection with no transcript frames preserves the same array
   reference and item count; a scroll sentinel representing a reader in the
   middle remains at its exact prior value because the item-count-driven
   effect receives no change.
3. Missed ordinary events append once and in order without replacing the
   prefix.
4. `replay_reset` is the sole transition that returns an empty transcript,
   after which full replay rebuilds the expected sequence.
5. Malformed payloads do not clear or append.

Add a case to `packages/viewer/src/app/next/chatModel.test.ts` asserting
`chatItemsFromEvents([{ type: "replay_reset" }, ...visibleEvents])` produces
exactly the same visible items as the visible events alone.

Because the repository has no browser DOM harness, the automated scroll
regression is contract-level: it proves the valid reconnect leaves the
item-count dependency unchanged and includes an exact unchanged scroll
sentinel assertion. The live acceptance check below verifies real browser
`scrollTop`. Do not add a browser framework or refactor `RightPanel` merely to
host this test.

## Validation

Run narrow checks first:

```sh
bun test packages/cli/test/ChatSseResume.test.ts
bun test packages/cli/test/ChatSseKeepalive.test.ts
bun test packages/viewer/src/app/next/chatApi.test.ts
bun test packages/viewer/src/app/next/chatModel.test.ts
bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000
bun run build:viewer
```

Then run the repository gates:

```sh
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun run build:viewer
bun test test/e2e --timeout 30000
```

For real-browser acceptance:

1. Open a long chat transcript, scroll to the middle, and record
   `scrollTop`, `scrollHeight`, and the visible sentence at the top edge.
2. Force the existing `EventSource` connection to reconnect without starting
   a new session. Verify the follow-up request carries `Last-Event-ID`.
3. With no missed events, verify no indexed replay frames arrive and
   `scrollTop` is byte-for-byte the recorded number; the same sentence remains
   at the top edge.
4. Repeat while causing a turn to emit events during the disconnected window.
   Verify only the id suffix arrives, each event appears once, and a reader in
   the middle is not moved.
5. Repeat from the bottom and verify new live events still keep the panel at
   the bottom.
6. Restart the server. Verify the stale reconnect gets `replay_reset`, the
   empty live buffer does not duplicate old items, and the normal provider
   resume flow rebuilds history on its fresh no-header stream.
7. Switch away from and back to the chat tab and verify the existing
   `recallScroll`/`rememberScroll` restoration still works.

## Acceptance criteria

- [ ] A live-session reconnect carrying the latest valid id replays no
      buffered events and never transitions the viewer event list through
      empty.
- [ ] Events produced while disconnected are replayed exactly once, in
      append order, beginning at the id after the client's cursor.
- [ ] Prefix plus replayed suffix contains no duplicate ids or transcript
      events.
- [ ] First connection without `Last-Event-ID` receives unindexed
      `replay_reset` followed by the complete buffer with zero-based ids.
- [ ] Missing live state, malformed ids, and offsets outside the current
      buffer receive reset/full replay rather than a guessed suffix.
- [ ] A fresh post-restart manager handles a stale browser id with
      `replay_reset` and no duplicate or fabricated history.
- [ ] The connect-time state snapshot, reset control event, and keepalive
      comments never consume a buffer id.
- [ ] Buffered state changes retain ids and update panel state without
      becoming transcript items.
- [ ] `replay_reset` itself produces no visible item and is the only stream
      message that clears the transcript.
- [ ] A reader in the middle retains exact `scrollTop` through a valid
      reconnect; `nearBottom` is not changed by reconnect.
- [ ] A reader at the bottom still follows new live events, while a reader
      above the bottom does not.
- [ ] Tab/view switch scroll restoration and the intentional `sendDraft`
      bottom opt-in are unchanged.
- [ ] Issue #194's 15-second keepalive framing and per-connection cleanup are
      unchanged.
- [ ] Existing chat session e2e behavior, viewer build, CLI typecheck, package
      tests, and complete e2e tests pass.

## Risks and mitigations

- **An offset is parsed permissively.** Validate the complete canonical decimal
  string and safe-integer range; do not use bare `parseInt`.
- **Live delivery and replay use different id calculations.** Assign the index
  once in `broadcast` and pass it to subscribers; use the same indexed encoder
  for replay.
- **A state snapshot advances the cursor incorrectly.** Keep the connect-time
  state on the raw unindexed path. Buffered state changes remain indexed
  because they already occupy positions in `chat.events`.
- **A reset accidentally enters history.** Exclude it from the buffered event
  type and emit it only from the connection setup branch.
- **A reconnect races a broadcast.** Keep replay selection, replay writes, and
  subscription synchronous in `ReadableStream.start`.
- **Keepalive behavior regresses while stream setup changes.** Retain the
  existing raw writer, interval placement, cancellation path, and dedicated
  keepalive tests.
- **React still renders an empty intermediate transcript.** Never clear on
  `open`, state, or valid suffix replay. A reset may legitimately rebuild and
  is intentionally the only allowed empty transition.
- **The scroll assertion becomes a duplicate scroll implementation.** Test
  the transport-to-item-count invariant with a scroll sentinel, leave
  `RightPanel` untouched, and perform exact DOM `scrollTop` verification in
  live acceptance.
- **Index ids are mistaken for durable history identity.** Document and test
  that they are valid only for the current in-memory `LiveChat`; restart and
  new-session paths deliberately reset. Do not persist the buffer or ids.

## Deferred and out of scope

- Changing the keepalive cadence, comment shape, or interval lifecycle from
  issue #194.
- Persisting chat event buffers or resume cursors across server processes.
- Adding a session-generation token, cookie, query parameter, custom
  EventSource client, retry policy, or reconnect backoff.
- Snapshotting/restoring `scrollTop` around replay.
- Rewriting the near-bottom guard, threshold, `pendingRestore`, or transcript
  rendering.
- Adding Playwright, jsdom, or another browser test framework.
- Changing ACP provider session persistence or history replay.
- Trimming or otherwise bounding the in-memory event buffer.
