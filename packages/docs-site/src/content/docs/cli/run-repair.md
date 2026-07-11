---
title: skillmaker run repair
description: Terminal-state a stuck "running" run so its transcript becomes gradeable.
---

```text
skillmaker run repair <slug> [runId]
```

Fixes runs left stuck in `status: "running"` forever — the failure mode
Phase 20 Story 3 hit when `skillmaker run` crashed mid-capture (a transient
file disappearing under the sandbox during workspace diffing) and left
`run.json` truncated with no terminal status, even though the session
itself completed and its transcript is intact on disk. Before this
command existed, `grade` refused those runs permanently
("infra-error/running runs are never graded") with no way to move them out
of `"running"` — real evidence, unreachable forever.

`run repair` re-derives a terminal status from each stuck run's
transcript, so it becomes gradeable again. It repairs every stuck run for
`<slug>` when `runId` is omitted, or exactly one when given.

## Options

| Flag | Meaning |
|---|---|
| `runId` | Repair only this run id; defaults to every stuck run for `<slug>` |
| `--json` | Emit machine-readable JSON instead of text |

## Output

```text
skillmaker run repair: repaired 1 run(s) for "code-review"
  01JZX8M2E9V0Q4: -> completed (transcript ends with a terminal agent turn)
```

`--json`:

```json
{"bundle":"code-review","repaired":[{"runId":"01JZX8M2E9V0Q4","status":"completed","reason":"transcript ends with a terminal agent turn"}]}
```

If nothing for `<slug>` is stuck, it repairs zero runs (not an error) — the
command is safe to run speculatively.

## See also

[`skillmaker run`](/cli/run/) for how a run reaches `"running"` in the
first place, and [Provider auth & troubleshooting](/getting-started/provider-auth/)
for the (unrelated) auth failure class, which always terminal-states
cleanly as `infra-error` and never needs repair.
