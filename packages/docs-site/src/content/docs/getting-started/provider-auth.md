---
title: Provider auth & troubleshooting
description: How run authenticates providers, what "Authentication required" / infra-error exit 3 means, and how to fix it.
---

`skillmaker run` and `skillmaker station run` launch each provider's CLI
(`claude-code-acp`, `codex-acp`) inside an isolated sandbox — a fresh,
per-run config directory (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) so the run
can never see or contaminate your real `~/.claude`/`~/.codex` state or
skills. That isolation is deliberate (see
[Running fixtures](/evals/running-fixtures/)), but on a first install it
also means the sandbox starts out **unauthenticated**, even when your real
shell is already logged in. This page exists because three separate real
runs (Phase 20 stories 3, 5, and 6 — friction logs linked below) hit this
exact wall before it was fixed and documented.

## How auth works today (since v0.2.1)

Before launching the provider, `skillmaker` seeds the sandbox's isolated
config directory with **only** the one credential file each provider's CLI
actually reads — nothing else from your real config (no skills, no
settings):

- **codex**: copies `$CODEX_HOME/auth.json` (defaulting to `~/.codex/auth.json`)
  into the sandbox's isolated `CODEX_HOME`.
- **claude-code**: copies `$CLAUDE_CONFIG_DIR/.credentials.json` if it
  exists (Linux, or a macOS install using the file-based credential
  store); otherwise, on macOS, reads the OAuth token **read-only** from
  the login Keychain entry `"Claude Code-credentials"` (exactly what
  `claude login` writes) and writes it into the sandbox's isolated
  `.credentials.json`.

In short: **a sandboxed run rides your already-logged-in CLI session** the
same way your real shell does — you don't need a separate API key, and you
don't need to hand-craft a token file. This closed the gap Stories 3/5/6
hit, where sandbox isolation shipped in v0.2.0 but auth pass-through
didn't ship until v0.2.1.

Seeding is best-effort and silent when it succeeds — you'll only see it
mentioned if it *fails* (see below). It never touches your real Keychain
entry or config files (read-only lookup, and it copies into the sandbox's
own directory, not the other way around).

### The credential-leak fix (why this matters more than convenience)

Story 5 and Story 6 independently found that the *original* workaround
users were forced into — hand-copying credentials into the sandbox
themselves — got those credentials swept up by the run's own artifact
capture (which diffs the whole workspace) and written into
`runs/<id>/artifacts/`, a git-tracked directory. Story 6 confirmed this
live: a real OAuth token landed in a commit before a pre-commit grep
caught it. v0.2.1 fixed this **structurally**, not just with a filter:
the isolated config directory (where seeded credentials live) sits outside
the OS temp directory the run sandboxes, entirely outside the artifact
surface `run` ever diffs — a leak is impossible by construction, not just
denied by a redaction rule. A redaction pass over artifact basenames
(`.credentials.json`, `auth.json`, `*.token`, `*.pem`) remains as a
belt-and-suspenders second layer on top of that structural fix.

## What "Authentication required" / infra-error exit 3 means

`skillmaker run` exits `3` (`infra-error`) for auth, sandbox, or
connection faults — deliberately kept separate from exit `1` (`failed`,
a real task failure) so infrastructure noise never pollutes a fixture's
measured pass rate. See [`skillmaker run`](/cli/run/#exit-codes).

Before the fix in this page's title, the *only* place the real cause
showed up was the run's `stderr.txt`:

```text
{"code":-32000,"message":"Authentication required"}
```

with the CLI summary printing nothing more specific than `infra-error`.
As of the current auth-seeding fix, if seeding itself failed (no
credential material found), the CLI's failure line names exactly what
was looked for and how to fix it, e.g.:

```text
skillmaker run: ...

sandbox auth: no Claude Code credential material found (checked
~/.claude/.credentials.json and the macOS Keychain entry
"Claude Code-credentials") -- run `claude login` first
```

If you still see a bare `Authentication required` with no `sandbox auth:`
hint, seeding *succeeded* (a credential file was found and copied) but the
provider rejected it anyway — usually an expired or revoked token, not a
missing one.

## Checklist to fix it

1. **Confirm your real CLI is actually logged in**, outside skillmaker
   entirely:
   - claude-code: `claude login` (or check `claude /status` / that
     `~/.claude/.credentials.json` exists, or on macOS that `security
     find-generic-password -s "Claude Code-credentials"` returns a value).
   - codex: `codex login` (or check that `~/.codex/auth.json` exists).
2. **Re-run.** Seeding happens fresh at the start of every `run` — there's
   nothing to "activate" beyond being logged in when the command starts.
3. **If the token is stale**, log out and back in
   (`claude logout && claude login` / equivalent for codex) rather than
   editing sandbox files by hand — the seeded copy is derived from your
   real login state every run, so a bad manual copy will just get
   overwritten anyway.
4. **Non-macOS / non-default install locations**: if `CLAUDE_CONFIG_DIR`
   or `CODEX_HOME` points somewhere nonstandard in your real shell, export
   the same value before running `skillmaker run` — seeding reads from
   those env vars first, falling back to `~/.claude` / `~/.codex`.
5. **CI or a machine with no interactive login** (an API-key-only setup):
   auth seeding is best-effort and never blocks a run that doesn't need
   it — a provider authenticated via an env-var API key the ACP adapter
   reads directly needs no seeding at all.

## Infra-errors never pollute pass rates

Whatever the cause, an `infra-error` run is excluded from
[`skillmaker measurements`](/cli/measurements/) entirely — it never counts
toward `n`, never shows as a pass or a fail. This held true even during
the friction stories that hit these auth failures: every infra-error run
across Stories 3, 5, and 6 was correctly kept out of the measured tables,
so a broken auth setup produces *no run*, not a *false failure*. If a run
that should have succeeded shows up as `infra-error`, re-run it after
fixing auth above — it costs you a run, not a data point.

## See also

- [`skillmaker run`](/cli/run/) — exit codes and the auth-failure hint in
  context.
- [`skillmaker run repair`](/cli/run-repair/) — recovers a run stuck in
  `"running"` from a crash mid-capture; unrelated to auth failures, which
  always terminal-state cleanly as `infra-error`.
- [Running fixtures](/evals/running-fixtures/) — the full sandbox
  isolation model this page's seeding fits into.
- The real friction that drove this page:
  [Story 3](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/_archive/phase20/story-3-friction-log.md#f4-p2--provider-auth-is-undocumented-and-sandbox-hostile),
  [Story 5](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/_archive/phase20/story-5-friction-log.md#p1--both-providers-fail-auth-out-of-the-box-on-a-keychain-machine),
  and
  [Story 6](https://github.com/sociotechnica-org/skillmaker-studio/blob/main/docs/_archive/phase20/story-6-friction-log.md#p1-sandbox-auth-is-undocumented-and-effectively-unsupported-keychain-mac-20min)
  friction logs.
