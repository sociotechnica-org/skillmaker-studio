---
type: Entity
prefLabel: Journal
context: runs
status: migrated
links:
  contains:
    - "./Component - Journal Event"
  related_to:
    - "./Entity - Run"
    - "./Reference - Canonical Store Split"
    - "../production/Mechanism - Guarded Transition"
---

## WHAT
The append-only event log at `.skillmaker/events.jsonl` that a workspace's
state and decisions are written onto — stage changes, gate decisions, todos,
grades, versions, and publications. Direct rename of the old Ledger: same
append-only, git-tracked-shared-history mechanics, new home.

## WHY
One source of truth per fact (inherited law): state-y things (what happened,
what was decided) are events, not a mutable JSON file. This is what makes
the Board and every other derived view reconstructible from replay instead
of drifting out of sync with a stateful cache.

## HOW
Lives at `.skillmaker/events.jsonl`, tracked in git with `merge=union` so
concurrent branches' histories combine safely. Writes go only through the
CLI/server — `packages/core/src/JournalService.ts`'s `Journal.append`,
consumed by CLI commands (`Advance.ts`, `ReviewRequest.ts`, `Grade.ts`,
`Todo.ts`, `Version.ts`, `Publish.ts`) and the run engines
(`RunEngine.ts`, `StationEngine.ts`) — never appended freehand by an agent.
The append path validates the event against the `JournalEvent` schema
(`Journal.ts`), runs the idempotency check (see `Component - Journal
Event`), then appends one line. `.skillmaker/studio.db` (SQLite) is a
rebuildable index folded from this log plus the files tree — never a second
source of truth (see `Reference - Canonical Store Split`).

Verified: `packages/core/src/JournalService.ts`'s `layer()` — `append()`
reads the whole file, checks `idempotencyKey`, then does an atomic
append-with-repaired-trailing-newline write; `readAll()` decodes every line
against the `JournalEvent` schema. `packages/core/test/Journal.test.ts`
exercises exactly this idempotency behavior end to end.
