---
type: Mechanism
prefLabel: Provenance Stamp
context: outputs
status: new
links:
  conforms_to:
    - "./Mechanism - Publish"
  related_to:
    - "./Reference - Publish Target"
    - "./Entity - Skill Version"
    - "../evals/Economy - Validation"
    - "../_index/Vision - The Skill Is the Product"
---

## WHAT

**In flight (PR #185, unmerged) — director rulings 2026-08-03.** Every
installed copy of a published skill carries an honesty stamp: an HTML
comment atop `SKILL.md` (below YAML frontmatter when present) naming the
bundle, version hash, publish date, and an **evidence line** — e.g.
"3 of 23 claims measured" — derived from the same claim/fixture/
measurement join the viewer's Evals tree uses, never restated by hand.
The same evidence rides the `skill.published` journal event as an
additive `evidence` field. Publishing goes to exactly **two audiences**:
all my agents (`user` → `~/.claude/skills/<slug>/`) or this project's
agents (`project` → `<workspace>/.claude/skills/<slug>/`), remembered
per-bundle in `bundle.json` as symbolic words that resolve locally on
whatever machine the bundle lands on.

## WHY

The E2E walk hit "Publish step has no UI" as a blocker
(`docs/friction/e2e-readiness.md`); the two-audience ruling keeps the
door minimal — no path pickers, no cross-project publishing — while the
stamp extends graded-read-out honesty past the workspace boundary: the
consumer of an installed skill sees what evidence backed it at publish
time. This is the embryo of the **slab** — Danvers's trust play from the
2026-08-03 catch-up ("a Skill Maker baseball card … like whether a
collectible is slabbed … you know what it is, it hasn't been tampered
with"; `docs/sources/2026-08-03-danvers-catchup-product-notes.md`): a
tamper-evident provenance mark that a hosted distribution story could
grow into (scorecards over popular skill repos was the attached campaign
idea). The stamp also makes **installed drift** computable: hash the
installed copy with the stamp stripped, compare against the
last-published version → `not-installed` / `in-sync` / `installed-edited`.

## HOW

Per PR #185 (treat all of this as in flight until merged): one core
function (`InstallPublish`) behind three doors — CLI (`skillmaker publish
<slug> --to user|project`, `--version <hash>` for snapshot revert),
server (`POST .../publish`), UI (the Publish tab's audience buttons).
Honesty rules: journal only real acts (a same-content re-publish writes
and journals nothing; a revert that re-lands old bytes journals with a
fresh idempotency component); adopted in-place bundles publish to their
own live directory and get **no stamp** (stamping would immediately
register as hand-edit drift — deliberate deviation flagged for a
director ruling); the stamp sits below frontmatter because harness skill
loaders require frontmatter first.

Verified: nothing here is asserted as merged — scope, stamp format,
audience table, and deviations are from PR #185's description
(`gh pr view 185`, open as of 2026-08-03); the ruling context from
`docs/friction/e2e-readiness.md` and the slab framing from
`docs/sources/2026-08-03-danvers-catchup-product-notes.md`. Re-verify
against `packages/core/src/InstallPublish.ts` once the PR lands.
