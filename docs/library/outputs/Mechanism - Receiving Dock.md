---
type: Mechanism
prefLabel: Receiving Dock
context: outputs
status: adopted
links:
  related_to:
    - "../_index/Vision - Board Lab Ship Receive"
    - "./Entity - Shipment"
    - "./Entity - Field Report"
    - "../production/Capability - Adopt"
    - "../evals/Economy - Validation"
    - "../board/Entity - Todo"
    - "../board/Surface - Lab"
    - "../authoring/Entity - Dossier"
---

## WHAT

The Receive bay's intake process for **arriving skills** (issue #73),
ruled by the Director across 2026-07-15/16. Receiving has one job in two
flavors: everything inbound gets a small elicitation and gets routed to
where it does work. The **signal** flavor shipped first (field reports →
fixtures via harvest, todos via `--from-report`). This card is the
**cargo** flavor: skills themselves arriving — foreign, returning, or of
unknown pedigree — get a dock record, a short form, and a human routing
decision.

The word *quarantine* is retired from the vocabulary (Director ruling,
2026-07-16). It blurred two different things that now have their own
names:

- **"In Receiving"** — the *place*. A crate sits at the dock, undisposed,
  until a human routes it. Ends at disposition.
- **"Unverified"** — the *state*. A routed skill we have never measured
  ourselves carries the badge on the bench until our first graded
  measurement. Ends at proof.

That split is the card's core design law: **trust and identity never
merge.** Trust is *derived* — earned by measuring, displayed as the
Unverified badge, cleared by our own first measurement, never decided.
Identity — *what is this, and where does it land in the corpus?* — is
*decided* — a human ruling recorded on the ledger, because content hashes
can prove two things differ but only a human with context can rule on
what the difference means.

## WHY

Three jobs-to-be-done drove the design past the earlier proposal:

1. **Incompleteness policy.** Arrivals with no research base and no evals
   are the normal case, not the exception. The policy: **everything may
   enter; nothing may pretend.** There is no gate on entry and no
   "graduation" into the Lab — the Lab is the workbench where incomplete
   things get completed, and every credibility signal (coverage,
   validation, Unverified, drift) is derived from what actually exists,
   so sloppy work cannot masquerade as hardened work. The one membrane is
   *identity*: a crate gets no name, slug, or place in the corpus until a
   human rules on what it is, because identity mistakes write false facts
   into an append-only ledger.
2. **Context is king.** A skill "performing stably at 10k uses a day"
   arrives with strong *claims* and zero *proof*. Claims and proof never
   merge (Economy - Validation): the badge still reads Unverified, but
   the claim raises triage priority and writes the verification plan —
   its field record tells you which fixtures to author. The dock is where
   claims, contacts, and permission-to-request-data are recorded.
3. **The identically-labeled stranger.** "Frame the Problem 1.3" arrives;
   our Lab holds a *different* 1.3. Base versions mutate, skills fork,
   names drift — managing that chaos is the product's job. This case is
   why the dock must exist *before* adoption: adopting a conflicted crate
   would mint a mutated slug and record facts under a wrong identity.

**Where the separation and judgment come from** (Director ruling,
2026-07-16): provenance is testimony, not a filesystem property — no
scan can tell whose a bare `SKILL.md` is. So the system classifies **at
the door, not in the maker's world**: the workspace is the jurisdiction,
and there are exactly two doors. `adopt` declares "always mine" (no
arrival fact); `receive` declares "came from outside or came back"
(arrival fact, one crate at a time). The **registry is the only true
witness**: every door hash-checks and name-checks arrivals against
recorded versions and slugs, and challenges provable arrivals found under
`adopt` — evidence surfaced, human decides, never enforced. Everything
the registry cannot prove is testimony, recorded with the actor envelope.
Misdeclarations are corrected by *adding* a truer fact later, never by
editing. Wrong-way errors are asymmetric in our favor: the expensive
mistakes (identity collisions) are the ones the registry catches
mechanically; humans are only trusted with the cheap ones.

