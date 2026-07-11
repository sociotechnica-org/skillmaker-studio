---
type: Capability
prefLabel: Adopt
context: production
status: new
links:
  operates_on:
    - "./Entity - Skill Bundle"
  related_to:
    - "../outputs/Entity - Skill Version"
    - "../runs/Entity - Journal"
---

## WHAT

Brownfield import: `skillmaker adopt [path]` discovers pre-existing
`SKILL.md` files anywhere under a workspace root and wraps each containing
directory **as a bundle, in place** — no files are moved. The studio "runs
on top, doesn't take over": adoption adds a `bundle.json` plus a
`.skillmaker-adopt.json` marker to the discovered directory and leaves the
rest of the repo's layout untouched.

## WHY

Greenfield bundles are born via `skillmaker new` inside `skills/`, but most
real skill collections predate the studio. Adopt gives an existing skills
repo the full studio apparatus (journal, versions, evals, board) without a
migration — the shipped answer to strategy-skills-repo-mode.md §3B and
plan.md Phase 16. There is no old-library analog: the predecessor studio
had no import path at all; a play existed only if the studio created it.

## HOW

`skillmaker adopt [path]` (CLI: `packages/cli/src/commands/Adopt.ts`;
engine: `packages/core/src/Adopt.ts`, `adoptWorkspace`). Requires an
existing workspace (`skillmaker init` first). Discovery walks the tree
skipping `node_modules`/`.git`/`dist`/`.skillmaker`, skips any directory
that already has a `bundle.json` (idempotent by construction — re-runs only
pick up newly appeared skills), and skips `SKILL.md` files bearing an
`AUTO-GENERATED` marker (compiler output, not hand-authored). Frontmatter
is parsed permissively and unknown keys are preserved.

An adopted bundle has layout `"in-place"`: its "output" is the discovered
directory's own contents minus the studio-owned files adoption adds
(`bundle.json`, the marker, `design.md`, `research/`, `evals/`, `runs/`) —
[[../outputs/Entity - Skill Version|version hashing]] (`Versions.ts`)
applies exactly that exclusion set for marker-bearing bundles, and
`IndexService.ts` scans for marker-bearing directories anywhere in the
workspace, not just under `config.skillsDir`.

The CLI layers journal writes on top of the filesystem work: one
`bundle.created` per adopted skill (plus `bundle.archived` for skills under
a `deprecated/` pathname) and an initial `skill.version_recorded`, exactly
mirroring how `new` and `version record` behave for greenfield bundles.

Verified: `packages/core/src/Adopt.ts` (in-place layout, marker, skip
rules, idempotent discovery, AUTO-GENERATED filter) and
`packages/cli/src/commands/Adopt.ts` (workspace precondition,
`bundle.created` + `skill.version_recorded` journal events,
deprecated-path archival).
