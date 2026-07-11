---
title: Your first Skill Bundle
description: init → new → start, with real CLI output, end to end.
---

This walkthrough was run verbatim against the real CLI in a brand-new
directory while writing these docs. Follow along in your own scratch
directory.

## 1. Create a workspace

In any **fresh, empty git repository**:

```sh
mkdir my-skills && cd my-skills
git init
git config user.email "you@example.com"
git config user.name "Your Name"
skillmaker init
```

```text
skillmaker: initialized workspace at /path/to/my-skills
```

`init` is idempotent — running it again reports `already initialized` and
changes nothing. It creates:

```text
my-skills/
  skillmaker.config.json
  .skillmaker/
    events.jsonl
```

`skillmaker.config.json` is the tracked app config (skills directory, viewer
port, provider commands, publish targets). `.skillmaker/events.jsonl` is the
journal — the append-only, git-tracked history of every decision this
workspace ever records. There's no `skills/` directory yet; it's created
lazily by `skillmaker new`.

## 2. Create a Skill Bundle

```sh
skillmaker new my-first-skill
```

```text
skillmaker: created bundle my-first-skill
```

This scaffolds `skills/my-first-skill/`:

```text
skills/my-first-skill/
  bundle.json               # identity only — slug, name, tags, targets
  design.md                 # the skill's workflow thinking (skeleton)
  stations.json              # per-state work config, copied from the default template
  research/.gitkeep
  evals/
    risk-map.md               # coverage axis (empty table)
    fixtures/.gitkeep
  output/.gitkeep
  runs/.gitkeep
```

and appends one `bundle.created` event to the journal. Use `--name "My
Display Name"` if you want a display name other than the title-cased slug.

## 3. Check status

```sh
skillmaker list
```

```text
SLUG            STAGE  SUBSTATE
my-first-skill  idea   working
```

```sh
skillmaker status my-first-skill
```

```text
slug:        my-first-skill
name:        My First Skill
one-liner:
tags:
created:     2026-07-11
stage:       idea
substate:    working
archived:    false
events:      1
last event:  bundle.created at 2026-07-11T10:34:04.034Z
design:      sha256:e5f822e6d599
output:      sha256:4f53cda18c2b
drift:       no-version
version:     (none recorded)
fixtures:    0
coverage:    0 covered, 0 partial, 0 gap
last run:    (none)
```

Both commands rebuild the SQLite index from the journal + files before
reading, so they're always consistent with what's on disk — delete
`.skillmaker/studio.db` at any time and the next `list`/`status`/`start`
rebuilds it from scratch with `reindex`'s output byte-identical.

## 4. Open the board

```sh
skillmaker start
```

This serves the board and its API on one origin (default port `4323`) and
opens your browser. You should see **My First Skill** as a card in the
`idea` column. Confirm the API is live from another terminal:

```sh
curl -s http://localhost:4323/api/bundles
```

```json
{"bundles":[{"slug":"my-first-skill","name":"My First Skill","oneLiner":"","tags":[],"created":"2026-07-11","stage":"idea","substate":"working","archived":false,"designHash":"sha256:e5f822e6d599...","outputHash":"sha256:4f53cda18c2b...","drift":"no-version"}],"fixtureCounts":{}}
```

If you run `skillmaker new another-skill` in a second terminal while the
board is open, watch it appear on the board without reloading — the viewer
holds an SSE connection over the journal file.

## What you have now

A real Skill Bundle, tracked in git the moment you commit `skills/` and
`.skillmaker/events.jsonl`. Next:

- [The Skill Bundle](/concepts/skill-bundle/) — what each file is for.
- [The production state machine](/concepts/state-machine/) — how a bundle
  moves `idea → researching → drafting → evaluating → published`, and why
  `skillmaker advance my-first-skill` refuses to move it yet.
- [CLI Reference](/cli/) — every command and flag.
