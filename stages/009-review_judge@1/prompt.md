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
Pipeline progress: 7 of 5 stages completed

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

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented #195’s non-destructive SSE reconnect behavior.
  > 
  > - Buffered chat frames now have sequential SSE IDs; the server reads `Last-Event-ID` and replays only missed events. Invalid, stale, absent, or post-restart cursors receive the non-rendering `replay_reset` control frame before a full replay. See [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:717) and [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:2826).
  > - The viewer no longer clears transcript events when `EventSource` reopens. It clears only on `replay_reset`, so an ordinary reconnect cannot collapse the transcript or disturb the scroll/near-bottom state. See [chatApi.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/chatApi.ts:160).
  > - Added focused reconciliation and resumable-SSE coverage, plus e2e assertions for zero-replay reconnects, missed suffixes, ordered IDs, and duplicate prevention.
  > 
  > I removed an unrelated `JournalWatcher` polling change that had been added during the prior failed validation attempt, keeping the resulting diff scoped to this issue. The reported `IndexService` timeout was transient: it passed both in isolation and in the full package suite.
  > 
  > Validation passed:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun run build:viewer`
  > - `bun test packages` — 1077 passed
  > - `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1742 lines omitted)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   371 pass
   17 skip
   0 fail
   1652 expect() calls
  Ran 388 tests across 48 files. [260.85s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:04:31 [content] Syncing content
  @skillmaker/viewer build: 11:04:31 [content] Synced content
  @skillmaker/viewer build: 11:04:31 [types] Generated 28ms
  @skillmaker/viewer build: 11:04:31 [build] output: "static"
  @skillmaker/viewer build: 11:04:31 [build] mode: "static"
  @skillmaker/viewer build: 11:04:31 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:04:31 [build] Collecting build info...
  @skillmaker/viewer build: 11:04:31 [build] ✓ Completed in 53ms.
  @skillmaker/viewer build: 11:04:31 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:04:32 [vite] ✓ built in 1.36s
  @skillmaker/viewer build: 11:04:32 [build] ✓ Completed in 1.38s.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:04:32 [vite] transforming...
  @skillmaker/viewer build: 11:04:34 [vite] ✓ 251 modules transformed.
  @skillmaker/viewer build: 11:04:34 [vite] rendering chunks...
  @skillmaker/viewer build: 11:04:34 [vite] computing gzip size...
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/NextShell.CviYn0Bf.js  178.67 kB │ gzip: 54.74 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:04:34 [vite] ✓ built in 2.00s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:04:35   └─ /index.html(node:89082) Warning: `--localstorage-file` was provided without a valid path
  @skillmaker/viewer build: (Use `node --trace-warnings ...` to show where the warning was created)
  @skillmaker/viewer build:  (+15ms) 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:04:35   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:04:35 ✓ Completed in 159ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:04:35 [build] 2 page(s) built in 3.60s
  @skillmaker/viewer build: 11:04:35 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented #195’s non-destructive SSE reconnect behavior.
  > 
  > - Buffered chat frames now have sequential SSE IDs; the server reads `Last-Event-ID` and replays only missed events. Invalid, stale, absent, or post-restart cursors receive the non-rendering `replay_reset` control frame before a full replay. See [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:717) and [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:2826).
  > - The viewer no longer clears transcript events when `EventSource` reopens. It clears only on `replay_reset`, so an ordinary reconnect cannot collapse the transcript or disturb the scroll/near-bottom state. See [chatApi.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/chatApi.ts:160).
  > - Added focused reconciliation and resumable-SSE coverage, plus e2e assertions for zero-replay reconnects, missed suffixes, ordered IDs, and duplicate prevention.
  > 
  > I removed an unrelated `JournalWatcher` polling change that had been added during the prior failed validation attempt, keeping the resulting diff scoped to this issue. The reported `IndexService` timeout was transient: it passed both in isolation and in the full package suite.
  > 
  > Validation passed:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun run build:viewer`
  > - `bun test packages` — 1077 passed
  > - `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1742 lines omitted)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   371 pass
   17 skip
   0 fail
   1652 expect() calls
  Ran 388 tests across 48 files. [260.85s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:04:31 [content] Syncing content
  @skillmaker/viewer build: 11:04:31 [content] Synced content
  @skillmaker/viewer build: 11:04:31 [types] Generated 28ms
  @skillmaker/viewer build: 11:04:31 [build] output: "static"
  @skillmaker/viewer build: 11:04:31 [build] mode: "static"
  @skillmaker/viewer build: 11:04:31 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:04:31 [build] Collecting build info...
  @skillmaker/viewer build: 11:04:31 [build] ✓ Completed in 53ms.
  @skillmaker/viewer build: 11:04:31 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:04:32 [vite] ✓ built in 1.36s
  @skillmaker/viewer build: 11:04:32 [build] ✓ Completed in 1.38s.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:04:32 [vite] transforming...
  @skillmaker/viewer build: 11:04:34 [vite] ✓ 251 modules transformed.
  @skillmaker/viewer build: 11:04:34 [vite] rendering chunks...
  @skillmaker/viewer build: 11:04:34 [vite] computing gzip size...
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/NextShell.CviYn0Bf.js  178.67 kB │ gzip: 54.74 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:04:34 [vite] ✓ built in 2.00s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:04:35   └─ /index.html(node:89082) Warning: `--localstorage-file` was provided without a valid path
  @skillmaker/viewer build: (Use `node --trace-warnings ...` to show where the warning was created)
  @skillmaker/viewer build:  (+15ms) 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:04:35   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:04:35 ✓ Completed in 159ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:04:35 [build] 2 page(s) built in 3.60s
  @skillmaker/viewer build: 11:04:35 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented #195’s non-destructive SSE reconnect behavior.
  > 
  > - Buffered chat frames now have sequential SSE IDs; the server reads `Last-Event-ID` and replays only missed events. Invalid, stale, absent, or post-restart cursors receive the non-rendering `replay_reset` control frame before a full replay. See [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:717) and [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:2826).
  > - The viewer no longer clears transcript events when `EventSource` reopens. It clears only on `replay_reset`, so an ordinary reconnect cannot collapse the transcript or disturb the scroll/near-bottom state. See [chatApi.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/app/next/chatApi.ts:160).
  > - Added focused reconciliation and resumable-SSE coverage, plus e2e assertions for zero-replay reconnects, missed suffixes, ordered IDs, and duplicate prevention.
  > 
  > I removed an unrelated `JournalWatcher` polling change that had been added during the prior failed validation attempt, keeping the resulting diff scoped to this issue. The reported `IndexService` timeout was transient: it passed both in isolation and in the full package suite.
  > 
  > Validation passed:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun run build:viewer`
  > - `bun test packages` — 1077 passed
  > - `bun test test/e2e --timeout 30000` — 371 passed, 17 expected skips

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1742 lines omitted)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   371 pass
   17 skip
   0 fail
   1652 expect() calls
  Ran 388 tests across 48 files. [260.85s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 11:04:31 [content] Syncing content
  @skillmaker/viewer build: 11:04:31 [content] Synced content
  @skillmaker/viewer build: 11:04:31 [types] Generated 28ms
  @skillmaker/viewer build: 11:04:31 [build] output: "static"
  @skillmaker/viewer build: 11:04:31 [build] mode: "static"
  @skillmaker/viewer build: 11:04:31 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 11:04:31 [build] Collecting build info...
  @skillmaker/viewer build: 11:04:31 [build] ✓ Completed in 53ms.
  @skillmaker/viewer build: 11:04:31 [build] Building static entrypoints...
  @skillmaker/viewer build: 11:04:32 [vite] ✓ built in 1.36s
  @skillmaker/viewer build: 11:04:32 [build] ✓ Completed in 1.38s.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 11:04:32 [vite] transforming...
  @skillmaker/viewer build: 11:04:34 [vite] ✓ 251 modules transformed.
  @skillmaker/viewer build: 11:04:34 [vite] rendering chunks...
  @skillmaker/viewer build: 11:04:34 [vite] computing gzip size...
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/NextShell.CviYn0Bf.js  178.67 kB │ gzip: 54.74 kB
  @skillmaker/viewer build: 11:04:34 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 11:04:34 [vite] ✓ built in 2.00s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/index.astro
  @skillmaker/viewer build: 11:04:35   └─ /index.html(node:89082) Warning: `--localstorage-file` was provided without a valid path
  @skillmaker/viewer build: (Use `node --trace-warnings ...` to show where the warning was created)
  @skillmaker/viewer build:  (+15ms) 
  @skillmaker/viewer build: 11:04:35 ▶ src/pages/next.astro
  @skillmaker/viewer build: 11:04:35   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 11:04:35 ✓ Completed in 159ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 11:04:35 [build] 2 page(s) built in 3.60s
  @skillmaker/viewer build: 11:04:35 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```


# ReviewJudge

You are the single review-and-verdict gate before the PR. Review the
implementation diff against the scope plan (under `docs/proposals/`, named
by the scope stage) and the house rules, read the gates output from the
previous stage, and deliver ONE verdict. Do not edit any files.

Check:

- The diff stays within the plan's scope and package boundaries: domain
  logic and schemas in `packages/core`, deterministic CLI/server behavior
  in `packages/cli`, browser UI in `packages/viewer`.
- Comments are plain English prose explaining WHY, citing issues, dated
  proposals, and rulings (`packages/core/src/Todo.ts` is the standard).
- Behavior changes have tests (black-box CLI tests for CLI behavior,
  `test/e2e` for server-surface changes).
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- The deterministic gates output shows the repo gates passed on the final
  diff.

Grading bar — this line is load-bearing: a mergeable change with noted
imperfections is a PASSING grade — perfectionism is the expensive failure
mode; note imperfections in the PR body instead of bouncing. Only route
Fix for real defects: broken or untested behavior, scope/plan mismatch,
boundary violations, failing gates. Style nits, minor gaps, and "could be
better" observations go in a short "Imperfections to note in the PR body"
list in your response, which the Prepare PR stage will include.

Verdicts (exactly one):

- **ready** — the change is mergeable. List any imperfections for the PR
  body, then route to Prepare PR.
- **fix** — a real defect blocks merge. Allowed AT MOST ONCE per run (the
  graph enforces this: this node runs at most twice, so on your second
  run Fix is off the table — choose ready or surface). Give concrete,
  actionable fix items so the implement stage can act without guessing.
- **surface** — you and the implementation cannot converge (e.g. the fix
  round did not resolve the defect, or the plan itself is wrong). Stop
  the run with a clear summary of the disagreement for a human.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}
```

or:

```json
{"preferred_next_label":"Surface","outcome":"failed","failure_reason":"<one-line summary of the disagreement>","context_updates":{"verdict":"surface"}}
```
