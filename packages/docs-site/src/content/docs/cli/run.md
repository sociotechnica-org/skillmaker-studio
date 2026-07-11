---
title: skillmaker run
description: Run a fixture case through an ACP provider.
---

```text
skillmaker run <slug> --fixture <case> [--provider <id>] [--model <id>] [--timeout <s>]
```

Drives one eval run end to end: installs the bundle's `output/` as a skill
in a temporary workspace seeded from the fixture's `files/`, launches the
configured provider over ACP with the fixture's prompt, captures the full
session, and diffs the workspace into `artifacts/`.

## Options

| Flag | Meaning |
|---|---|
| `--fixture <case>` | The fixture case to run (required) |
| `--provider <id>` | Provider id from `skillmaker.config.json`; defaults to `claude-code` |
| `--model <id>` | Model id from the provider's advertised `session/new` `models.availableModels` (e.g. `default`, `sonnet`, `haiku`); defaults to the provider's own default |
| `--timeout <s>` | Prompt timeout in seconds; defaults to `300` |
| `--json` | Emit machine-readable JSON instead of text |

### `--model`

Threads a per-run model selection through to the ACP `session/new` call.
Unknown ids are rejected with the provider's own advertised
`models.availableModels` list, so a typo fails fast instead of silently
falling back to the default. The failure surfaces as the run's
`errorMessage` (visible in the CLI summary and `--json`, not just
`stderr.txt`):

```text
unknown model "sonnet-4.9" -- advertised models: default, sonnet, opus, haiku
```

`run`'s summary and every stored record use the **resolved** model id (the
concrete id the provider actually ran, e.g. `claude-opus-4-6`), never the
requested alias (e.g. `"default"`) — a run requested with no `--model` at
all and one requested with `--model default` on the same provider record
identically, so `skillmaker measurements` never accidentally pools two
different concrete models under one ambiguous label.

## Exit codes

```text
0  completed    -- the run finished normally
1  failed        -- the run finished, but the task failed
2  usage error   -- bad invocation (missing <slug> or --fixture)
3  infra-error   -- auth, sandbox, or connection fault
```

`infra-error` and `failed` are kept strictly separate so infrastructure
noise never pollutes a fixture's measured pass rate. `infra-error` most
commonly means the provider rejected auth — see
[Provider auth & troubleshooting](/getting-started/provider-auth/) for what
that looks like and the checklist to fix it.

## Output

```text
skillmaker run: sandbox ready, starting "claude-code" session...
..........
skillmaker run: completed (10 session update(s), skill invoked)
skillmaker run: completed (my-first-skill, run 01JZX8M2E9V0Q4)
  version:   sha256:4f66bb815c24 (auto-recorded before this run)
  model:     claude-opus-4-6
  skill:     installed
  invoked:   yes (transcript shows the skill was used)
  artifacts: NOTES.md
  response:  skills/my-first-skill/runs/01JZX8M2E9V0Q4/response.md
  run dir:   skills/my-first-skill/runs/01JZX8M2E9V0Q4
```

If no version has been recorded yet for the bundle, one is recorded
automatically before the run starts, so every run is pinned to a real
content hash.

### `response.md`

Every run writes `runs/<run-id>/response.md`: the agent's final message,
extracted from the transcript. Grading against a fixture's answer key
never requires reading raw `transcript.jsonl` — `cat` the run dir's
`response.md` (and any files in `artifacts/`) next to `expected/` and
compare directly.

## See also

[Running fixtures](/evals/running-fixtures/) for the full mechanics,
what's written to `runs/<run-id>/`, and provider configuration.
[Provider auth & troubleshooting](/getting-started/provider-auth/) for
`infra-error` auth failures. [`skillmaker run repair`](/cli/run-repair/)
for recovering a run that crashed mid-capture and got stuck in
`"running"`.
