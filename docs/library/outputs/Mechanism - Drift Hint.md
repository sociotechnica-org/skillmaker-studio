---
type: Mechanism
prefLabel: Drift Hint
context: outputs
status: new
links:
  related_to:
    - "./Entity - Skill Version"
    - "./Entity - Bundle Output"
    - "./Mechanism - Publish"
    - "../authoring/Entity - Design Doc"
---

## WHAT

A computed, displayed-only value comparing a bundle's *live*
`design.md`/`output/` content against its *latest recorded*
`skill.version_recorded` version: `no-version` / `in-sync` /
`design-changed` / `output-hand-edited` / `both`. It answers "has
anything moved since the last version was recorded, and on which side?"
— nothing more. It is a read, never a write: nothing in the shipped code
blocks an edit, refuses a save, or auto-recomputes anything because of a
drift value.

## WHY

This is the successor of `authoring/Mechanism/Mechanism - Sync Rule.md`
(source card lives in another worker's `authoring/` assignment — not
read or written here, just its disposition noted: RETIRE, superseded by
this card). This resolves hot-spot #4 in the prep doc (§3, "Derived-
rendering drift hazard... RESOLVED, by inversion"), and the resolution
is a genuine philosophy flip, not a rename, so it is stated explicitly
rather than implied:

The old Sync Rule **prevented** drift by construction — edits landed in
the Brief, a re-derive step regenerated the Workflow Package, and
`play-resync.py`'s "resync cone" (Protocol E) recomputed every stale
derived rendering so nothing could go out of sync in the first place.
The new model does the opposite: it **allows** hand-editing `output/`
directly and only **surfaces** drift after the fact. Deliberate
hand-finishing of `output/SKILL.md` is legitimate work, not a bug to be
resynced away — "the model records that and when, not that it's wrong"
(data-model.md §2.7). The blast radius of the old five-derived-rendering
problem also shrinks structurally: there is only one output artifact
class now (`output/`), not five (workflow.fabro, diagram.svg, story.md,
moves overlay, synopsis.md), so even the *surfacing* mechanism has far
less to watch.

## HOW

`computeDrift` in `packages/core/src/Versions.ts` takes the current live
hashes (`{designHash, outputHash}` from `computeBundleHashes`, which
hashes `design.md`'s content and the `output/` tree — see `Entity -
Skill Version`) and the latest recorded `SkillVersion`
(`{designHash, hash}` or `undefined`), and returns:

- `no-version` — no `skill.version_recorded` event exists yet for this
  bundle; there is nothing to compare against.
- `in-sync` — neither hash changed since the latest recorded version.
- `design-changed` — `design.md` changed, `output/` did not.
- `output-hand-edited` — `output/` changed, `design.md` did not.
- `both` — both changed.

`bundles.drift` in the SQLite index (`packages/core/src/Versions.ts`
callers / `packages/core/src/Index*.ts` materialization; data-model.md
§2.11) is this computed value, rebuilt by `skillmaker reindex`, never
stored as a journal fact. `Mechanism - Publish`'s guard requires exactly
`in-sync` before a bundle can ship.

Verified: `computeDrift`'s implementation and its doc comment in
`packages/core/src/Versions.ts` (`export type Drift = "no-version" |
"in-sync" | "design-changed" | "output-hand-edited" | "both"`). This is
a real, called-out deviation from data-model.md §2.7, which only lists
four drift states — the code comment explains the fifth
(`"no-version"`) explicitly: collapsing a never-versioned bundle into
`in-sync` (a hollow comparison against nothing) or `both` (implying
change from a baseline that never existed) would both be dishonest, so
`no-version` was added as a distinct, deliberate state rather than
force-fit into the doc's four.
