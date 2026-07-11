---
type: Reference
prefLabel: Measurements Bind To Version
context: evals
status: new
links:
  related_to:
    - "./Economy - Pass Rate"
    - "./Economy - Validation"
---

## WHAT
The law that a bundle's Pass Rate / Validation display resets to "not yet
measured" the moment its skill version changes — measurements are strictly
keyed by `{bundle, fixtureCase, versionHash, provider, model}`, and a new
`versionHash` starts an empty group. Nothing carries forward across a
version bump.

## WHY
Inherited law §1.6: "Measurements bind to a version (content hash) ×
provider × model." This is a deliberate honesty guarantee, not an
oversight: without it, a bundle could ship a behavior-changing edit to
`output/SKILL.md` and keep displaying a pass rate that was earned by the
*previous* version's behavior. Grouping strictly on the version hash makes
that impossible by construction — a stale figure simply has nowhere to
live once the hash it was keyed to stops being current.

## HOW
`packages/core/src/Measurements.ts`'s module comment states this
explicitly: "New version hash => empty measurements for that key, an
honest reset (law §1.6), not a stale carry-forward." `computeMeasurements`
enforces it structurally — `measurementKey` builds its group key from all
five of `bundle`, `fixtureCase`, `versionHash`, `provider`, and `model`
(`` `${bundle} ${fixtureCase} ${versionHash} ${provider} ${model}` ``), so
a `run` with a different `versionHash` can never land in the same
aggregation cell as one from an older version, however similar the fixture
and provider are otherwise. There is no fallback path that pools across
`versionHash` values.

The version hash itself is recorded via `skill.version_recorded`
(data-model.md §2.7) — a content hash over the sorted `(path,
file-sha256)` list under `output/`, so any hand-edit or drift changes it.
Once a new version is recorded (explicitly via `skillmaker version record`,
or implicitly before a run), every subsequent
[[Capability - Eval Run|eval run]] against that bundle carries the new
`skillVersionHash`, and
[[Economy - Pass Rate]] / [[Economy - Validation]] read as unmeasured for
that bundle/fixture/provider/model combination until fresh graded runs
accumulate against it.

Verified: `packages/core/src/Measurements.ts`'s top-of-file comment block
citing "law §1.6" and "honest reset ... not a stale carry-forward"
verbatim, and `measurementKey`'s five-field grouping key in the same file.
