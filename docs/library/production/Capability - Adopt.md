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

**The registry/paperwork tripwire** (issue #92, `../outputs/Mechanism -
Receiving Dock` §HOW: "the registry is the only true witness"): plain
`adopt` now hash- and name-checks every candidate against the registry
(`Receive.ts`'s `classifyIntakeEvidence`, reusing the dock's own
`deriveIntakeVerdict` precedence) before adopting it. A candidate the
registry can prove is an arrival — its computed hash matches a recorded
version, or its claimed name collides with an existing bundle's slug/name,
or it carries a foreign `.skillmaker-adopt.json` marker with no
`bundle.json` of its own — is **challenged**: listed in the report's
`challenged` array (never adopted, never written to disk), with a CLI
message suggesting `skillmaker receive` or `adopt --triage`. Evidence
surfaced, human decides, never enforced — the same law the dock itself
follows.

**The triage manifest — bulk import as the same elicitation tree** (issue
#92): `adopt --triage [path]` acts on nothing. It runs the identical
discovery sweep (`Adopt.ts`'s `walk`, shared rather than duplicated) plus
the tripwire above, and writes `adopt-manifest.md` at the workspace root —
a markdown table (`Triage.ts`'s `renderManifest`/`parseManifest`, a house
pattern mirrored from `RiskMap.ts`'s tolerant table round-trip), one row
per not-yet-adopted candidate — thirteen columns since issue #108 retired
the maturity self-grade and made the manifest the card's batch form.
Machine columns are automated: name, path, mechanical condition (SKILL.md
parses / frontmatter complete / has evals — the OS&D clipboard) and
registry evidence. Human columns default per the ruling — deferral, never
a false fact: `decision` (keep), `whose` (`mine` for a bare candidate;
`receive` for an evidence-bearing one — the tripwire applied to defaults
too), `rights`/`stakes`/`hurts`/`priority` blank, and the card fields
`Job`/`Out-of-scope`/`Basis` blank (free text; blank = not asked = an
honest gap in the dossier these answers seed). There is no Maturity
column and no entry-stage question anywhere in the table. The maker edits
the human columns by hand, in their own editor, on purpose (no agentic
pre-fill).

`adopt --from-manifest [file]` (default `adopt-manifest.md` at the
workspace root) executes every row as an **individual act**
(`Triage.ts`'s `executeManifest`/`executeManifestRow`, no re-run of the
tripwire — a human has already seen the evidence and decided): `keep` +
`mine` adopts exactly like plain adopt (`adoptDirectoryInPlace` — the one
per-directory write path `adoptWorkspace`'s sweep and `Route.ts`'s
`new`/`fork` dispositions also use, issues #91/#92), entering at the
stage the directory's observable condition derives — never a stage the
human was asked for (`deriveEntryStage`, issue #108: a `SKILL.md` that
parses with a complete identity → `evaluating`; parses but incomplete →
`drafting`; otherwise `idea`), recorded when past idea via
`bundle.stage_changed` with reason `"triage: entry stage derived from
runnable output"` and NO `override` — the system's own placement at
birth, not a human overriding the guard; the row's `Job`/`Out-of-scope`/
`Basis` answers seed the freshly scaffolded dossier;
`keep` + anything else (`outside`/`came-back`/`unknown`/`receive`) routes
through `skillmaker receive`'s exact engine for that one directory
(`receiveCrate`); `archive` adopts then appends `bundle.archived`
regardless of `whose`; `skip` leaves the directory untouched. A non-empty
`hurts` mints a todo (`kind: "intake"`, extending `TodoOrigin` — see
`../board/Entity - Todo`) whose `bundle` is set only when identity was
actually granted. Idempotent: a row whose directory already holds
`bundle.json` is skipped, not re-adopted; a row pointing at a vanished
directory errors honestly without stopping the rest. The summary reports
every row — adopted, received, archived, skipped, or errored — no silent
truncation.

Verified: `packages/core/src/Adopt.ts` (in-place layout, marker, skip
rules, idempotent discovery, AUTO-GENERATED filter, the shared
`adoptDirectoryInPlace` write path, the registry tripwire's `challenged`
list) and
`packages/cli/src/commands/Adopt.ts` (workspace precondition,
`bundle.created` + `skill.version_recorded` journal events,
deprecated-path archival, `--triage`/`--from-manifest` dispatch). The
triage manifest itself lives in `packages/core/src/Triage.ts`
(`triageWorkspace`, `renderManifest`/`parseManifest`,
`executeManifest`/`executeManifestRow`), covered by
`packages/core/test/Triage.test.ts`,
`packages/core/test/Adopt.test.ts`'s tripwire suite, and
`test/e2e/adopt-triage.e2e.test.ts`'s mixed-directory scenario.
