---
title: Grading and measurements
description: Turning a run into a verdict, and verdicts into n-pass-rate-CI measurements.
---

[Running fixtures](/evals/running-fixtures/) produces run records —
transcripts and artifacts — but a run isn't a measurement until a human (or
an agent, journaled the same way) turns it into a verdict. This page covers
that grading step and the measurement cells built on top of it
(data-model.md §2.9, §2.11, §2.12).

## The run detail read-out

Clicking a run in the viewer's Evals tab opens the run detail surface: the
run's header (status, model, timing), the full transcript rendered
role-by-role (agent messages, the prompt, tool calls and raw protocol
collapsed to expandable one-liners, permission decisions highlighted), the
artifacts the run produced, and — for `completed` runs — the grading panel.

## The grading panel

The grading panel captures three things:

- **A verdict** — `pass`, `fail`, or `partial`.
- **Checks** — if the fixture's `case.json` carries a `grading.checks` list
  (see [Fixtures and risk maps](/evals/fixtures-and-risk-maps/)), each one
  renders as a checkbox; submitting records which checks passed alongside
  the overall verdict.
- **Notes** — free-text context for the call.

Submitting posts one `run.graded` event. This is the same journal event the
CLI's [`skillmaker grade`](/cli/grade/) appends — "two doors, one journal":
whichever door you use, the other one sees it.

A run that isn't `status: "completed"` (still `running`, or an
`infra-error`) can't be graded — there's no task-level outcome to judge.
Both doors refuse it: the CLI exits `1`, the server returns `409`.

### Regrades are new events, not edits

Grading an already-graded run doesn't overwrite anything — it appends
another `run.graded` event. The run detail view's grading history shows
every past grading, with the latest bolded as the one that counts. "Latest
wins" is resolved once, at index build time (`IndexService`'s
`gradeByRunId` fold keeps only the newest event per run id) — every reader
downstream, including measurements, sees one current verdict per run.

## Measurements: never pooled

A **measurement cell** is `n` graded runs aggregated for one exact
`(bundle, fixture case, skill version hash, provider, model)` tuple —
never pooled across any of those five dimensions (the two-axis honesty law;
see [Coverage vs. validation](/evals/coverage-vs-validation/)). The Evals
tab and `skillmaker measurements <slug>` render the same cells; the SQLite
`measurements` view (data-model.md §2.11) computes them straight from
`runs`, so nothing is stored redundantly.

Each cell reports:

| Field | Meaning |
|---|---|
| `n` | Graded, completed runs in this exact bucket |
| `passes` | How many graded `pass` |
| `passRate` | `passes / n` |
| `ci` | 95% confidence interval on the pass rate |

### Confidence intervals

Computed at read time, never stored, so they're always consistent with
current run history:

- **Zero observed failures** → the **tighter** of rule of three
  (`[1 - 3/n, 1]`) and a 95% Wilson score interval evaluated at
  `passes = n`. Wilson's own zero-failure lower bound is narrower than rule
  of three's below roughly `n = 14`, and looser above it; picking the
  tighter one avoids a small-`n` trap. At `n = 3` all-pass, a bare rule of
  three gives `[0%, 100%]` — an interval that *contains 0%* for a fixture
  that never failed, which reads as broken "honest math"; the tighter pick
  reads `[43.8%, 100%]` instead.
- **At least one failure** → a 95% Wilson score interval on `passes / n`.

### Guidance thresholds

`n` is labeled against three thresholds, surfaced as data (not enforced):

| `n ≥` | Label | Use it for |
|---|---|---|
| 5 | `smoke` | A quick sanity check — enough to catch a glaringly broken skill |
| 30 | `estimate` | A working confidence interval for day-to-day validation |
| 100 | `ship-gate` | High-stakes fixtures where a tight interval matters |

Below `n = 5`, both the CLI and the viewer just say so plainly (`(below
smoke)` / `null` in `--json`) rather than implying a reliability the sample
size doesn't support. `skillmaker measurements` also prints a one-line
explanation of `(below smoke)` right under the table whenever it appears,
so the label is self-describing in CLI output, not just in these docs.

### Honest version resets

Recording a new skill version (`skillmaker version record`) doesn't carry
old measurements forward. A new `versionHash` is a new key in every
measurement's grouping tuple, so the new version starts at `n = 0` — "not
yet measured" by construction, not a stale number copied from the version
it replaced. See [Versions and drift](/concepts/versions-and-drift/).

## Worked example

Three runs of the same fixture/version/provider, graded pass, pass, fail:

```text
$ skillmaker grade my-first-skill 290943f3-cecc-46b5-91ba-04bca9c0bb20 --verdict pass
skillmaker grade: recorded verdict "pass" for run 290943f3-cecc-46b5-91ba-04bca9c0bb20 (my-first-skill)

$ skillmaker grade my-first-skill b463c416-5203-4651-8351-0ad1b137fce6 --verdict pass
skillmaker grade: recorded verdict "pass" for run b463c416-5203-4651-8351-0ad1b137fce6 (my-first-skill)

$ skillmaker grade my-first-skill fbf5e31d-2749-4418-b7e1-e8187151a6fd --verdict fail --notes "refused too eagerly on ambiguous prompt"
skillmaker grade: recorded verdict "fail" for run fbf5e31d-2749-4418-b7e1-e8187151a6fd (my-first-skill)

$ skillmaker measurements my-first-skill
FIXTURE             VERSION              PROVIDER                  N  PASS%  CI          GUIDANCE
refusal-thin-input  sha256:4f53cda18c2b  claude-code/fake-model-1  3  67%    [21%, 94%]  (below smoke)
```

`n = 3` is well below the `smoke` threshold — three runs establish that the
skill *can* pass, not that it reliably does. Getting to `smoke` (5) or
`estimate` (30) means running the fixture more times against the same
pinned version and provider.

## See also

[`skillmaker grade`](/cli/grade/) and
[`skillmaker measurements`](/cli/measurements/) for the CLI surface,
[Running fixtures](/evals/running-fixtures/) for how runs are produced in
the first place, and
[Coverage vs. validation](/evals/coverage-vs-validation/) for the honesty
law this all serves.
