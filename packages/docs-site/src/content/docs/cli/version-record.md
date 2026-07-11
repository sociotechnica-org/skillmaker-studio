---
title: skillmaker version record
description: Record a version — hash design.md + output/, idempotent on content.
---

```text
skillmaker version record <slug> [--label <text>]
```

Computes the live `design.md` hash and the content hash of the whole
`output/` tree, and appends a `skill.version_recorded` event.

## Options

| Flag | Meaning |
|---|---|
| `--label <text>` | Human tag for the recorded version, e.g. `"v0.3"` |
| `--json` | Emit machine-readable JSON instead of text |

## Idempotency

Recording the exact same `design.md` + `output/` content twice is a no-op.
Recording the same content under a **different** label is reported as a
conflict (exit `1`) rather than silently overwriting the earlier label:

```text
skillmaker version record: a version was already recorded for this exact
content ("my-first-skill", sha256:4f66bb815c24) under a different label --
content is unchanged, so no new version was recorded. ...
```

## Output

```text
skillmaker: recorded version sha256:4f66bb815c24 "v0.1" for my-first-skill
```

## See also

[Versions and drift](/concepts/versions-and-drift/) for what a version hash
means, how drift is computed from it, and why eval runs pin to one.
