---
type: Entity
prefLabel: Todo
context: board
status: migrated
links:
  contains:
    - "./Mechanism - Bundle Archive"
  related_to:
    - "../production/Entity - Skill Bundle"
    - "../production/Mechanism - Bundle Stage"
    - "./Surface - Board"
---

## WHAT

The unified second thing the Board tracks, independent of any bundle's
production stage: a `Todo` record with a `kind` (task/bug/improvement/eval),
a `status` (open/in-progress/done/wont-do), a `priority`, an optional
`checklist`, and an optional link to a bundle. Journal-native — materialized
in the `todos` SQLite table from `todo.*` events, never stored as a mutable
file. Implemented in `packages/core/src/Todo.ts` (schema),
`packages/core/src/FoldTodos.ts` (fold + defaults + archive rule), and
`packages/cli/src/commands/Todo.ts` (`skillmaker todo add|list|done|start|
drop|reopen`); rendered in the viewer's `TodosPanel`
(`packages/viewer/src/app/components/TodosPanel.tsx`).

## WHY

The old model split this across four card kinds (Testing, Bug, Improvement,
plus a bare Work Order) with a hard exactly-one-testing-card-per-play rule.
That rule is **explicitly dropped** — a bundle no longer auto-gets a
Testing card the moment it's board-visible; testing/eval work is just an
ordinary `eval`-kind todo (or an eval run directly, with no forced 1:1 card
at all). Consolidating into one `Todo` type also finally resolves the old
model's stage/status polysemy at the *todo* layer: `Todo.status` is a
Todo-only axis, wholly independent of `bundle.stage` — inherited law "Todo
status and bundle stage are independent axes" (data-model.md §1.1).

## HOW

The schema (`packages/core/src/Todo.ts`):

```ts
type Todo = {
  id: string;                      // "td-<ulid>"
  kind: "task" | "bug" | "improvement" | "eval";
  status: "open" | "in-progress" | "done" | "wont-do";  // terminal: done, wont-do
  title: string;
  detail?: string;
  checklist?: { text: string; done: boolean }[];
  priority: number;                // lower = more urgent
  bundle?: string;                 // app-level (non-bundle) todos omit it
  created: string;
  terminalAt?: string;             // derived at replay
  pinned?: boolean;
  archived?: boolean;              // derived: terminal + >=7 days + not pinned  [inherited window]
  source: Actor;
};
```

Default priority by kind (`FoldTodos.ts`'s `DEFAULT_PRIORITY_BY_KIND`,
mirrored client-side in `TodosPanel.tsx`): **bug 10, eval 15, improvement
20, task 30** — bug stays most-urgent-by-default exactly as in the old
model; `eval` is the new kind (replacing the old forced Testing Card); the
old generic default is now `task`.

Journal events (data-model.md §2.9): `todo.opened` (full record),
`todo.updated` (shallow patch of mutable fields only — `title`, `detail`,
`checklist`, `priority`, `bundle`, `pinned`; `id`/`kind`/`created`/`source`
are immutable and structurally absent from the patch schema, so a patch
that tries to carry them is silently stripped, never rejected), and
`todo.status_changed` (`{id, from, to}`). `foldTodos` in `FoldTodos.ts` is
the pure replay: on entering a terminal status it stamps `terminalAt`
(date-only) from the event's `at`; reopening (terminal → open|in-progress)
clears it. `isArchived(todo, now)` is deliberately **not** part of the fold
(it depends on wall-clock time, which would make the fold impure) — it's a
separate pure function called by the index rebuild/CLI/server with an
explicit `now`, true when terminal + `terminalAt` is ≥7 days old + not
pinned. Sort order (`compareTodos`): priority ascending, then created,
then id — total and stable.

**Merged source cards, folded into this one card:**

- `Component - Testing Card` — **RETIRE**, not merge. Its defining rule
  (exactly one Testing card per play, auto-seeded) is explicitly dropped
  in the new model, not carried into `Todo.kind: "eval"`. Eval-kind todos
  are ordinary, optional, and un-forced — noted here per the assignment's
  instruction to flag this precisely.
- `Component - Bug Card` → `Todo.kind: "bug"`, default priority 10
  survives verbatim.
- `Component - Improvement Card` → `Todo.kind: "improvement"`, default
  priority 20 survives. The old card's "absorbs the decision queue"
  framing has no explicit successor in data-model.md — flagged in the
  prep doc, still unresolved; noted here rather than invented.
- `Component - Checklist` → `Todo.checklist` (`{text, done}[]`), no longer
  restricted to Testing cards — any todo may carry one.
- `Economy - Priority` → `Todo.priority`.
- `Economy - Work Order Status` → `Todo.status`.
- `Surface - Work Order Lane` → the viewer's `TodosPanel`
  (`packages/viewer/src/app/components/TodosPanel.tsx`): a persistent,
  collapsible right-side panel on the Board page, not bundle-scoped, with a
  "show archived" toggle and inline add/complete actions posting
  `todo.opened`/`todo.status_changed` through `POST /api/events`. It is not
  a three-lane (Open/In-Progress/Done) sub-surface like the old Work Order
  Lane — it is a single flat, priority-sorted list with status shown as a
  checkbox + strikethrough, plus kind chips.

**Older-dupe cards, also accounted for here:**

- `studio/library/board/Value - Stage.md` and `Value - Status.md` — these
  are literally the recorded stage/status polysemy hot spot
  (`thread:studio-board-stage-status-polysemy`). They do **not** resolve
  into `Todo` — resolving them into this card would re-conflate exactly
  what the new model separates. Both resolve instead to `bundle.stage`, a
  **production-context** concept (single state set, journal-folded); see
  `../production/Mechanism - Bundle Stage`. `Todo.status` is a genuinely
  separate axis and is not what those two cards were describing. Do not
  treat this Todo card as their target.

Verified: `packages/core/src/Todo.ts`'s `Todo` schema class matches the
record shape above field-for-field (kind/status/title/detail/checklist/
priority/bundle/created/terminalAt/pinned/archived/source), and
`packages/core/src/FoldTodos.ts` confirms `DEFAULT_PRIORITY_BY_KIND =
{bug: 10, eval: 15, improvement: 20, task: 30}`, `TERMINAL_STATUSES =
{done, wont-do}`, and `ARCHIVE_WINDOW_DAYS = 7` exactly as described above.
Also checked `packages/cli/src/commands/Todo.ts`: `skillmaker todo add`
defaults `kind` to `"task"` and `priority` to the kind default when
`--priority` is omitted, confirming the default-by-kind rule is enforced
at the CLI, not just documented.
