---
type: Reference
prefLabel: Taxonomy Reconciliation
context: _index
status: proposed
links:
  related_to:
    - "./Vision - Board Lab Ship Receive"
    - "../board/Entity - Todo"
    - "../production/Mechanism - Bundle Stage"
    - "../outputs/Mechanism - Receiving Dock"
    - "../runs/Component - Journal Event"
    - "../evals/Entity - Fixture"
---

## WHAT

A reconciliation ruling for the category systems now in play across the
codebase. A census (2026-07-16, full inventory in the PR that carries this
card) found ~20 enums/vocabularies. Most are healthy. The ones that read as
"competing" are almost never actually competing — they are **orthogonal
concepts that collided on a word**, or **a newer structural concept bolted
onto an existing field** instead of getting its own. This card names each
case, rules what to do, and freezes what must not move.

Seven rulings, each with its why, proposed for director sign-off. Nothing
below changes code until adopted; adopted rulings land as their own scoped
PRs (sequencing at the bottom).

## THE TWO ROOT CAUSES

**Word collision at different altitudes.** `idea` is a BundleStage rung
(`Bundle.ts:11`), a SkillLifecycle value (`Adopt.ts:191`), and a
TriageMaturity value (`Triage.ts:85`). `working` is a bundle substate
(`Bundle.ts:25`) and a triage maturity. `archived` is four independent
mechanisms (R3). These systems don't overlap in function at all — they
only look like rivals because they share strings.

**Bolt-on instead of new field.** `TodoOrigin.ref` carries a journal event
id when `kind: "field-report"` and an intake id when `kind: "intake"`
(`Todo.ts:20-31`) — the newer intake concept was bolted onto the existing
ref field. Notably the codebase already contains the better house answer:
`FixtureSource` is a discriminated union with distinct key names
(`Fixtures.ts:105-116`). Two contradictory house answers to the same
problem is how a third, fourth, fifth divergent answer happens.

## RULINGS

### R1 — The verdict→disposition fan-out becomes code (adopt)

`IntakeVerdict` (`return | new | conflict`, derived, never stored —
`Receive.ts:39`) and `RouteDisposition` (`return | new | upgrade | fork |
salvage`, stored on `skill.routed` — `Journal.ts:259`) share the words
`return` and `new`, and `conflict` fans out to `upgrade | fork | salvage`.
That correspondence currently lives only in doc comments
(`Receive.ts:10-17`, `Journal.ts:250-258`); every UI/CLI surface re-implies
it by hand.

**Ruling:** keep both enums — machine recommendation and human ruling are
genuinely different things — but add one exported mapping
(`VERDICT_DISPOSITIONS: Record<IntakeVerdict, readonly RouteDisposition[]>`)
in core, and make Receive's UI and the route CLI derive their offered
dispositions from it. **Why:** a new disposition or verdict added tomorrow
currently desyncs silently; a mapping table makes the compiler catch it.

### R2 — TodoOrigin becomes a discriminated union (adopt)

**Ruling:** migrate `TodoOrigin` to the `FixtureSource` shape:
`{ kind: "field-report", eventId } | { kind: "intake", intakeId }`, with a
read shim in the fold so journal events already written with `ref` still
parse (the journal is append-only; old events are forever). New writes use
the new shape. **Why:** every future origin kind compounds the `ref`
ambiguity, and the codebase should have exactly one house answer to "new
concept needs a home" — the `FixtureSource` one. This is the census's
clearest bolt-on and the cheapest to fix while there are only two kinds.

### R3 — "archived" gets one owner; the other three rename (adopt)

Four mechanisms share the word:

1. Bundle `archived` flag — event-sourced boolean (`Bundle.ts:59`,
   `Fold.ts:62-71`). The real thing.
2. Todo "archived" — a *derived display-retention rule* (terminal + ≥7 days
   + not pinned, `FoldTodos.ts:29,126`). Not a state, never stored.
3. Adopt `SkillLifecycle = "archived" | "idea"` — derived from path
   segments `deprecated/` and `in-progress/` (`Adopt.ts:191-211`). Borrows
   `archived` from #1 and `idea` from BundleStage.
4. Triage decision `archive` (`Triage.ts:59`) — a human ruling in the
   manifest vocabulary that ultimately *appends a `bundle.archived` event*.

The docs half was already untangled (17760ae reworded salvage crates to
"un-accessioned"); the code half wasn't.

