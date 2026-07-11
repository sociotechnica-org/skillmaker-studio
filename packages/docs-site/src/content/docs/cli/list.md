---
title: skillmaker list
description: List Skill Bundles by stage/substate.
---

```text
skillmaker list
```

Rebuilds the SQLite index from files + the journal, then lists every
non-archived bundle with its current stage and substate.

## Options

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON instead of a table |

## Output

```text
SLUG            STAGE  SUBSTATE
my-first-skill  idea   working
```

## See also

[`skillmaker status`](/cli/status/) for one bundle's full detail.
