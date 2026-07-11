---
type: Economy
prefLabel: Validation
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Risk Map"
    - "./Economy - Pass Rate"
    - "./Economy - Coverage"
---

## WHAT
The measured axis of a risk — the pass rate across real graded runs for the
fixture(s) that buy that risk's coverage. Reads "not yet measured" until
graded runs exist for the current skill version.

## WHY
Implementation changed from the old model, concept did not. Previously
Validation was a stored/computed field living on the risk-map row itself
(a "results column"). In the shipped model there is no results column in
`risk-map.md` at all (§2.6) — Validation is purely a **viewer-time join**:
the read-out surface joins the risk-map's Coverage axis against the
`measurements` view (grouped by bundle/fixtureCase/versionHash/provider/
model) for the bundle's *current* skill version, and displays the result.
Nothing about Validation is ever written to a file or a row; it is
recomputed every time it's viewed.

"Not yet measured" is the honest default: a fresh bundle, or a bundle whose
skill version was just bumped, shows no Validation until new graded runs
land against that version hash (see
[[Reference - Measurements Bind To Version]] — measurements never carry
forward across a version change).

## HOW
Computed by joining [[Entity - Risk Map]] rows (bundle, riskId, fixtureCase)
against `measurements` (a SQL view in `packages/core/src/IndexService.ts`
over `computeMeasurements` in `packages/core/src/Measurements.ts`), filtered
to the risk-map row's `fixtureCase` and the bundle's current
`skillVersionHash`. The join happens in the viewer's read-out surface (see
[[Entity - Read-Out]]), not at reindex time and not stored in SQLite as a
materialized column.

Verified: `packages/core/src/RiskMap.ts`'s header comment ("There is NO
results column, ever ... validation is computed from graded runs and
joined in the viewer at read time"), and `computeMeasurements` in
`packages/core/src/Measurements.ts` (the grouping this join reads from).
