---
type: Reference
prefLabel: Canonical Store Split
context: runs
status: new
links:
  related_to:
    - "./Entity - Journal"
    - "./Entity - Run"
    - "../board/Surface - Board"
---

## WHAT
New card (prep doc §4). The architectural law (director ruling A,
data-model.md §1.2/§1.3) that every fact has exactly one canonical home,
split three ways:

| Home | What lives there | Mutability |
|---|---|---|
| **Files** (`skills/<slug>/`) | Content: research, design, fixtures, outputs, run transcripts + artifacts, run metadata | Sources editable; outputs produced; records append-only |
| **Journal** (`.skillmaker/events.jsonl`) | State + decisions: stage changes, gate decisions, todos, grades, versions, publications | Append-only |
| **SQLite** (`.skillmaker/studio.db`) | Nothing canonical — materialized views + search index | Rebuilt by `skillmaker reindex` |

**There is no mutable state JSON (no `board-state.json` descendant).**

## WHY
This is the law that makes "the board is a journal replay" true, and it's
load-bearing for far more than the Board: every derived view in the
product (the board columns, the eval read-out, the skillbook, the todos
panel) is a function of files + journal, recomputable at any time, never a
second place a fact could silently drift out of date. Nothing in the old
model had this as a named, single ruling — it was implicit in "registry vs
board split" and re-litigated per-feature; here it's one law with three
rows.

## HOW
`packages/core/src/IndexService.ts`'s own doc comment states the rule
directly: `.skillmaker/studio.db` is "a SQLite-backed, REBUILDABLE CACHE
over the two canonical stores — files (`skills/*/bundle.json`) and the
journal (`.skillmaker/events.jsonl`). It is never a source of truth
(data-model.md §1.3)." `rebuild()` writes to a fresh temp db file and
atomically renames it over `studio.db` — so the CLI command
`skillmaker reindex` (`packages/cli/src/commands/Reindex.ts`) is always
safe to re-run, never accretes stale state, and (Part 3 ruling I)
surfaces malformed input as warnings rather than hard-failing.

Board state specifically: `bundles.stage`/`substate`/`archived` in SQLite
are folded from `bundle.*` journal events (`Fold.ts`'s
`foldBundleStates`), not read from any mutable file — this is what
`../board/Surface - Board` depends on to be "derived from the journal
fold, not a mutable file."

Verified: `packages/core/src/IndexService.ts`'s top-of-file doc comment
explicitly names the two canonical stores and describes `studio.db` as a
rebuildable cache, matching this card's table verbatim.
`packages/cli/src/commands/Reindex.ts`'s doc comment confirms `reindex`
"is always safe to re-run and never hard-fails on malformed input... it
surfaces warnings" (ruling I). Grepping `packages/core/src`/`packages/cli/src/commands` for
"board-state" surfaces only `Bundle.ts`'s doc comment explicitly disclaiming
one ("never stored as a mutable file — there is no board-state.json
descendant") — no actual `board-state.json` or equivalent mutable state
file exists in the codebase.
