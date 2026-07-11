---
title: skillmaker adopt
description: Import pre-existing SKILL.md files as in-place Skill Bundles.
---

```text
skillmaker adopt [path] [--source <url-or-path>] [--ref <ref>]
```

Imports pre-existing `SKILL.md` files — from a skills repo you didn't build
in Skillmaker Studio — as Skill Bundles, **in place**. `adopt` runs on top
of a workspace; it does not create one (`skillmaker init` first). It
discovers every `SKILL.md` under `path` (default: the current directory),
and wraps each one as a bundle without moving any files: `bundle.json` and
the journal's `bundle.created` event get written, but the skill's directory
stays exactly where it was.

This is the strategic front door for the "adopt-first" thesis: most skill
authors already have a repo full of `SKILL.md` files before they ever hear
of Skillmaker Studio, and the studio should meet that repo where it is
rather than demanding a rewrite.

## What it does

- Discovers `SKILL.md` files under `path` and, for each one not already
  adopted, writes a `bundle.json` next to it (identity only — see
  [The Skill Bundle](/concepts/skill-bundle/)) and journals `bundle.created`.
- **Layout-aware pathname mapping**, applied by convention rather than
  configuration: a skill under a `deprecated/` directory is adopted
  archived (`bundle.archived` follows `bundle.created`); a skill under an
  `in-progress/` directory is adopted at stage `idea`.
- Computes an initial version from the bundle's hashed `design`/`output`
  and journals `skill.version_recorded` with label `"adopted"`, so every
  adopted skill starts with a real, hashed version — never "unversioned."
- Preserves nonstandard frontmatter fields it doesn't recognize (version,
  triggers, allowed-tools, and other conventions your repo already uses)
  rather than stripping them.
- Detects (but does not import) manifest files (e.g. `plugin.json`) and
  existing eval/test infrastructure — these are reported, not touched.
- **Idempotent**: re-running skips skills already adopted (`skipped`,
  reason `already-adopted`); nothing is double-imported or overwritten.

## Options

| Flag | Meaning |
|---|---|
| `path` | Directory to scan for `SKILL.md` files. Defaults to the current directory. |
| `--source <url-or-path>` | Upstream repo/path this batch was imported from; recorded on each adopted skill's marker |
| `--ref <ref>` | Ref/tag/commit alongside `--source`; ignored without `--source` |
| `--json` | Emit a structured report instead of text |

### `--source` / `--ref` (upstream provenance)

`adopt`'s whole pitch is receipts, so the batch's origin is one too: pass
`--source` (a repo URL or local path) and optionally `--ref` (a tag,
branch, or commit) and every skill adopted **in that batch** records where
it came from — persisted on the bundle's adopt marker and echoed by
`--json` as `upstream: {source, ref}`. Omit it and adoption works exactly
as before (no provenance recorded); this is opt-in, not required.

```sh
skillmaker adopt existing-skills/ --source https://github.com/mattpocock/skills --ref 391a270
```

```text
skillmaker: adopt -- found 2 SKILL.md file(s), adopted 2, skipped 0 (already adopted)
upstream:    https://github.com/mattpocock/skills @ 391a270
adopted:
  + code-review <- existing-skills/code-review
  + house-style <- existing-skills/house-style
```

This is provenance at adopt time, not a live drift-vs-upstream check —
"has the source repo changed since I adopted?" (`skillmaker upstream diff`
or similar) is tracked as future work; see the [Roadmap](/roadmap/).

## Output

Real output adopting two skills, one archived from a `deprecated/` path:

```text
skillmaker: adopt -- found 2 SKILL.md file(s), adopted 2, skipped 0 (already adopted)
adopted:
  + old-thing <- existing-skills/deprecated/old-thing [archived]
      warning: adopted from a "deprecated/" directory
  + frobnicate-widgets <- existing-skills/frobnicate-widgets
```

Re-running is a no-op:

```text
skillmaker: adopt -- found 2 SKILL.md file(s), adopted 0, skipped 2 (already adopted)
skipped (already adopted):
  - existing-skills/deprecated/old-thing
  - existing-skills/frobnicate-widgets
```

`--json` on the re-run:

```json
{"found":2,"adopted":[],"skipped":[{"relativePath":"existing-skills/deprecated/old-thing","reason":"already-adopted"},{"relativePath":"existing-skills/frobnicate-widgets","reason":"already-adopted"}],"warnings":[],"manifests":[],"evalInfra":[]}
```

An adopted bundle looks like any other bundle afterward —
`skillmaker status frobnicate-widgets` reports stage `idea`, a real version
hash, and a `skill.version_recorded` event labeled `"adopted"` as its last
event.

## Known limitation

Publish's layout-awareness for adopted bundles (respecting the original
repo's directory conventions on the way *out*, not just on the way in) is
flagged as follow-up work — today the production-state guard on `publish`
(bundle must reach `published`) blocks it from being reachable regardless.

## See also

[Adopting an existing repo](/getting-started/adopting-an-existing-repo/) —
a full walkthrough with real output against a scratch repo, plus real
numbers from adopting two real-world skills repos.
