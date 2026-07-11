---
title: The journal
description: Files + journal are canonical; SQLite is a rebuildable index.
---

Every fact in a Skillmaker workspace has exactly one canonical home:

| Home | What lives there | Mutability |
|---|---|---|
| **Files** (`skills/<slug>/`) | Content: research, design, fixtures, outputs, run transcripts + artifacts | Sources are editable; outputs are produced (and may be hand-finished); records are append-only |
| **Journal** (`.skillmaker/events.jsonl`) | State + decisions: stage changes, gate decisions, todos, versions | Append-only |
| **SQLite** (`.skillmaker/studio.db`) | Nothing canonical — materialized views + a search index | Fully rebuilt by `skillmaker reindex` |

There is no mutable state file anywhere in a workspace. The board you see
in the viewer — a bundle's stage, its substate, its todos — **is a journal
replay**. This is why deleting `studio.db` is always safe: the next
`list`, `status`, or `start` rebuilds it from files + the journal, and the
output is byte-identical to before the delete.

## The event envelope

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid",
  "type": "run.graded",
  "at": "2026-07-10T17:20:00Z",
  "actor": { "kind": "user", "name": "jess" },
  "idempotencyKey": "grade:01JZX8M2E9V0Q4:1",
  "payload": { /* type-specific */ }
}
```

Every append goes through the same pipeline, whether it originates from the
CLI or the viewer's server: validate the envelope → check idempotency (same
`idempotencyKey` + same payload is a no-op; same key + a *different*
payload is a conflict error) → append one line to `events.jsonl`. Nothing
ever writes to the journal freehand.

## What's journaled today

The event types your workspace can actually produce right now:

| Event | Fired by |
|---|---|
| `bundle.created` | `skillmaker new` |
| `bundle.stage_changed` | `skillmaker advance` (guarded — see [the state machine](/concepts/state-machine/)) |
| `review.requested` | `skillmaker review request` |
| `review.resolved` | the viewer's review panel (`approve` / `revise`) |
| `skill.version_recorded` | `skillmaker version record` |
| `todo.opened` / `todo.updated` / `todo.status_changed` | `skillmaker todo add/done/start/drop/reopen` and the viewer's todo panel |
| `run.started` / `run.completed` | `skillmaker run` |

File edits themselves are never journaled — git is their history, and
`reindex` scans the files directly. The journal stays thin: ids and
decisions, no fat content.

## Why it's git-tracked

`.skillmaker/events.jsonl` is checked into git alongside the rest of the
workspace, with a union merge driver so two branches' events combine rather
than conflict — the idempotency keys make that safe even if the same fact
gets appended on two branches independently. `.skillmaker/studio.db` and
`.skillmaker/local.json` are gitignored; only the journal (and, by default,
`runs/`) are tracked history.

## Rebuilding by hand

```sh
skillmaker reindex
```

rebuilds `.skillmaker/studio.db` from files + `.skillmaker/events.jsonl`
from scratch — the same rebuild that `list`, `status`, and `start` already
run automatically before every read. See
[`skillmaker reindex`](/cli/reindex/).
