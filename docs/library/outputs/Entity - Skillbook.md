---
type: Entity
prefLabel: Skillbook
context: outputs
status: new
links:
  contains:
    - "./Entity - Bundle Output"
    - "./Entity - Skill Version"
  related_to:
    - "../authoring/Entity - Design Doc"
    - "../evals/Economy - Coverage"
    - "../runs/Entity - Run"
---

## WHAT

The Skillbook is a workspace-level, auto-generated documentation
artifact for the whole skill set — one altitude up from a single
bundle's `output/` but "same artifact class... one level up"
(data-model.md §2.14). For every bundle it assembles: a per-skill
chapter (from `design.md`), measurement receipts (pass rates × n × CI
per provider/model, pinned to a version hash), and a changelog replayed
from the journal (versions recorded, publishes, gate decisions). One
generator produces it, rendered two ways: a live viewer tab (always
current) and `skillmaker book build` (a static HTML site). The viewer
tab is the **Port** (was the Skillbook tab, #64) — the Skillbook itself
survives as the per-bundle chapter it renders, "the paperwork that ships
with a skill," not the surface's name.

## WHY

This is the NEW-HOME/MERGE target for `authoring/Reference/Reference -
Synopsis.md` (source card lives in another worker's `authoring/`
assignment — not read or written here, only its disposition noted:
NEW-HOME into this card). The old model's per-play "What it does / Reach
for it when / The story / Trigger" synopsis was a separately hand-authored
`synopsis.md` file. In the new model that per-skill chapter is not
authored at all — it is generated straight from `design.md`'s `##
Intent` and `## When to use / triggers` sections at render time. This
resolves prep-doc open question 7 directly: **no separate hand-authored
marketing blurb is written going forward.** The Skillbook's chapter is
the design doc's own content, reflowed for a reader, not a second
document a human keeps in sync by hand — so there is nothing to drift.
The receipts half is new outright: "coverage gaps shown as honestly as
passes [inherited: two-axis rule, now public-facing]" (data-model.md
§2.14) — the old model never projected coverage/validation data at the
workspace level at all.

## HOW

Shared data-aggregation entry point: `buildSkillbook` /
`loadSkillbook` in `packages/cli/src/Skillbook.ts`. For each bundle it:
rebuilds the SQLite index, reads `design.md` raw (`designMarkdown`,
empty string if absent — no fallback prose is invented), pulls
`listVersions`/`listMeasurements` from the index, and walks the journal
filtered to that bundle's events to build a `changelog` (`version` from
`skill.version_recorded`, `published` from `skill.published`, `gate`
from `bundle.gate_decided`), sorted newest-first.

Two render doors share this one aggregation:

- Live: the server's `GET /api/skillbook` endpoint (untouched, #64 is
  display-layer only), rendered by the viewer's Port tab
  (`packages/viewer/src/app/components/Port.tsx`'s `Port` component for
  the index and `SkillbookBundlePage` for the per-bundle chapter,
  `useSkillbook.ts`) — always current because it re-reads the index and
  journal on request.
- Static: `skillmaker book build [--out <dir>]`
  (`packages/cli/src/commands/BookBuild.ts`) calls the exact same
  `loadSkillbook`, then `renderSkillbookSite`
  (`packages/cli/src/BookRenderer.ts`) writes `index.html` (one link per
  bundle) plus one HTML page per bundle, defaulting to
  `.skillmaker/skillbook/` (a build artifact under the runtime dir, not
  git-tracked).

Verified: `packages/cli/src/commands/BookBuild.ts` exists and does
exactly this — its own header comment states "Uses the SAME
`loadSkillbook` data-aggregation the server's `GET /api/skillbook`
uses... one generator over existing facts, rendered two ways." Also
verified `packages/cli/src/Skillbook.ts`'s `SkillbookBundle` type
(`designMarkdown`, `latestVersion`, `measurements`, `changelog`) — the
per-skill chapter data is literally `design.md`'s raw markdown, not any
separately-authored summary field; confirms open question 7's answer is
already the shipped behavior.
