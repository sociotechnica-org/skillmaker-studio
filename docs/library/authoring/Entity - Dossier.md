---
type: Entity
prefLabel: Dossier
context: authoring
status: adopted
links:
  related_to:
    - "./Entity - Design Doc"
    - "../outputs/Mechanism - Receiving Dock"
    - "../evals/Entity - Fixture"
    - "../evals/Mechanism - Reindex Validation"
    - "../board/Surface - Lab"
---

## WHAT
`dossier.md` — a Skill Bundle's progressive context-of-use record (issue
#94, `../outputs/Mechanism - Receiving Dock.md`'s "the dossier"): the deep
questions the dock's elicitation tree only starts (job & context, handoff
contract, basis, evidence, fit criterion), asked over time rather than all
at once, depth scaled by stakes, and answered as much or as little as a
maker currently knows.

Light frontmatter (`bundle: <slug>`) plus six free-prose H2 sections, **all
optional, every one of them**:

- `## Job` — one line: what does this skill do?
- `## Contexts` — any number of named `### <context>` entries (**jobs
  singular, contexts plural**, Director ruling 2026-07-16): a chain
  position, an agent persona, an employee-wide deployment. Job stays,
  context varies — that's modular reuse working as intended. Each names its
  handoff-in (what it receives from upstream), what downstream actually
  *reads* from its output, environment notes (multi-turn? tools alongside?
  human review before it ships?), and stakes (aside | load-bearing).
- `## Out-of-scope` — paired with Job (Model Cards): what this should
  explicitly *not* be used for.
- `## Basis` — a named framework, or someone's way of doing it — record
  *who*, so an ambiguous case has a source of truth to ask.
- `## Evidence` — does performance data exist, where does it live, do we
  have permission to use it?
- `## Fit criterion` — "if you had to write one pass/fail test today, what
  would it check?" (Volere) — the answer seeds the first fixture's answer
  key.

An unanswered section is an honest gap, not a defect: the bundle-detail
page names it plainly ("fit criterion: unrecorded") and nothing anywhere
blocks on it.

## WHY
Grounded in the Receiving Dock's research pass, not invented: ISO 9241
context-of-use treats context as a living working document, never a
one-time intake form; Datasheets for Datasets is designed around graceful
partial answers; Volere's fit criterion is deliberately the seed of the
first fixture, not a separate artifact; Pact's consumer-driven contracts
scope a handoff to what downstream *actually reads*, not everything a
producer could theoretically emit; Model Cards pairs intended use with
out-of-scope use as one fact, never two.

"Jobs singular, contexts plural" is its own ruling, not a rediscovery of
Design Doc's Intent section: a design doc's Intent is authored once, before
the skill exists, to decide what to build. A dossier's Contexts are
discovered *and* declared over the skill's life, after it exists, to record
where it actually runs — a cluster of similar field reports is a context a
maker didn't know they had; naming it (or ruling it out-of-scope) is
equally honest work. Fixtures may tag a `context` (`../evals/Entity -
Fixture.md`) so a future coverage lens can read per-context — this card and
its implementing issue add only the field and the scanner's tolerance of
it, not that lens.

The dossier is deliberately a second file, not more sections bolted onto
`design.md`: `design.md` is authored once, up front, to decide what to
build; `dossier.md` accumulates afterward, answered as much as currently
known, and is never blocked on being complete. Splitting them keeps
"what we decided to build" and "what we've learned about how it's actually
used" from being silently conflated in one file's edit history.

## HOW
`dossier.md` lives at `skills/<slug>/dossier.md`, a sibling of `design.md`
and `bundle.json`. Three call sites scaffold it identically, each with
every section a comment-hinted empty gap and exactly ONE example context
shown *inside* the guidance comment (never as a real heading — a real
heading would register an actual, if empty, context and defeat the honest-
gap law): `skillmaker new` (`WorkspaceService.ts`'s `createBundle`) and
`Adopt.ts`'s `adoptDirectoryInPlace` — the one write path shared by plain
`adopt`'s sweep, `Route.ts`'s `new`/`fork` dispositions, and the triage
manifest's per-row `keep`+`mine` execution. None of the three ever clobber
an existing `dossier.md` — files are canonical for content, so a foreign
arrival's or a re-adopted skill's own dossier survives untouched.

The triage manifest's `stakes` answer (aside | load-bearing) does **not**
seed the dossier (a judgment call, issue #94): `Triage.ts`'s
`composeReceiveNotes` already folds `stakes` into the free-text `notes` on
the *received* event, joined with `hurts` in one prose string — there is no
clean, always-present seam to pull a structured value back out of that
without either mis-parsing deliberately unstructured testimony or
fabricating structure the ledger never recorded. Every scaffold writes the
same honest-empty template regardless of how the bundle arrived; stakes
stays exactly where it was recorded.

`Dossier.ts` (`packages/core`) follows the house tolerant-parsing pattern
(`RiskMap.ts`'s doc comment: "parse permissively, warn never fail"), but for
free prose rather than a table: a heading it doesn't recognize is
*preserved* — named and returned, not dropped — so a maker-added section
survives being scanned even before anything reads it. A section holding
only its own scaffold comment reads as unrecorded, exactly like a fresh
scaffold; a missing file entirely is fine, the same "optional until
authored" treatment `risk-map.md` gets.

The scanner's warnings join the reindex flow exactly like risk-map/fixtures
(`../evals/Mechanism - Reindex Validation.md`): warn, never fail. Its
*content* is read separately, directly, at bundle-detail request time — the
same "don't pay for a full rebuild for one bundle's read" split the
Receive tab's field-report fixture lookup already uses — and rendered on
the bundle-detail page as sections present or gaps named. The Lab Bench
(`../board/Surface - Lab.md`'s `LabRow`) reads a wholly separate `/api/
catalog` response that never carries dossier data at all — not filtered
out, structurally absent — so dossier honesty can never inflate the
bench's badge count; it lives only where a maker is already looking when
working the skill.

`skillmaker dossier <slug>` prints a bundle's dossier: recorded content or
`unrecorded` per section, plus any scanner warnings.

Verified: `packages/core/src/Dossier.ts` (`parseDossier`,
`writeDossierScaffold`), its wiring into `WorkspaceService.ts`'s
`createBundle`, `Adopt.ts`'s `adoptDirectoryInPlace`, and
`IndexService.ts`'s `rebuild()` (dossier warnings tagged `source:
"dossier"`); `packages/core/src/Fixtures.ts`'s optional `context` field
(`FixtureCase`, `FixtureCaseRecord`, `scanFixtures`, `writeFixtureScaffold`)
and `packages/cli/src/commands/FixtureAdd.ts`'s `--context` flag;
`packages/cli/src/commands/Dossier.ts` (`skillmaker dossier`);
`packages/cli/src/server/Server.ts`'s `handleBundleDetail` (the `dossier`
field on `GET /api/bundles/:slug`) and
`packages/viewer/src/app/components/BundlePanel.tsx`'s `DossierSection`.
