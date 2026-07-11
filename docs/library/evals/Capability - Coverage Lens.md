---
type: Capability
prefLabel: Coverage Lens
context: evals
status: migrated
links:
  operates_on:
    - "./Entity - Risk Map"
  related_to:
    - "./Reference - Risk Family"
    - "./Economy - Coverage"
    - "./Economy - Validation"
---

## WHAT
The lens that answers "what's covered?" for a bundle — renders the
risk-map, banding each risk by family, showing both the authored Coverage
axis and the measured Validation axis honestly, side by side, per
provider/model.

## WHY
Becomes the eval surface's per-provider coverage axis: since Validation is
now keyed by `{fixtureCase, versionHash, provider, model}` rather than a
single per-play number, the lens must show coverage relative to whichever
provider/model combination is selected, not one collapsed figure.

## HOW
Reads [[Entity - Risk Map]] rows (bundle, riskId, family, coverage,
fixtureCase), groups by [[Reference - Risk Family]], and for each row joins
the current skill version's measurements (per the mechanism described in
[[Economy - Validation]]) to show [[Economy - Coverage]] beside the
computed Validation figure — never merged into one number.

Verified: `packages/core/src/RiskMap.ts`'s `RiskRow` shape (`riskId`,
`family`, `description`, `coverage`, `fixtureCase?`) is exactly the tuple
this lens groups and joins over.
