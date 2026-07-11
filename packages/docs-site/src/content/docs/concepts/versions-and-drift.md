---
title: Versions and drift
description: SKILL.md tracked as a real output with provenance, without enforcement.
---

`output/SKILL.md` (and any sibling resources under `output/`) is tracked as
a real output with provenance — versioned and compared against its source,
but never blocked from diverging. Hand-finishing an output after it's
generated is legitimate; the model records *that* it happened and *when*,
not that it's wrong.

## Recording a version

A version is a content hash of the whole `output/` tree — sha256 over the
sorted `(path, file-sha256)` list — recorded explicitly:

```sh
skillmaker version record my-first-skill --label v0.1
```

```text
skillmaker: recorded version sha256:4f66bb815c24 "v0.1" for my-first-skill
```

This appends a `skill.version_recorded` event carrying the output hash, the
`design.md` hash at record time (used for the drift comparison below), and
the optional human `--label`. Recording is idempotent on content: recording
the exact same output+design content twice is a no-op; recording the same
content under a *different* label is reported as a conflict rather than
silently overwriting the earlier label.

There is no version file anywhere in the bundle — the only record is the
journal event; `skillmaker status` and the bundle-detail viewer tab both
read the latest one.

## Drift

Drift compares the **live** `design.md` and `output/` hashes against the
**latest recorded version**'s hashes, on every read — nothing is stored,
nothing goes stale:

| Drift state | Meaning |
|---|---|
| `no-version` | No version has ever been recorded for this bundle |
| `in-sync` | Live `design.md` and `output/` both match the latest recorded version |
| `design-changed` | `design.md` has changed since the last recorded version; `output/` hasn't |
| `output-hand-edited` | `output/` has changed since the last recorded version; `design.md` hasn't |
| `both` | Both have changed |

For example, right after recording a version, `skillmaker status` reads
`in-sync`:

```text
drift:       in-sync
version:     sha256:4f66bb815c24 "v0.1" at 2026-07-11T10:38:09.622Z
```

Editing `design.md` (without touching `output/` or recording a new
version) flips it:

```text
drift:       design-changed
version:     sha256:4f66bb815c24 "v0.1" at 2026-07-11T10:38:09.622Z
```

Drift is **displayed, never enforced** — nothing blocks you from advancing
a bundle or running an eval while drifted. It's an honesty signal, not a
gate.

## Why versions matter for evals

Every eval run pins a `skillVersionHash` — a version is the join key
between "what the skill actually was" and "how it measured." Recording a
new version resets displayed validation for that version to "not yet
measured" by construction, because [coverage and validation are separate
facts](/evals/coverage-vs-validation/) that never get pooled across
versions.
