---
title: Running fixtures
description: How `skillmaker run` drives a real agent over ACP.
---

`skillmaker run` is the first LLM-touching command in the CLI: it drives a
real coding agent over the
[Agent Client Protocol](https://agentclientprotocol.com/) (ACP) through one
fixture case, end to end, and records everything it did. Two providers are
full eval peers today — `claude-code` and `codex` — each with its own
`ProviderProfile` (skill install directory, model-id extraction, and
infra-error signatures all differ per provider under the hood; the CLI
surface is identical either way).

## What one run does

1. Creates a temporary run workspace.
2. Copies `evals/fixtures/<case>/files/` into it.
3. Installs `output/` as the skill (e.g. `.claude/skills/<slug>/`).
4. Launches the configured provider over ACP with the case's `prompt.md`.
5. Captures the full session as `transcript.jsonl`.
6. Diffs the run workspace against its starting state into `artifacts/`.

```sh
skillmaker run my-first-skill --fixture golden-basic
```

While the agent session is running, the CLI writes progress to stderr (a
real session can take anywhere from ~15 seconds to several minutes, and a
silent CLI over that span reads as hung):

```text
skillmaker run: sandbox ready, starting "claude-code" session...
..........
skillmaker run: completed (10 session update(s))
skillmaker run: completed (my-first-skill, run 01JZX8M2E9V0Q4)
  version:   sha256:4f66bb815c24 (auto-recorded before this run)
  model:     claude-opus-4-6
  artifacts: NOTES.md
  run dir:   skills/my-first-skill/runs/01JZX8M2E9V0Q4
```

If no version has been recorded yet, `skillmaker run` records one
automatically before running (`autoRecordedVersion` in `--json` output) —
every run is always pinned to a real version hash, never to "whatever's on
disk right now, unversioned."

## What gets written

`runs/<run-id>/` is a **record** — immutable once the run ends, and never
cleaned up (failures are the curriculum: run records document what didn't
work as much as what did):

```text
runs/<run-id>/
  run.json               # execution metadata: bundle, fixtureCase, skillVersionHash,
                          # provider, model, startedAt/endedAt, status, actor
  transcript.jsonl        # the raw ACP session update stream
  artifacts/…              # files the agent produced -- the workspace diff
```

Two journal events bracket a run: `run.started` (mirrors `run.json` minus
the end fields, for replay-completeness) and `run.completed`
(`{id, status, endedAt}`).

## Exit codes carry real information

```text
0  completed    -- the run finished; the agent's session ended normally
1  failed        -- the run finished, but something about the task failed
                    (a real signal about the skill, not the harness)
2  usage error   -- bad CLI invocation
3  infra-error   -- auth, sandbox, or connection faults
```

`infra-error` vs `failed` is a deliberate split: auth/sandbox/connection
faults never pollute pass rates. If a fixture run fails because the network
dropped mid-session, that's `infra-error` (exit 3) — a fact about your
environment, not about the skill — and it's meant to be excluded from any
measurement built on top of run history (see
[Coverage vs. validation](/evals/coverage-vs-validation/)).

## Providers

Configured in `skillmaker.config.json` (written by `skillmaker init`):

```jsonc
{
  "providers": {
    "claude-code": { "command": ["npx", "-y", "@zed-industries/claude-code-acp@latest"] },
    "codex":       { "command": ["npx", "-y", "@agentclientprotocol/codex-acp@latest"] }
  }
}
```

Both entries are written by `skillmaker init` — no config edit needed to
use either provider. `--provider <id>` selects which one to run against
(defaults to `claude-code`); `--timeout <seconds>` bounds the prompt
(defaults to 300). Both providers ride your already-logged-in CLI session
(`claude` / `codex`) — no separate API key needed for either. Permission
requests from the agent during a run are auto-approved and logged as a
synthetic transcript entry, so nothing the agent did is hidden from the
transcript.

A **trigger** fixture (see [Fixtures and risk maps](/evals/fixtures-and-risk-maps/))
grades activation instead of task correctness — `didSkillActivate` scans
the transcript for evidence the agent invoked the skill, tolerant of the
shape difference between providers: claude-code-acp exposes a first-class
`Skill` tool call, while codex-acp has no dedicated skill tool and instead
reads the skill file via its native Read/shell tool, detected by a
`<slug>/SKILL.md` path match.

:::note[Next: turning a run into a verdict]
`skillmaker run` produces real transcripts and artifacts. Turning one into
a pass/fail verdict — and the *n* · pass-rate · confidence-interval
measurements built on top of graded runs — is covered in
[Grading and measurements](/evals/grading-and-measurements/). Coverage
authoring (fixtures, risk maps) works independently of any run; see
[Fixtures and risk maps](/evals/fixtures-and-risk-maps/).
:::
