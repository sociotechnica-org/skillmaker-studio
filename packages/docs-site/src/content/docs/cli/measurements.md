---
title: skillmaker measurements
description: Show measurement cells - n, pass rate, CI, guidance.
---

```text
skillmaker measurements <slug>
```

Aggregates graded runs into measurement cells and prints them, one row per
`{fixture, version, provider/model}` tuple — the CLI's version of the
viewer's read-out (data-model.md §2.11). Rebuilds the index first, so it's
always current with the journal.

## Never pooled

Each row is scoped to one exact `(bundle, fixture case, skill version hash,
provider, model)` combination. Recording a new version, running against a
different provider, or writing a new fixture case all start a fresh row at
`n = 0` — nothing carries forward across any of those dimensions. See
[Coverage vs. validation](/evals/coverage-vs-validation/) for why.

## Output

Text mode, one bundle with three graded runs on one fixture/version/provider:

```text
$ skillmaker measurements my-first-skill
FIXTURE             VERSION              PROVIDER                  N  PASS%  CI          GUIDANCE
refusal-thin-input  sha256:4f53cda18c2b  claude-code/fake-model-1  3  67%    [21%, 94%]  (below smoke)
```

`VERSION` is the version hash's short form; `PROVIDER` collapses to just the
provider id when the model name duplicates it. `GUIDANCE` reads `smoke`,
`estimate`, or `ship-gate` once `n` crosses the corresponding threshold (5,
30, 100), or `(below smoke)` under `n = 5`.

`--json` mode returns the full records, including raw pass counts and the
computed confidence interval:

```text
$ skillmaker measurements my-first-skill --json
{"measurements":[{"bundle":"my-first-skill","fixtureCase":"refusal-thin-input","versionHash":"sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","provider":"claude-code","model":"fake-model-1","n":3,"passes":2,"passRate":0.6666666666666666,"ci":[0.20765960080204768,0.9385080552796037],"guidance":null}]}
```

(`guidance` is `null` in JSON below the smoke threshold, same as `(below
smoke)` in text mode.)

With no graded, completed runs yet for the bundle:

```text
$ skillmaker measurements my-first-skill
skillmaker: no measurements yet (no graded, completed runs for this bundle)
```

## Confidence intervals

Computed at read time from the raw pass/fail counts, never stored — always
consistent with current run history:

- **Zero observed failures:** rule-of-three, `[1 - 3/n, 1]` — the standard
  small-sample substitute for a Wilson interval when a 100% point estimate
  would otherwise read as overconfident.
- **At least one failure:** a 95% Wilson score interval on `passes / n`.

## Exit codes

```text
0  ok             -- printed (rows or the "no measurements yet" message)
1  refused         -- no such bundle
2  usage error     -- missing <slug>
```

## See also

[Grading and measurements](/evals/grading-and-measurements/) for the full
model — how `n`, guidance thresholds, and confidence intervals fit
together — and [`skillmaker grade`](/cli/grade/) for producing the graded
runs this command aggregates.
