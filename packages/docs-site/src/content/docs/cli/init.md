---
title: skillmaker init
description: Initialize a skillmaker workspace in the current directory.
---

```text
skillmaker init
```

Initializes a skillmaker workspace at the current directory (which must be
a git repository). Idempotent — running it again reports
`already_initialized` and changes nothing.

## What it creates

```text
skillmaker.config.json     # tracked app config
.skillmaker/
  events.jsonl               # the journal (empty)
```

It also ensures the required `.gitignore` entries (`.skillmaker/*` except
`events.jsonl`) and `.gitattributes` entry
(`.skillmaker/events.jsonl merge=union`) are present, adding them only if
missing.

## Options

| Flag | Meaning |
|---|---|
| `--json` | Emit `{status, root, gitignoreChanged, gitattributesChanged}` instead of text |

## Output

```text
skillmaker: initialized workspace at /path/to/workspace
```

or, on a second run:

```text
skillmaker: already initialized at /path/to/workspace
```

## See also

[Your first Skill Bundle](/getting-started/first-bundle/) walks this
command end to end with real output.
