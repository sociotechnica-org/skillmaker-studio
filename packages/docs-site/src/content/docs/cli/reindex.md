---
title: skillmaker reindex
description: Rebuild .skillmaker/studio.db from files + the journal.
---

```text
skillmaker reindex
```

Rebuilds `.skillmaker/studio.db` from scratch by scanning bundle files and
replaying the journal. SQLite holds nothing canonical — this is safe to run
at any time, and every other read command (`list`, `status`, `start`) runs
it automatically before reading, so you rarely need to call it directly.

Deleting `.skillmaker/studio.db` and running `reindex` reproduces the
identical index every time — this is the proof that the database is truly
disposable.

## Options

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON instead of text |

## Output

```text
skillmaker: reindexed — 1 bundle(s), 4 event(s)
```

Fixture and risk-map problems (an unknown fixture class, an unbanded risk
id, a legacy `prompt` field in `case.json`) surface here as warnings, never
as a hard failure — see
[Fixtures and risk maps](/evals/fixtures-and-risk-maps/#reindex-warnings-not-hard-failures).

## See also

[The journal](/concepts/journal/) for the canonical-store model this
command proves.
