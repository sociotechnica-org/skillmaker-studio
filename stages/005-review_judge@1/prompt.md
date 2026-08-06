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
Pipeline progress: 3 of 5 stages completed

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

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented Issue #194 with no viewer, replay, or timeout-policy changes.
  > 
  > - Chat SSE responses now emit `: keepalive\n\n` every shared 15 seconds and clear that per-connection interval on stream cancellation: [ChatSessions.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:701).
  > - Extracted the existing machine-event heartbeat cadence into shared [Sse.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Sse.ts:1); `/api/events-stream` continues using the same 15-second value through [Server.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/Server.ts:87).
  > - Added deterministic coverage for the pre-session/no-live-chat path, eight keepalives over 120 virtual seconds, comment-only payload behavior, and cleanup across multiple disconnected streams: [ChatSseKeepalive.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSseKeepalive.test.ts:1).
  > - `idleTimeout: 30` remains unchanged.
  > 
  > Validation passed:
  > 
  > ```text
  > bunx tsc --noEmit -p packages/core
  > bunx tsc --noEmit -p packages/cli
  > bun test packages
  > bun test test/e2e --timeout 30000
  > ```
  > 
  > Also passed the focused keepalive and chat-session e2e tests. I built the viewer solely to provide the e2e server’s required static assets; no viewer source was changed.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1683 lines omitted)
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [1.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [297.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [609.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [24.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [34.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1717.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [712.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [720.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [960.00ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [280.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [265.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [550.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [273.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [27.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [2.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [2.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [3.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [1.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [305.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [37.00ms]
  
  16 tests skipped:
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/health reports ok
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/bundles shows the bundle created via the binary
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET / serves the viewer HTML from the standalone viewer-dist/
  (skip) skillmaker distributed binary: golden path (Phase 12a) > claim file exists at the started port
  (skip) skillmaker distributed binary: golden path (Phase 12a) > SIGTERM stops the binary cleanly and removes the claim file
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1635 expect() calls
  Ran 386 tests across 48 files. [161.81s]
  == Build viewer: skipped (no packages/viewer changes) ==
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
