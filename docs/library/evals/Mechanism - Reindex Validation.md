---
type: Mechanism
prefLabel: Reindex Validation
context: evals
status: migrated
links:
  operates_on:
    - "./Entity - Risk Map"
  related_to:
    - "./Entity - Fixture"
---

## WHAT
The validation that runs as a side effect of `skillmaker reindex` — the CLI
command that rebuilds `.skillmaker/studio.db` from files + the journal,
scanning every bundle's `bundle.json`, `evals/fixtures/*/case.json`, and
`evals/risk-map.md` along the way and reporting anything malformed as a
warning.

## WHY
**Philosophy flip, worth calling out explicitly.** The old model's
`studio/tools/check-*.mjs` validators hard-failed CI on a malformed
record — "failing the build on a malformed record" was the design. The new
model explicitly reverses that: reindex validation **surfaces warnings,
never hard-fails** (Part 3 ruling I — "hard CI gates were right for the old
monorepo, wrong for a product"). `skillmaker reindex` is always safe to
re-run; a bundle with a broken fixture or an unbanded risk id still
reindexes, it just shows up in the warnings list, grouped by bundle.

Also a direct scope change: this is not a pass/fail lint pass over a
workflow graph (there is no graph, per data-model.md §1.1) — it's a full
index rebuild (files + journal → SQLite materialized views) that happens to
also validate as it scans, not a standalone check step. Merge target:
`Capability - Lint` from `authoring/` (owned by another worker's
assignment, cited here as the merge source only) — the mechanical-contract
check idea survives here as validation-during-reindex, not as a separate
lint invocation, and Protocol E's brief↔workflow parity check specifically
has no analog (superseded by the drift hint in `outputs/`, which is
deliberately unenforced).

## HOW
`skillmaker reindex` (`packages/cli/src/commands/Reindex.ts`) calls
`IndexService.rebuild()`, then `listWarnings()` to re-fetch the persisted,
bundle-tagged warning rows. Every warning is a `WarningRecord { bundle?,
source, message }`, persisted in the `events`-adjacent index tables so it
stays queryable after the rebuild that produced it, not just printed once
and discarded.

What gets checked, all warning-only: `scanFixtures`
(`packages/core/src/Fixtures.ts`) — missing `case.json`, malformed JSON,
non-object JSON, missing `case`/`class` fields, mismatched directory name,
unknown `class`, unbanded risk-family prefixes, legacy `prompt` field,
missing `prompt.md`, missing `grading.answerKey` target; `parseRiskMap`
(`packages/core/src/RiskMap.ts`) — missing/malformed table, unbanded risk
ids, unparseable coverage cells; `checkCoverage` — a risk-map row's
`Fixture` cell pointing at a case that doesn't exist. Operates on
[[Entity - Risk Map]] and [[Entity - Fixture]] data specifically within the
evals surface (also scans `bundle.json` and the journal, out of this
card's scope).

Verified: `packages/cli/src/commands/Reindex.ts` (header comment: "never
hard-fails on malformed input ... it surfaces warnings"; `runReindex`
always returns `ok`/`expectedFailure` on I/O errors only, not on scan
warnings) and `packages/core/src/IndexService.ts`'s `WarningRecord`
interface and doc comment ("Part 3 ruling I: warnings, never hard fails").
