---
title: skillmaker new
description: Create a new Skill Bundle under skills/<slug>/.
---

```text
skillmaker new <slug> [--name <name>]
```

Scaffolds a new Skill Bundle at `skills/<slug>/` and appends one
`bundle.created` event to the journal. Requires an initialized workspace
([`skillmaker init`](/cli/init/) first).

## Options

| Flag | Meaning |
|---|---|
| `--name <name>` | Display name for the bundle; defaults to a title-cased version of `<slug>` |
| `--json` | Emit machine-readable JSON instead of text |

`<slug>` must be kebab-case; it becomes the bundle's directory name and is
immutable — it's the key every fixture, run, and journal event refers back
to.

## What it creates

```text
skills/<slug>/
  bundle.json
  design.md
  stations.json
  research/.gitkeep
  evals/
    risk-map.md
    fixtures/.gitkeep
  output/.gitkeep
  runs/.gitkeep
```

## Output

```text
skillmaker: created bundle my-first-skill
```

## Example

```sh
skillmaker new frame-the-problem --name "Frame the Problem"
```

## See also

[The Skill Bundle](/concepts/skill-bundle/) documents every file this
scaffolds.
