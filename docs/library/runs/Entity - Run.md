---
type: Entity
prefLabel: Run
context: runs
status: migrated
links:
  related_to:
    - "./Economy - Run State"
    - "./Mechanism - Review Pair"
    - "./Reference - ACP Provider"
    - "./Reference - Canonical Store Split"
---

## WHAT
A single execution record at `skills/<slug>/runs/<run-id>/run.json` —
written at start, finalized at end, then immutable. Direct rename of the
old Play Run card: **Play Run → Run**, `ax run <play>` (embedded-Fabro,
detached-by-default) → the ACP-subprocess run engine
(`RunEngine.runFixture`, `StationEngine.runStation`).

A run has a `kind`, and there are two of them — same entity, different
kind value:

- **`kind: "eval"`** — one fixture case × one recorded skill version × one
  provider(+model), driven by `RunEngine.runFixture`. Direct rename of the
  old Dry-Run capability.
- **`kind: "station"`** — a run that does one production-state-machine
  state's actual work (not an eval), driven by `StationEngine.runStation`.
  This folds in the prep doc's new-card need "Station run (`Run.kind:
  station`)" as a subsection here, rather than a separate file — it's the
  same `RunRecord` schema and the same execution mechanics (sandbox →
  install skill → ACP session → capture transcript → diff artifacts) with
  `station` set to the state id instead of `null` and `fixtureCase` omitted.

## WHY
Confirms the prep doc's hot-spot #7 (Play Run over-promotion): the
canonical-store law (`../runs/Reference - Canonical Store Split`, ruling A)
puts `runs/` firmly in the "records" class — immutable evidence, files +
journal, never identity/catalog. The demotion the old library only
proposed is now structurally enforced: a Run has no slug, no listing
surface of its own outside a bundle's `runs/` directory, and is never
promoted to something a bundle "has one of."

## HOW
Mechanics (both kinds, `RunEngine.ts` and `StationEngine.ts` deliberately
mirror each other's shape rather than sharing an abstraction): create a
temp sandbox workspace → `git init` → copy fixture files in (eval) or seed
the bundle's current `produces` source (station) → install `output/` as
the skill under the provider's skill-install dir (`.claude/skills/<slug>/`
or `.agents/skills/<slug>/`, see `Reference - ACP Provider`) → launch the
provider over ACP with the prompt → capture the transcript
(`transcript.jsonl`) → diff the sandbox to produce `artifacts/`.

```ts
// packages/core/src/Run.ts
export const RunKind = Schema.Literals(["eval", "station"]);
export const RunStatus = Schema.Literals(["running", "completed", "failed", "infra-error"]);
export class RunRecord extends Schema.Class<RunRecord>("RunRecord")({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,            // ULID = directory name
  bundle: Schema.String,
  kind: RunKind,
  station: Schema.NullOr(Schema.String),   // state id when kind = "station"; null for eval
  fixtureCase: Schema.optionalKey(Schema.String),  // eval runs only
  skillVersionHash: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.optionalKey(Schema.String),
  status: RunStatus,
  actor: Actor,
}) {}
```

The record is mirrored onto the journal as `run.started` (full `run.json`
minus end fields, for replay-completeness) and `run.completed`
(`{id, status, endedAt}`); the grade (`run.graded`, eval runs) lives on the
journal only, never in `run.json` — see `./Economy - Run State`. Station
runs additionally bracket their work with `station.started` and, on a
completed run, `review.requested` — see `./Mechanism - Review Pair`.

Verified: `packages/core/src/Run.ts` — `RunKind = Schema.Literals(["eval", "station"])`
and the full `RunRecord` schema match this card exactly.
`packages/core/src/RunEngine.ts`'s `runFixture` and
`packages/core/src/StationEngine.ts`'s `runStation` — both construct a
`RunRecord`, append `run.started`/`run.completed`, and share the
sandbox→ACP-session→diff mechanics described above; `runStation`
additionally appends `station.started` and, conditionally, `review.requested`.
