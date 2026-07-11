---
title: skillmaker grade
description: Record a run's grading verdict.
---

```text
skillmaker grade <slug> <runId> --verdict pass|fail|partial [--notes <text>]
```

The CLI door onto the same journal the viewer's grading panel writes
through ("two doors, one journal"): appends one `run.graded` event
(data-model.md §2.9). Grading is a decision, not a stored field on the
run — `run.json` never carries a verdict.

## Options

| Flag | Meaning |
|---|---|
| `--verdict <pass\|fail\|partial>` | The grading verdict (required) |
| `--notes <text>` | Free-text notes attached to this grading event |
| `--json` | Emit machine-readable JSON instead of text |

## Regrades are new events, not edits

There's no `--force` or update flag: grading a run that's already been
graded just appends another `run.graded` event. The **latest event wins**
for the run's current verdict (what [`measurements`](/cli/measurements/)
counts), but every prior grading stays in the journal's history — a
regrade is a genuinely new decision, not a correction that erases the old
one.

## Only completed runs can be graded

```text
skillmaker grade: run "<runId>" cannot be graded: status is "<status>", not "completed"
(infra-error/running runs are never graded)
```

`infra-error` and `running` runs carry no task-level verdict to grade —
this refusal keeps infrastructure noise out of pass rates (see
[Coverage vs. validation](/evals/coverage-vs-validation/)). It's enforced
identically in the viewer's grading panel (a 409 from the server).

## Output

Text mode:

```text
$ skillmaker grade my-first-skill 290943f3-cecc-46b5-91ba-04bca9c0bb20 --verdict pass
skillmaker grade: recorded verdict "pass" for run 290943f3-cecc-46b5-91ba-04bca9c0bb20 (my-first-skill)
```

`--json` mode:

```text
$ skillmaker grade my-first-skill b463c416-5203-4651-8351-0ad1b137fce6 --verdict pass --json
{"status":"appended","bundle":"my-first-skill","runId":"b463c416-5203-4651-8351-0ad1b137fce6","verdict":"pass"}
```

`status` is `"appended"` for a new event or `"already_appended"` if the
exact same grading (same run, same idempotency context) was already
recorded.

## Exit codes

```text
0  appended      -- the grading event was recorded
1  refused        -- no such run, or the run isn't "completed"
2  usage error    -- bad invocation (missing <slug>/<runId>/--verdict, or an
                     invalid --verdict value)
```

## See also

[Grading and measurements](/evals/grading-and-measurements/) for the full
mechanics — the run detail read-out, the grading panel's checklist, and how
graded runs turn into [`skillmaker measurements`](/cli/measurements/).
