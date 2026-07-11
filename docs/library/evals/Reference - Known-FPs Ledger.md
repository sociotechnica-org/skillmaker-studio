---
type: Reference
prefLabel: Known-FPs Ledger
context: evals
status: migrated
links:
  related_to:
    - "./Entity - Risk Map"
    - "./Entity - Read-Out"
---

## WHAT
A proposed per-bundle ledger of the patterns a fresh-eyes checker or grader
reliably flags that are dispositioned by design, each entry naming an exact
pattern with provenance, so a by-design pattern isn't re-flagged as a novel
instance.

## WHY
The prep doc flagged this ⚠ with no stated home, recommending KEEP as an
optional per-bundle file pending director confirmation. Checking the
shipped code resolves the uncertainty directionally, if not the director's
call itself: nothing like this exists in the product today.

## HOW
Grepped `packages/core/src` and `packages/cli/src/commands` for `known`,
`false-positive`, and `falsePositive` — no matches. There is no
`known-fps.md` file, no schema for it, no CLI command that reads or writes
one, and no reference to it anywhere in data-model.md's Part 2 concrete
form.

**Status: documented as a recommended-not-required optional pattern, not
implemented in the shipped product as of this writing.** If a bundle
author wants this today, nothing stops them hand-writing a
`skills/<slug>/evals/known-fps.md` — reindex validation doesn't scan
`evals/` for anything beyond `fixtures/` and `risk-map.md`, so an
unrecognized file there is simply inert, not flagged. This card records
the pattern as a candidate, not as a mechanism to rely on; do not treat it
as implemented until the director confirms a home and it ships.

Verified: `grep -rniE "known-?fp|falsePositive|false-positive"` over
`packages/core/src` and `packages/cli/src/commands` — zero matches.
