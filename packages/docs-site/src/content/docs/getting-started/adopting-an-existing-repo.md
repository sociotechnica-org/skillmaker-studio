---
title: Adopting an existing repo
description: Bring an existing SKILL.md repo into the studio in place, with real CLI output.
---

If you already have a repo full of `SKILL.md` files — most skill authors
do, long before they hear of Skillmaker Studio — `skillmaker adopt` wraps
them as Skill Bundles **in place**. Nothing moves. This walkthrough was run
verbatim against the real CLI in a scratch directory while writing these
docs; follow along in your own scratch copy of a real skills repo.

## 1. Initialize a workspace over the existing repo

`adopt` runs on top of a workspace — it does not create one:

```sh
cd my-existing-skills-repo
skillmaker init
```

```text
skillmaker: initialized workspace at /path/to/my-existing-skills-repo
```

This is the same `init` as [Your first Skill Bundle](/getting-started/first-bundle/)
— it only writes `skillmaker.config.json` and `.skillmaker/events.jsonl`.
Your existing `SKILL.md` files are untouched.

## 2. Adopt

```sh
skillmaker adopt
```

Real output, adopting two pre-existing skills — one under a `deprecated/`
directory:

```text
skillmaker: adopt -- found 2 SKILL.md file(s), adopted 2, skipped 0 (already adopted)
adopted:
  + old-thing <- existing-skills/deprecated/old-thing [archived]
      warning: adopted from a "deprecated/" directory
  + frobnicate-widgets <- existing-skills/frobnicate-widgets
```

For each `SKILL.md` found, `adopt` writes a `bundle.json` next to it (no
file moves), journals `bundle.created`, and computes an initial version
from the bundle's hashed `design`/`output` (journaled as
`skill.version_recorded`, labeled `"adopted"`) — so every adopted skill
starts with a real, hashed version, not "unversioned."

`adopt` reads your repo's existing layout conventions rather than
demanding a new one: a skill under a `deprecated/` directory is adopted
already archived; a skill under an `in-progress/` directory is adopted at
stage `idea`. Nonstandard frontmatter fields your repo already uses
(version, triggers, allowed-tools, whatever your convention is) are
preserved, not stripped.

## 3. Confirm nothing was double-imported

`adopt` is idempotent — re-running it finds the same files and skips them:

```sh
skillmaker adopt
```

```text
skillmaker: adopt -- found 2 SKILL.md file(s), adopted 0, skipped 2 (already adopted)
skipped (already adopted):
  - existing-skills/deprecated/old-thing
  - existing-skills/frobnicate-widgets
```

## 4. Check what you have

```sh
skillmaker list
```

```text
SLUG                STAGE  SUBSTATE
frobnicate-widgets  idea   working
old-thing           idea   working (archived)
```

```sh
skillmaker status frobnicate-widgets
```

```text
slug:        frobnicate-widgets
name:        frobnicate-widgets
one-liner:   Frobnicates widgets given a widget spec.
tags:
created:     2026-07-11
stage:       idea
substate:    working
archived:    false
events:      2
last event:  skill.version_recorded at 2026-07-11T14:33:44.213Z
design:      sha256:e3b0c44298fc
output:      sha256:8366425509d0
drift:       in-sync
version:     sha256:8366425509d0 "adopted" at 2026-07-11T14:33:44.213Z
fixtures:    0
coverage:    0 covered, 0 partial, 0 gap
last run:    (none)
```

An adopted bundle is a bundle like any other from here — it can go through
[the production state machine](/concepts/state-machine/), pick up
fixtures, get published, and appear in [the skillbook](/concepts/publishing-and-the-skillbook/)
exactly like a skill built from scratch in the studio.

## Real-world numbers

`adopt` was QA'd against two real, cloned skills repos while it was built,
not just the scratch example above:

- **[gstack](https://github.com/gstack)**: 60 `SKILL.md` files found, 59
  adopted; 54 flagged as generated; one symlinked skill deduped with a
  tolerated warning; nonstandard frontmatter (`version`, `triggers`,
  `allowed-tools`, `preamble-tier`) preserved untouched.
- **[mattpocock/skills](https://github.com/mattpocock/skills)**: 39/39
  adopted; 4 archived via `deprecated/`, 7 landed at `idea` via
  `in-progress/`; the repo's `plugin.json` manifest was detected and
  reported, not touched.

A real bug was found and fixed against gstack during this QA: gstack puts
`AUTO-GENERATED` comments *before* the YAML frontmatter in some files,
which the original parser didn't expect — `adopt`'s frontmatter parser now
strips a leading comment before parsing, covered by a unit test and an
end-to-end fixture built from the real file shape.

## Known limitation

Publish's layout-awareness for adopted bundles — respecting the original
repo's directory conventions on the way *out*, symmetric with how `adopt`
reads them on the way in — is flagged as follow-up work, not yet built.

## See also

- [`skillmaker adopt`](/cli/adopt/) — every flag and the full output
  contract, including `--json`.
- [The Skill Bundle](/concepts/skill-bundle/) — what an adopted bundle
  looks like once it's in the studio.
- [Your first Skill Bundle](/getting-started/first-bundle/) — the
  from-scratch path, if you don't have an existing repo yet.
