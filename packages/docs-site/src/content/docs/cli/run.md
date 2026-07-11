---
title: skillmaker run
description: Run a fixture case through an ACP provider.
---

```text
skillmaker run <slug> --fixture <case> [--provider <id>] [--timeout <s>]
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
| `--timeout <s>` | Prompt timeout in seconds; defaults to `300` |
| `--json` | Emit machine-readable JSON instead of text |

## Exit codes

```text
0  completed    -- the run finished normally
1  failed        -- the run finished, but the task failed
2  usage error   -- bad invocation (missing <slug> or --fixture)
3  infra-error   -- auth, sandbox, or connection fault
```

`infra-error` and `failed` are kept strictly separate so infrastructure
noise never pollutes a fixture's measured pass rate.

## Output

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

If no version has been recorded yet for the bundle, one is recorded
automatically before the run starts, so every run is pinned to a real
content hash.

## See also

[Running fixtures](/evals/running-fixtures/) for the full mechanics,
what's written to `runs/<run-id>/`, and provider configuration.
