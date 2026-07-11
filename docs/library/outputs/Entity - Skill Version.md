---
type: Entity
prefLabel: Skill Version
context: outputs
status: new
links:
  related_to:
    - "./Entity - Bundle Output"
    - "./Mechanism - Drift Hint"
    - "./Mechanism - Publish"
    - "../authoring/Entity - Design Doc"
    - "../runs/Entity - Run"
---

## WHAT

A recorded, content-addressed snapshot of a bundle's `output/` tree:
`skillVersionHash` = a sha256 hash over the sorted `(relative-path,
file-sha256)` list of every file under `output/` (excluding
`.gitkeep`). Recording one appends a `skill.version_recorded` journal
event (`{bundle, hash, designHash, label?}`) — there is no version file
stored in the bundle itself; a version is purely a fact in the journal,
folded (`latest + all`, chronological) at read/index time.

## WHY

The old model had no output-versioning concept at all — a play was just
"banked" or not, a binary flag. The new model needs something finer:
runs and measurements must bind to a specific, immutable snapshot of
`output/` (data-model.md §1.1 inherited law 6: "Measurements bind to a
version (content hash) × provider × model"), so a pass rate measured
today can't silently get reattributed to a different SKILL.md tomorrow.
Recording the version's `designHash` alongside its `hash` at the same
moment is what makes the drift hint possible later — the drift hint has
nothing to compare the *live* `design.md`/`output/` state against
without a recorded baseline (see `Mechanism - Drift Hint`).

## HOW

`skillmaker version record` (or implicitly before a run) computes:

```jsonc
// journal event
{ "type": "skill.version_recorded",
  "payload": {
    "bundle": "frame-the-problem",
    "hash": "sha256:ab12…",       // content hash of output/
    "designHash": "sha256:cd34…", // design.md's hash at record time
    "label": "v0.3"                // optional human tag
  } }
```

Hashing lives in one shared function, `computeBundleHashes` in
`packages/core/src/Versions.ts`, called by both the CLI's `version
record` command and the server's `POST
/api/bundles/:slug/record-version` — "hashing logic lives in exactly one
place." `hashOutputTree` sha256's the sorted `(path, file-sha256)` pair
list under `output/`; `hashDesign` sha256's `design.md`'s raw content
(empty string if the file is missing). Versions are folded from the
journal by `foldSkillVersions` into a `Map<bundle, SkillVersion[]>` in
append order, so `latestSkillVersion` is just the list's last element.
`Run.json`'s `skillVersionHash` field (data-model.md §2.8) pins every
run to one of these recorded hashes, and `Publish.ts`'s guard (see
`Mechanism - Publish`) requires the *latest* recorded version to be
in-sync with the live tree before publishing is allowed.

Verified: `packages/core/src/Versions.ts` — `hashOutputTree`,
`hashDesign`, `computeBundleHashes`, `foldSkillVersions`, and
`latestSkillVersion` all present and match this description exactly;
`hashOutputTree`'s docstring confirms `.gitkeep` exclusion and
deterministic (sorted, forward-slash-normalized) hashing, and the module
also supports an `"in-place"` bundle layout (adopted/brownfield bundles)
not mentioned in data-model.md §2.7 — a real extension beyond the doc,
noted rather than treated as ground truth.
