---
title: skillmaker status
description: Show one Skill Bundle's identity, state, and event history.
---

```text
skillmaker status <slug>
```

Rebuilds the SQLite index, then prints one bundle's full known state: its
identity, its production stage/substate, file hashes, drift, the latest
recorded version, fixture/coverage counts, and its most recent journal
event.

## Options

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON instead of text |

## Output

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

## See also

- [The journal](/concepts/journal/) — why this is always a fresh replay,
  never stale state.
- [Versions and drift](/concepts/versions-and-drift/) — what `drift` means.
