---
type: Economy
prefLabel: Pass Rate
context: evals
status: migrated
links:
  related_to:
    - "./Economy - Validation"
    - "./Reference - Measurement Policy"
    - "./Capability - Eval Run"
---

## WHAT
The reliability parameter the studio actually cares about — the probability
a bundle's skill clears the bar across runs, reported with its sample size
(n · pass-rate · CI), never a bare label. A single run is a sample, not a
measurement.

## WHY
Law §1.5: "A single run is a sample, not a measurement — n · pass-rate ·
CI, never pooled." This is the same inherited law almost verbatim; the
shipped model enforces the "never pooled" half structurally by grouping
strictly on `{bundle, fixtureCase, versionHash, provider, model}` — five
dimensions, any change to any one of them starts a fresh count.

## HOW
`computeMeasurements` in `packages/core/src/Measurements.ts` aggregates
graded, `status: "completed"` runs into cells keyed by exactly those five
fields, each cell carrying `n`, `passes`, `passRate`, and a 95% confidence
interval (`ci`) computed at read time — never stored. `"partial"` verdicts
do not count as a pass. A Pass Rate is the number behind the
[[Economy - Validation]] axis, governed by the
[[Reference - Measurement Policy]] (how many runs a claim needs), and
produced one run at a time by [[Capability - Eval Run]].

Verified: `computeMeasurements`, `MeasurementRecord`, and the
never-pooled grouping key (`measurementKey`) in
`packages/core/src/Measurements.ts`.
