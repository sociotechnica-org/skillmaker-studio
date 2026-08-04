---
type: Mechanism
prefLabel: Chat Session
context: runs
status: new
links:
  related_to:
    - "./Reference - ACP Provider"
    - "./Entity - Run"
    - "./Mechanism - Agent-Home Injection"
    - "../_index/Role - William"
---

## WHAT

The chat surface's session driver (D9): a **long-lived, multi-prompt ACP
session** against a provider adapter, in contrast to the run engine's
one-shot spawn → prompt → close lifecycle. The agent works **directly in
the project** — edits are real, not sandboxed — which makes chat a
first-class producer of bundle work alongside stations.

## WHY

Stations cover unattended production; the walk-validated way a director
actually co-authors research answers, `design.md`, and steering is
conversation. Chat is that path: same `AcpClient` wire client and typed
error union as runs, extended with what a conversation needs — streamed
`session/update`s, serialized turns (a prompt while another is in flight
is a visible 409, never a silent queue), and interactive permissions (a
request whose paths all stay inside the project auto-approves — the
"comfortable Claude Code session" ruling; anything reaching outside
renders as an inline approve/deny card for the human).

## HOW

`packages/core/src/ChatSession.ts` is the driver;
`packages/cli/src/server/ChatSessions.ts` is the per-project session
manager (post-registry: keyed by registered project). Resume uses the
provider's own session model: ACP `session/load` when the adapter
advertises `loadSession` and a persisted provider session id exists — the
agent replays the whole prior conversation as notifications, so
skillmaker keeps no transcript store of its own; a failed load falls back
to a fresh `session/new`, reported honestly (`resumed: false`).

Every fresh session's **first prompt gets a machine-authored preamble**
prepended (ACP has no system-prompt/context param, so first-message
prepending is the only session-injection door today). What's merged is a
short orientation: where the bundle lives, prefer the `skillmaker` CLI
over hand-editing `.skillmaker/`, edits are real
(`buildChatPreamble` in `ChatSessions.ts`).

**In flight (PR #183, unmerged):** the full stage-aware preamble ruled
from the E2E walk's Blocker #5 (`docs/friction/e2e-readiness.md` — the
agent "does the task instead of building the skill" without it),
parameterized from the director's own recovery message: slug, one-liner,
current stage, stage-appropriate next step, "do the STEP, not the skill's
task itself," plus a pointer at the agent-home William guidance. Also in
that PR: William's chat-mode manners (the open-questions elicitation loop
and stage-handoff codas) and a one-line re-orientation on genuine
resumes. Until it merges, minute-zero context in chat is the thinner
merged preamble.

Open design tension recorded, not resolved (same walk): chat-path file
writes emit no journal events, so dots, activity, and provenance are
blind to chat-produced work — the CLI-funneling / observed-events /
hybrid options are an open design conversation, converging with the
claims-storage "structured data behind CLI doors" direction.

Verified: `packages/core/src/ChatSession.ts` (doc comment: long-lived D9
driver, resume-via-`session/load` with honest fallback, `ChatBusyError`
serialization, `makeChatPermissionPolicy`'s in-project auto-approve) and
`packages/cli/src/server/ChatSessions.ts` (`buildChatPreamble` as merged
— orientation only, not yet stage-aware); in-flight scope against PR #183's
description and `docs/friction/e2e-readiness.md` Blocker #5.
