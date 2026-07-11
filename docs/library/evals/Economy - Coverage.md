---
type: Economy
prefLabel: Coverage
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Risk Map"
    - "./Economy - Validation"
---

## WHAT
The authored axis of a risk — does a fixture exist for it, hand-assessed as
`covered | partial | gap | n/a` — distinct from the measured pass rate so
collapsing them never fabricates validation.

## WHY
Law §1.4: "Coverage and validation never merge." Authored "a fixture
exists" and measured "it passes at rate r over n runs" are separate facts,
and must stay separate even under UI pressure to show one number.

## HOW
Coverage is a value on each [[Entity - Risk Map]] row's `Coverage` column
— `COVERAGE_VALUES = ["covered", "partial", "gap", "n/a"]` in
`packages/core/src/RiskMap.ts`. The cell may be written as glyph+word
(`"● covered"`), just the word, or just the glyph (`●`/`◐`/`○`);
`parseCoverageCell` accepts all three forms. Coverage is deliberately shown
beside — never merged with — [[Economy - Validation]], which is computed
separately at read time, not stored anywhere in `risk-map.md`.

Verified: `COVERAGE_VALUES`, `COVERAGE_GLYPHS`, and `parseCoverageCell` in
`packages/core/src/RiskMap.ts`.
