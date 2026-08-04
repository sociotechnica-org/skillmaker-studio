---
type: Entity
prefLabel: Risk Map
context: evals
status: migrated
links:
  contains:
    - "./Reference - Risk Family"
    - "./Economy - Coverage"
  conforms_to:
    - "./Mechanism - Reindex Validation"
  related_to:
    - "./Capability - Coverage Lens"
    - "./Economy - Validation"
---

## WHAT
A bundle's own record of which behavioral risks apply, banded by family,
carrying only the authored Coverage axis — one axis, not two. The measured
Validation axis is no longer part of this file; it is computed and joined
at read time (see [[Economy - Validation]]).

## WHY
Law §1.4: "Coverage and validation never merge." The old model's risk-map
row held both an authored Coverage cell and a computed Validation cell in
the same table. The new model enforces the separation structurally, not
just by convention: there is no results column in `risk-map.md` at all, so
validation literally cannot be stored here even by accident.

## HOW
`skills/<slug>/evals/risk-map.md` — frontmatter `bundle:` + a markdown
table:

```markdown
---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | refusal-thin-input |
```

Same shape as the source card described, minus the results column — this
is the direct match to data-model.md §2.6. A missing `risk-map.md` is fine
(no warning; it's optional until authored). Risk ids band into the five
[[Reference - Risk Family|risk families]] (IN/RE/OUT/ADV/CHN);
`packages/core/src/RiskMap.ts`'s `parseRiskMap` flags an unbanded id as a
warning, never a hard failure. `checkCoverage` separately cross-references
each row's `Fixture` cell against the bundle's actually-scanned fixture
cases, warning if it points at a case that doesn't exist.

A Risk Map contains [[Reference - Risk Family]]-banded rows, each carrying
a [[Economy - Coverage]] state; it conforms to
[[Mechanism - Reindex Validation]] and is read by the
[[Capability - Coverage Lens]].

Verified against a real shipped risk-map,
`skills/william-draft-skill-md/evals/risk-map.md` (frontmatter `bundle:` +
the exact four-column table header, no results column), and against
`packages/core/src/RiskMap.ts` (`parseRiskMap`, `checkCoverage`,
`COVERAGE_VALUES = ["covered", "partial", "gap", "n/a"]`).

## RULED DIRECTION (NOT SHIPPED): CLAIMS MOVE TO STRUCTURED JSON

Director rulings from the from-scratch walk
(`docs/friction/e2e-readiness.md`, "Claims storage ruling forming",
firmed 2026-07-30): `risk-map.md` as a parsed markdown table is on its way
out — "risk-map.md should be completely subsumed by json-stored data. all
reads/writes to that json data should be enacted through the CLI." The
direction: claims (risks) move to a bundle-level structured source;
fixtures reference claim ids; any markdown view is a **render, not the
source**. Invariant to preserve in the restructure: gap claims (a risk
with no fixture) need the bundle-level home — per-fixture files cannot be
the only store. The CLI door also buys journal events for every claim
mutation (dots, activity, provenance, and chat-path visibility for free)
— part of the converging "structured data behind CLI doors, prose as
render, events as witness" architecture. This card's HOW stays accurate
until that restructure ships; nothing here is built yet.