**Ruling:** #1 keeps the word — it is the only stored, event-backed
archived. #2 renames identifier-level to `agedOut` (`isAgedOut`,
`includeAgedOut`) — it describes queue hygiene, not bundle-style archival.
#3 renames its values to what they are derived from: `deprecated |
in-progress` — self-documenting and it stops squatting on both `archived`
and `idea`. #4 keeps `archive` — it is a human verb that genuinely produces
#1, i.e. it is not a competitor but a cause. **Why:** these are wire-free,
identifier-level renames (none of the three strings is persisted in the
journal), so the whole ruling is one mechanical PR with zero migration.

### R4 — Reserved-words ledger instead of renaming human vocab (adopt)

TriageMaturity's `idea | draft | working` (`Triage.ts:85`) collides with
BundleStage `idea` and substate `working`, but it is *human elicitation
vocabulary* on a manifest, already isolated behind an explicit mapping
table (`MATURITY_ENTRY_STAGE`, `Triage.ts:106-110`) — the bolt-free design
this card wants everywhere.

**Ruling:** no code change. Instead this card carries the ledger below;
new taxonomies check it before claiming a word. **Why:** renaming natural
human words on human-facing surfaces buys precision at the cost of usable
vocabulary; the mapping table already keeps the altitudes separate in code.

| Word | Taken by | Where |
|---|---|---|
| `idea` | BundleStage rung | `Bundle.ts:11` |
| `working` | BundleSubstate | `Bundle.ts:25` |
| `archived` | Bundle flag (event-backed) | `Bundle.ts:59` |
| `return`, `new` | RouteDisposition (stored) + IntakeVerdict (derived) | `Journal.ts:259`, `Receive.ts:39` |
| `failed` / `fail` | RunStatus (infra) / RunVerdict (grade) / FieldReportOutcome (reporter) | `Run.ts:16`, `Journal.ts:348`, `Journal.ts:174` |
| `published` | BundleStage rung + `skill.published` event | `Bundle.ts:11`, `Journal.ts:116` |

### R5 — Freeze the data layer; converge code names on the display era (adopt the freeze; defer the converge)

Three naming strata exist: journal/stage literals (permanent data), code
names (`/api/catalog`, `/api/skillbook`, `CatalogEntry`, `useSkillbook`,
`Skillbook.ts`), and display names (Lab, Ship, Receive — ruled in
#62/#69/#74, alias table `router.tsx:56-63`).

**Ruling (freeze):** journal event types, stage literals, and every stored
enum are *frozen vocabulary* — display renames never touch them. This has
been the de-facto practice; it becomes explicit. **Ruling (converge,
deferred):** TypeScript-only names (classes, hooks, modules) may converge
on Lab/Ship/Receive opportunistically, and URL endpoints only ever gain
aliases (as `router.tsx` did), never break. **Why defer:** the two-
vocabulary tax on new contributors is real but the churn touches server,
viewer, and CLI at once; it should ride a moment when those files are open
anyway, not be its own big-bang rename.

### R6 — A lockstep test for the hand-mirrored enums (adopt)

The viewer deliberately never imports core, so ~10 enums are hand-mirrored
in `viewer/src/app/runtime/schemas.ts` (and `STAGE_LABEL` a third time in
`cli/src/StageVocab.ts`). **Ruling:** keep the import boundary (it is
load-bearing for bundling), add one test file that imports both sides and
asserts value-for-value equality for every mirrored pair. **Why:** the
boundary is fine; the *silent* part of silent drift is what's dangerous,
and a test converts it to a loud CI failure for the cost of one file.

### R7 — Structured columns flattened to free text: recorded as debt (adopt as ledger entry)

Triage's `stakes`/`hurts` manifest columns fold into the free-text
`skill.received.notes` (`Triage.ts:558-566`). The journal being
append-only, this is not retro-fixable and not worth a v2 event now.
**Ruling:** if stakes/hurts ever need to be queried, add *optional
structured fields* to `skill.received` (additive, schema-tolerant) rather
than parsing notes. Written here so nobody writes the parser.

## DELIBERATELY NOT TOUCHED

- The `fail | failed | failed` triple (RunStatus / RunVerdict /
  FieldReportOutcome): three genuinely different judgments — infra vs
  grade vs reporter's read. Ledger entry, no rename.
- Tolerant wire strings (`FixtureRecord.class`, `RiskCoverageRecord.family`):
  forward-compat by design.
- The display-verb architecture itself (#62/#69/#74): ruled, working as
  intended; R5 only freezes its floor and sketches its ceiling.
- IntakeEvidence (`hash-match | name-collision | foreign-marker | bare`):
  shares derivation with IntakeVerdict through `findRegistryMatch` already.

## SEQUENCING (after sign-off, each its own PR)

1. **PR A (tiny, pure addition):** R1 mapping table + R6 lockstep test.
2. **PR B (small, shimmed):** R2 TodoOrigin union.
3. **PR C (mechanical renames, no wire change):** R3.
4. **Deferred:** R5's converge half, opportunistically.

## WHY (the card itself)

The census was prompted by a repo-wide pare-back: the branch/doc cruft was
mechanical, but the taxonomy layer is the shared, load-bearing surface —
everyone's mental model runs through these words. The finding worth keeping
even if every ruling above is declined: **the systems are not competing;
the words are.** Each mechanism, taken alone, was correctly designed
(several — the maturity mapping table, FixtureSource, the URL alias map —
are exactly right). What's missing is the connective tissue: one mapping
that exists only in comments (R1), one field carrying two meanings (R2),
one word carrying four mechanisms (R3), and no ledger to stop the next
collision (R4).
