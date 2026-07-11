---
type: Reference
prefLabel: Risk Family
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Risk Map"
---

## WHAT
The canonical taxonomy a behavioral risk classifies into: `IN` (input), `RE`
(reasoning), `OUT` (output/behavioral), `ADV` (adversarial), `CHN` (chain,
sometimes rendered "Systemic"). There is no bundle-specific family; risks
are shaped to a bundle but still classify into one of these five, and a
misfiled row is surfaced, never given a catch-all band.

## HOW
`RISK_FAMILIES = ["IN", "RE", "OUT", "ADV", "CHN"]` in
`packages/core/src/Fixtures.ts` — shared by both fixture risk ids
(`case.json`'s `risks[]`) and [[Entity - Risk Map]] rows. `riskFamily(id)`
extracts the prefix before the first `-` (e.g. `"IN-2"` → `"IN"`);
`isKnownRiskFamily` checks membership. A risk id whose prefix doesn't band
into one of the five is a reindex warning, cited by id at reindex time —
both in fixture scanning (`scanFixtures`) and risk-map parsing
(`parseRiskMap`), never a hard failure (Part 3 ruling I).

A Risk Family is the band each row in a [[Entity - Risk Map]] (and each
risk id in a fixture's `risks[]`) falls under.

Verified: `RISK_FAMILIES`, `riskFamily`, and `isKnownRiskFamily` in
`packages/core/src/Fixtures.ts`; both `Fixtures.ts`'s `scanFixtures` and
`RiskMap.ts`'s `parseRiskMap` call `isKnownRiskFamily` and emit the same
"does not band into a known family" warning shape.
