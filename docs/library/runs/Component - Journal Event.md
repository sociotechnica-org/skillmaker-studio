---
type: Component
prefLabel: Journal Event
context: runs
status: migrated
links:
  related_to:
    - "./Entity - Journal"
    - "./Mechanism - Review Pair"
    - "./Entity - Run"
---

## WHAT
One entry on the journal naming something that happened, plus the rule that
governs writing one. Rewrite of the old Lifecycle Event card — same "one
idempotent entry per happening" idea — folded together with the envelope
shape and the idempotency rule (the prep doc's "new-card" need for a journal
envelope card; no separate card was written for that, it lives here).

Every event shares this envelope:

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid",
  "type": "run.graded",
  "at": "2026-07-10T17:20:00Z",
  "actor": { "kind": "user", "name": "jess" },   // kind: user | agent | process
  "idempotencyKey": "grade:01JZX8M2E9V0Q4:1",    // optional
  "payload": { … }
}
```

`type` is a closed discriminant over the v1 event catalog: `bundle.created`,
`bundle.stage_changed`, `bundle.gate_decided`, `bundle.archived` /
`bundle.restored`, `skill.version_recorded`, `skill.published`,
`todo.opened` / `todo.updated` / `todo.status_changed`, `run.started` /
`run.completed` / `run.graded`, `station.started`, `review.requested`,
`review.resolved`.

## WHY
Idempotency matters because callers (CLI commands, run engines) may retry a
write after a crash or a flaky process without knowing whether the previous
attempt landed — the append rule makes a retry safe by construction instead
of by caller discipline.

## HOW
The append rule (`packages/core/src/JournalService.ts`, `Journal.append`):
1. **Validate** the candidate event against the `JournalEvent` schema
   union (`packages/core/src/Journal.ts`).
2. **Idempotency check**, only when `idempotencyKey` is present: read the
   whole journal, look for an existing event with the same key.
   - same key + same `{type, actor, payload}` (structural JSON equality) →
     no-op, returns `{status: "already_appended", event: <existing>}`.
   - same key + different `{type, actor, payload}` → fails with
     `JournalIdempotencyConflictError`, no line written.
3. **Append** exactly one JSON line (repairing a missing trailing newline
   first so appends never merge onto a partial last line).

Writes go only through the CLI/server — `packages/core/src/JournalService.ts`
is the only writer; an agent or CLI command never appends a raw line to
`events.jsonl` directly (rewrite of the old Ledger card's "runtime is the
only writer" rule).

Verified: `packages/core/src/Journal.ts` defines the envelope fields
(`schemaVersion`, `id`, `at`, `actor`, `idempotencyKey`) spread into every
event class, and the full 16-member `JournalEvent` union.
`packages/core/src/JournalService.ts`'s `sameContent()` and `append()`
implement exactly the same-key/same-payload no-op vs. same-key/different-payload
conflict rule described above.
`packages/core/test/Journal.test.ts` — three tests: "same idempotencyKey +
same content is a no-op", "same idempotencyKey + different payload
conflicts", "no idempotencyKey appends every call" — confirm this behavior
directly. (`packages/core/test/JournalEvent.test.ts` exists but covers
schema decoding, not idempotency; `Journal.test.ts` is the idempotency
evidence.)
