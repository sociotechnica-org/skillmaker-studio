---
title: Coverage vs. validation
description: The two-axis honesty law and how to measure it (k=5/30/100).
---

Skillmaker Studio treats two facts about an eval as permanently separate,
never allowed to merge into one number:

- **Coverage** — a fixture exists for a given risk. This is authored, sits
  in `evals/risk-map.md` (see [Fixtures and risk maps](/evals/fixtures-and-risk-maps/)),
  and requires no runs at all.
- **Validation** — the skill actually passes that fixture at a measured
  rate. This requires real runs, and until they exist, validation reads
  honestly as **"not yet measured"** rather than defaulting to a false
  positive or a blank.

A risk map with every row `● covered` tells you the skill's designer
*thought about* every failure mode — it tells you nothing about whether the
skill actually handles any of them. Only graded runs answer that.

## Never pooled

**A single run is a sample, not a measurement.** Measurements are always
reported as *n · pass-rate · confidence interval*, keyed to one specific
(bundle, fixture case, skill version hash, provider, model) tuple — never
pooled across versions, providers, or models. Recording a new skill version
resets displayed validation for that version to "not yet measured" by
construction: an old version's pass rate says nothing about a new one's.

## Measurement guidance

How many runs (`k`) buys a meaningful read on a fixture depends on how
confident you need to be and how noisy the outcome is:

| `k` | Use it for |
|---|---|
| `k=5` | A quick sanity check during drafting — enough to catch a glaringly broken skill, not enough to trust a pass rate |
| `k=30` | A working confidence interval for day-to-day validation before shipping a version |
| `k=100` | High-stakes fixtures (adversarial, refusal cases with real consequences) where a tight confidence interval matters |

Confidence intervals are computed at read time from the raw pass/fail
counts (rule-of-three when there are zero observed failures, a binomial
interval otherwise) — never stored, so they're always consistent with the
current run history.

## Where this shows up today

Both halves of the axis are built. Coverage authoring — risk maps and
fixtures — is covered in
[Fixtures and risk maps](/evals/fixtures-and-risk-maps/). The **measured**
half — running fixtures, grading the runs, and the read-out surface that
joins coverage × validation per provider/model — is covered in
[Running fixtures](/evals/running-fixtures/) and
[Grading and measurements](/evals/grading-and-measurements/).
