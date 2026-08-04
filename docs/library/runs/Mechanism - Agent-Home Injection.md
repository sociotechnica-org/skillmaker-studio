---
type: Mechanism
prefLabel: Agent-Home Injection
context: runs
status: new
links:
  related_to:
    - "./Mechanism - Chat Session"
    - "./Reference - ACP Provider"
    - "../_index/Role - William"
    - "../production/Mechanism - Packaged Station Skills"
---

## WHAT

How a chat session's agent receives William's guidance: before the
session starts, the server prepares a per-provider **agent home** at
`~/.skillmaker/agent-home/<provider>/`, refreshes the operator's auth
material into it, and installs skillmaker's helper skills
(`william-research-a-skill`, `william-draft-skill-md`) into the home's
user-level skill directory — `$CLAUDE_CONFIG_DIR/skills` for claude,
`$CODEX_HOME/skills` for codex. The adapter subprocess is launched with
its config-dir env var pointed at this home.

## WHY

Chat deliberately never writes into the user's project (the cwd-relative
`.claude/skills` vs `.agents/skills` split is for PROJECT-level skills,
which injection must not touch), yet the chat agent still needs William's
corpus. A relocated per-provider home threads that needle: auth is seeded
(only auth — never the operator's own skills or settings), and helper
skills are re-installed fresh on every session start (rm + copy) so a
skillmaker upgrade's newer William material always wins over stale
copies. Walk evidence says the delivery works: the 2026-07-29 agent found
and read `agent-home/codex/skills/.system` + the `william-*` skills and
self-corrected off them (`docs/friction/e2e-readiness.md`, Blocker #5's
partial-self-recovery note).

## HOW

`packages/cli/src/server/ChatSessions.ts`: `agentHomeBaseDir()`
(`SKILLMAKER_AGENT_HOME_DIR` overrides the default for tests) and
`prepareAgentHome(provider, workspaceRoot, skillsDir)` — mkdir, auth
seeding, then for each `HELPER_SKILL_SLUGS` slug, resolve the bundle's
`output/` (or the bundle dir itself for an in-place bundle) and copy it
to `<home>/skills/<slug>/`, returning the installed list.

Open design question, recorded not resolved (director, mid-walk): is
agent-home filesystem bundling the right delivery at all, vs
session-level injection? Constraint: ACP `session/new` has no
system-prompt/context param, so "session injection" today means
prepending to the first user message; protocol-level context is an
upstream ACP wish, not a dependency. The proposed two-layer shape —
**corpus via agent-home, activation via first-message preamble**
([[Mechanism - Chat Session]]) — is the working answer, with the
preamble half in flight (PR #183).

Verified: `packages/cli/src/server/ChatSessions.ts` (`prepareAgentHome`,
`agentHomeBaseDir`, `HELPER_SKILL_SLUGS`, the auth-only seeding and
fresh-reinstall doc comments); walk evidence and the open question
against `docs/friction/e2e-readiness.md` (Blocker #5).