The elicitation design is grounded in prior art rather than invented
(research pass, 2026-07-16): museum accessioning's assess-then-accession
two-phase and its incomplete-provenance rule ("raise the bar, don't
close the door"), Model Cards' pairing of intended use with out-of-scope
use, Datasheets' graceful partial answers, Backstage's
accept-now-flag-now lifecycle catalog, SLSA's graded (not binary)
provenance, OS&D's condition-recorded-at-receipt, Volere's fit
criterion, ISO 9241 context-of-use, JTBD's anchor-on-a-real-instance,
Pact's consumer-driven contracts, and error-analysis-first eval
practice. Full syntheses with citations travel with the implementation
issues.

## HOW

**The dock record.** `skillmaker receive <path>` — single directory,
required (Director ruling: facts are per-crate; sweeps cannot honestly
batch-stamp `claimedVersionHash` or source, and a mis-swept crate is a
false fact in an append-only ledger). The crate is copied to
`receiving/<intake-id>/`, its content hash computed, and one event
appended: `skill.received { intake, source, ref?, claimedName?,
claimedVersionHash?, rights?, notes? }`. Note the event carries an
**intake id, not a bundle** — a crate has no identity yet; that is the
point. The dock comparison (claimed label × computed hash × the
registry) pre-fills the identity verdict: *return* (hash matches a
recorded version), *new* (no overlap), or *conflict* (name matches,
content differs — flagged loudly).

**The elicitation tree** (order is load-bearing; the cheap, pruning
question comes first — never elicit metadata for what you're
discarding):

1. **Keep / Archive / Skip.** Archive = accession as history (created +
   archived, sinks to the bench's bottom). Skip = we decline to take it;
   the maker's file is untouched. Delete does not exist inside the
   corpus; Skip exists only at the door.
2. *(keeps)* **Whose** — mine / outside / came back / unknown. "Unknown"
   is a first-class recorded answer, never a blank. If outside:
   **rights** — ours / licensed / unclear. Recorded and flagged
   ("unclear" is an honest badge), never a gate.
3. *(keeps)* **Stakes** — occasional aside / load-bearing step. The
   rigor dial: sizes the dossier depth and the eventual eval bar.
   Recorded as a structured `stakes` field on `skill.received` itself
   (issue #108), never flattened into notes prose.
4. *(keeps)* **What hurts** — a note plus urgency: a structured `hurts`
   field on `skill.received` (issue #108), minted as todos with
   `origin: { kind: "intake", ref: <intake-id> }` (the Field Report
   pattern, one origin kind richer).
5. *(keeps)* **Entry stage — never asked.** The maturity self-grade is
   retired (issue #108): entry is derived from what's observably in the
   directory (`deriveEntryStage`: parses + complete identity → Proof;
   parses only → Draft; else Frame), recorded via `bundle.stage_changed`
   with reason `"triage: entry stage derived from runnable output"` and
   no `override` — the system's own read of observables, not testimony.

Bulk import is the same tree as a **triage manifest**: `adopt --triage`
sweeps, pre-fills the machine columns (name, mechanical condition —
parses / complete / has evals — and registry evidence), and writes a
table the maker edits by hand, non-agentically; `--from-manifest`
executes each row as an individual adopt or receive. First-run truth: a
new maker's registry is empty, so on day one the evidence layer is mute
and the manifest **is** the import. A skipped row defaults to *deferral*
(unknown / keep / no note), never to a false fact.

**The dossier** (progressive, per kept skill, depth scaled by stakes;
unanswered fields display as honest gaps — "context: unrecorded" — and
never block anything):

- **Job & context** — walk the last real run (what came right before,
  what happened right after); environment (multi-turn? tools alongside?
  human review before output ships?); intended use **and out-of-scope
  use**, always paired.
- **Handoff contract** — what it receives from upstream, and what
  downstream actually *reads* from its output (fixtures simulate the
  former via `setup.files` and grade only the latter).
- **Basis** — a named framework, or someone's way of doing it (record
  *who*, so ambiguous cases have a source of truth to ask).
- **Evidence** — does performance data exist, where, do we have
  permission? If yes: the first Lab act is reviewing real traces and
  coding failures before writing evals. If no: walk 3–5 cases by hand —
  the interview is the first data-gathering event.
- **Fit criterion** — "if you had to write one pass/fail test today,
  what would it check?" The answer seeds the first fixture's answer key.

**Jobs and contexts** (Director ruling, 2026-07-16): a skill has **one
job** (its identity) and **any number of contexts** (named contracts on
that job — a chain position, an agent persona, an employee-wide
deployment). Job stays, context varies: that is modular reuse working as
intended. Each context carries its own handoff contract, environment,
and stakes; fixtures tag to contexts so coverage reads per-context. When
"repurposing" changes what the skill *does* rather than where it runs,
that is not a new context — it is a **fork** (or a Board re-framing),
routed through the dispositions below. Contexts are both *declared* (at
intake) and *discovered* (a cluster of similar field reports is a
context you didn't know you had — name it and support it, or rule it
out-of-scope; either is honest). The open-context company-wide skill is
handled by declaring what is supported, declaring what is out-of-scope,
and letting harvest teach the rest.

**The five dispositions** (the exit doors; each maps to existing
primitives, recorded as `skill.routed { intake, disposition, bundle?,
reason }` — the `review.requested`/`review.resolved` pairing applied to
cargo; an undisposed crate is a received event with no routing pointing
at it, derived and honest):

- **Return** — hash matches a recorded version: ours coming home. The
  fact attaches to the existing bundle; its work order becomes a todo.
- **New** — no overlap: adopt into the corpus with provenance stamped.
- **Upgrade** — same name, different content, hypothesis *evolved*:
  recorded as the next version of the existing bundle, arrival as its
  provenance.
- **Fork** — shared ancestry, diverged intent: new bundle, new name,
  provenance link to the parent. The family tree recorded instead of a
  naming collision.
- **Salvage** — hypothesis *broken*: no identity granted. Diffs are
  mined into fixtures, the work order into todos on the *existing*
  bundle; the crate stays at the dock, un-accessioned, retained as
  evidence.

The hypothesis (broken? evolved? forked?) is the `reason` — per WHY's
*context is king*, the ledger carries the *why*, exactly as backward
stage moves already demand.

**The Unverified badge** (trust rulings, 2026-07-15): derived only — no
`skill.cleared` event (revisit is cheap; event types are additive).
Received + zero local measurements **ever, at any version** → Unverified
on the bench and on Receive. Cleared by our first graded measurement.
Clearing removes a warning; it never grants a medal — absence of the
badge is silence, and the stronger story belongs to coverage/validation
one row away. Arrival is a one-time fact; ongoing rigor is the Lab's
existing displays.

**Deliberately not:** no gate anywhere (rights, completeness, and
provenance are recorded and flagged, never enforced); no deny-list check
(no known-bad skill registry exists yet; noted for the future); no
agentic elicitation required (the manifest is a file a maker edits over
coffee); no Board-as-seed exit door (the Design↔Lab seed relationship
stays explicitly unresolved); contexts are recorded in the dossier and
as fixture tags — no new context entity, no schema surgery, and
implementation may begin with a single default context.

**Sequencing** (smallest honest fact first, as ever): (1) the dock —
`skill.received`, the crate dir, the registry comparison, the Receive
tab's intake queue (oldest first, honest count — the dock must not
become a shelf); (2) the dispositions — `skill.routed` and the five
exits; (3) the triage manifest and the adopt-side evidence tripwire;
(4) the Unverified badge; (5) the dossier fields and their honest gaps.

Verified: sequencing steps (1), (2), (3), (4), and (5) are built. The dock itself
(issue #90): `skill.received` lands in `Journal.ts` (intake ids, no
`bundle` field); `Receive.ts` copies the crate to `receiving/<intake-id>/`
(source untouched) and derives the return/new/conflict verdict at read
time from a fresh content hash against the registry (`hashReceivedCrate`,
`gatherIntakeRegistry`, `deriveIntakeVerdict` -- never stored);
`skillmaker receive <path>` is the one door. The five dispositions
(issue #91): `skill.routed { intake, disposition, bundle?, reason }`
lands in `Journal.ts`; `Route.ts`'s `routeCrate` is the engine --
`return` proves a hash match against a named bundle with no file
movement, `new`/`fork` move the crate directory into `skills/<slug>/`
and wrap it via `Adopt.ts`'s (now-shared) `adoptDirectoryInPlace`
(`fork` additionally stamps the marker's `forkOf`), `upgrade` lands the
crate's content into an existing bundle's output and calls
`Versions.ts`'s `recordSkillVersion`, `salvage` grants no identity and
touches no files -- the crate stays at the dock as evidence. Idempotent
per intake (same disposition twice is a no-op; a different one is an
honest conflict). `new`/`fork`'s entry stage (issue #115, closing a gap
against triage's own `--from-manifest` door): with no `--stage`, it is
DERIVED from the landed crate's own observables -- the identical
`deriveEntryStage` bulk triage already applies, never `"idea"` by
default -- and `--stage` remains the explicit escape hatch, recorded as
an honest `override: true` move. `skillmaker route <intake-id> --as
<disposition> --reason <text> [--bundle <slug>] [--parent <slug>]
[--name <name>] [--stage <stage>]` is the CLI door; `GET /api/intake` now returns only
undisposed crates (a routed crate, including `salvage`, leaves the
list for good) plus a capped `recentlyRouted` tail; Receive's Intake
section shows the five doors as copyable `skillmaker route` commands
per crate, the verdict-matching door(s) visually suggested, no write
button. Salvage's mining doors are additive extensions of the existing
signal-side commands: `fixture harvest --from-intake <id>` and `todo
add --from-intake <id>` stamp `{kind: "intake", ...}` provenance
alongside the pre-existing `field-report` kind on `FixtureCase.source`/
`Todo.origin`.

The triage manifest and the adopt-side evidence tripwire (issue #92):
`Receive.ts` gained `classifyIntakeEvidence` (hash-match /
name-collision / foreign-marker / bare, sharing `deriveIntakeVerdict`'s
exact precedence via one `findRegistryMatch` helper, with the owning
bundle attached) and `IntakeRegistry.hashOwners`. `Adopt.ts`'s
`adoptWorkspace` gained an optional `registry` that turns the tripwire
on: an evidence-bearing candidate is reported in a new `challenged`
array instead of being adopted -- "these look like arrivals -- route via
`skillmaker receive`, or re-run with `adopt --triage`," never a silent
stamp. There is exactly ONE per-directory write path,
`adoptDirectoryInPlace`, shared by all three doors that mint a
`bundle.json`/marker pair: `adoptWorkspace`'s sweep, `Route.ts`'s
`new`/`fork`, and the manifest's per-row execution. `Triage.ts` is the
manifest's engine: `triageWorkspace` (the same read-only `walk` sweep,
`workspaceRoot` kept separate from a swept subdirectory so evidence and
row paths always anchor to the whole corpus), `renderManifest`/
`parseManifest` (a tolerant markdown-table round-trip sharing
`MarkdownTable.ts` with `RiskMap.ts`), and `executeManifest`/
`executeManifestRow`, which dispatches each row to
`adoptDirectoryInPlace` (seeding the dossier from the row's
`Job`/`Out-of-scope`/`Basis` card answers, issue #108) or `receiveCrate`
(the row's `stakes`/`hurts` landing as structured fields on
`skill.received`), advances a `keep`+`mine` row to its DERIVED entry
stage (`deriveEntryStage` — never asked; `bundle.stage_changed`, reason
`"triage: entry stage derived from runnable output"`, no `override`),
and mints an intake-origin todo for a non-empty `hurts` (`Todo.ts`'s
`TodoOrigin.kind` is `"field-report" | "intake"`, shared with salvage's
mining doors above).
CLI surface: `skillmaker adopt --triage [path]` (writes
`adopt-manifest.md` at the workspace root, acts on nothing) and
`skillmaker adopt --from-manifest [file]` (executes it, one act per
row, no silent truncation in the summary); plain `adopt` itself now
runs the tripwire unconditionally.

The Unverified badge (issue #93): derived only, never stored, no
`skill.cleared`. `Verification.ts`'s `foldEverReceivedBundles` folds
`skill.routed` events into the set of bundle slugs ever named by an
identity-granting disposition (`return`/`new`/`upgrade`/`fork` --
`salvage` grants none, so it never marks a bundle Unverified, not even
one it names as "defended"); `IndexService.rebuild()` folds this once per
rebuild onto a new `BundleRecord.everReceived`, kept deliberately
separate from the pre-existing `upstream` field (`adopt --source ...`
stamps that too, and conflating the two would badge a plain adopted
bundle). Combined with `computeMeasurements`'s existing, never
version-scoped measurement list via `isUnverified(everReceived,
measurementCount)` -- "ever, at any version" falls out of reusing that
same list, not a separate query. `handleCatalog`, `GET /api/intake`'s
`recentlyRouted` tail, and `GET /api/bundles/:slug` each expose an
`unverified` boolean computed from data already read for that request.
Traveled receipts (a crate's claims, a `skill.shipped` snapshot) never
clear it: neither is a `run.graded` event, so neither reaches
`computeMeasurements`'s input -- asserted in `IndexService.test.ts`. The
viewer badges it in violet on the Lab Bench (`Lab.tsx`, `Surface -
Lab.md`), Receive's recently-routed tail (`Receive.tsx`), and the bundle
detail Evals tab (`BundlePanel.tsx`) with the one-line explanation;
`labOrder.ts`'s attention ordering needed no special case (an Unverified
row's `measuredFixtureCount` is necessarily 0, so it composes into the
existing measurement-gap rank), confirmed in `labOrder.test.ts`.

The dossier and context tags (issue #94): `skills/<slug>/dossier.md`
(`../authoring/Entity - Dossier.md` is the authoring card) -- a tolerant
scanner (`packages/core/src/Dossier.ts`'s `parseDossier`) reads Job,
Contexts, Out-of-scope, Basis, Evidence, and Fit criterion as free prose,
preserving any heading it doesn't recognize rather than dropping it, and
joins the reindex warning flow (`IndexService.ts`) exactly like risk-map/
fixtures -- warn, never fail. Its content is read separately, directly, at
bundle-detail request time (`Server.ts`'s `handleBundleDetail`) and
rendered on `BundlePanel.tsx`'s Overview tab as sections present or gaps
named ("fit criterion: unrecorded"); the Lab Bench's `/api/catalog`
response carries no dossier data at all, so dossier honesty never inflates
the bench's badges. `writeDossierScaffold` writes the same comment-hinted
empty template from all three scaffold call sites -- `skillmaker new`
(`WorkspaceService.ts`), and `Adopt.ts`'s `adoptDirectoryInPlace` (the one
write path shared by plain `adopt`, `Route.ts`'s `new`/`fork`, and the
triage manifest's per-row execution) -- never seeded from the manifest's
`stakes` answer, which already lives folded into the *received* event's
free-text notes with no clean seam back out. `FixtureCase` gained an
optional `context` tag (tolerant like `source`, `../evals/Entity -
Fixture.md`) naming which dossier context a case exercises; this issue
adds only the field and the scanner's tolerance of it, not a per-context
coverage rollup. `skillmaker dossier <slug>` prints one bundle's dossier.

This card records the Director's adopted design; the sequenced
implementation issues are the source of truth for build status.
