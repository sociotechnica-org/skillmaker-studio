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
