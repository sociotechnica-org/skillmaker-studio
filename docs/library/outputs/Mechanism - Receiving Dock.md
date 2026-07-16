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
4. *(keeps)* **What hurts** — a note plus urgency, minted as todos with
   `origin: { kind: "intake", ref: <intake-id> }` (the Field Report
   pattern, one origin kind richer).
5. *(keeps)* **Maturity** — idea / draft / working. Routes Board flow
   vs. straight to the bench per the stock-and-flow ruling (#80).

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

Verified: sequencing step (1), the dock itself, is built (issue #90).
`skill.received` lands in `Journal.ts` (intake ids, no `bundle` field);
`Receive.ts` copies the crate to `receiving/<intake-id>/` (source
untouched) and derives the return/new/conflict verdict at read time
from a fresh content hash against the registry (`hashReceivedCrate`,
`gatherIntakeRegistry`, `deriveIntakeVerdict` -- never stored);
`skillmaker receive <path>` is the one door; `GET /api/intake` and
Receive's Intake section surface undisposed crates oldest first, no
write button. Still unbuilt: `skill.routed` and the five dispositions
(so every received crate is undisposed today by construction, not by a
special case -- `listUndisposedIntake` needs no change once routing
ships), the triage manifest, the Unverified badge, and context tags.
`adoptWorkspace` (`Adopt.ts`) remains filesystem-only with
`--source`/`--ref` recorded in the marker file, not the journal. This
card records the Director's adopted design; the sequenced
implementation issues are the source of truth for build status.
