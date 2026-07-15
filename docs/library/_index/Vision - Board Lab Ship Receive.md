---
type: Vision
prefLabel: Board · Lab · Ship · Receive
context: _index
status: adopted
links:
  related_to:
    - "./Concept - Skillmaker Studio"
    - "../board/Surface - Board"
    - "../board/Surface - Activity Feed"
    - "../outputs/Entity - Skillbook"
    - "../outputs/Entity - Shipment"
    - "../outputs/Entity - Field Report"
    - "../outputs/Mechanism - Drift Hint"
    - "../evals/Entity - Fixture"
---

## WHAT

A north-star mental model for the five viewer surfaces, framed by the
**job each one does** rather than by the data it lists. It renames and
re-scopes two of today's tabs and names one new primitive. The naming
shipped in two passes: nav labels, routes, and page taglines for
Board · Lab · Port · Activity landed in #64. Director ruling
(2026-07-15): Port was one tab doing two jobs with different paperwork —
outbound shipping (manifests, destinations, receipts) and inbound
receiving (field signal, later intake/quarantine) — so it split into its
own tabs, **Ship** and **Receive**, landing the current
Board · Lab · Ship · Receive · Activity order in #72. The re-scoping half
— Lab as a pressure bench, the checkout/field-report loop Ship and
Receive exist to carry — has **not** shipped; this card is the target
picture that work still builds toward.

The model is four rooms plus a ledger:

- **Board — the production floor.** *"Does this exist and roughly work?"*
  Build a skill to a first working version: research → draft → a single
  eval pass. Flow, not iteration. (Today's `Board`, unchanged.)
- **Lab — the hardening bench.** *"Can I trust this under pressure?"*
  Everything you do to a skill **after** it exists: run evals to
  statistical validity, harden, regress, split/merge, compare versions
  and providers. (Today's `Catalog`, re-scoped and renamed.)
- **Ship — the shipping bay.** *"Where did this go, and in what state?"*
  Skills leave in a known state for a known destination and purpose,
  carrying their receipts. (The outbound half of the old `Port`; today's
  per-bundle `Skillbook` chapter — receipts + design + changelog —
  survives as the paperwork that ships **with** a skill, not as the whole
  surface.)
- **Receive — the receiving bay.** *"What is the world telling me about
  what I shipped?"* Field signal comes back from shipped skills, and
  later, arriving skills get intake/quarantine. (The inbound half of the
  old `Port`, split out #72; unbuilt beyond an empty state until #67.)
- **Activity — the ledger.** The journal of everything that happened,
  unchanged.

## WHY

Two problems this fixes.

**1. Catalog and Skillbook look like the same list.** Both are
workspace-wide card lists of the same bundles; Catalog's only
distinguishing signal (a `drift` pill) is muted when clean, and its
`archived`/`tags` extras are conditional and usually empty. So a clean
workspace makes them near-identical. Framing by JTBD separates them: Lab
is the *operator's* messy bench (drift, coverage gaps, comparisons); Port
is the *outside-facing* record. Same data, two altitudes, two audiences.

**2. The system is a closed loop.** Ported out of a parent product where
the parent *was* the consumer, skills never actually left — "published"
was the terminus and the only thing that ships today is a static
`skillmaker book build` site. Independence breaks that assumption: skills
now leave to other agents, repos, and runtimes, where they **change** and
**generate signal**. A loop that only emits documentation cannot get
smarter. The Port's receiving half turns every shipped skill into a
sensor: field reports → new Lab fixtures → hardened skills, or → new-skill
inspiration on the Board. That return channel is the point of being
independent.

The Board/Lab seam is exactly the eval distinction the Director named:
**"evaluated once" vs "statistically valid."** Board gets a green fixture;
Lab gets a tight CI at high `n` across variation — same measurement
machinery (`n`, `passRate`, 95% CI), a higher bar. This keeps the Board
from filling with in-production hardening work: that work physically
moves to another room.

## HOW

The model rests on **one new primitive** the codebase does not yet have: a
**checkout / return record**, expressed as two journal event types (the
journal already replays version/publish/gate events into the changelog):

- `shipped` — `{ skill, version, destination, purpose,
  guarantees-at-ship-time }`. The manifest is mostly assembled from things
  that already exist: version hash + measurement receipts + design intent.
- `field-report` — `{ skill, version, destination, outcome/signal,
  optional new-fixture }`. The wild is the best fixture source; a skill
  that fails in production **is** a new fixture.

Sequencing (do not build the two-way port at once):

1. **Outbound manifest first.** Make a skill checkout-able with its
   receipts attached — useful with zero return channel, and it forces the
   question "what does a skill *ship as*."
2. **A dumb inbound channel.** Even a manually pasted field report proves
   the loop closes once, by hand, before automating it.
3. **Then** wire `field-report` → Lab fixture.

Guardrails for whoever builds this:

- **Lab must be a bench, not a shelf.** If Lab is still a passive card
  list, the confusion was renamed, not fixed. It should surface
  comparison and pressure: version-vs-version diffs, provider A/B,
  regression runs, where-it-breaks. Its drift pill should read as
  *attention needed* — consider hiding `in-sync`/`no-version`.
- **Skillbook is paperwork, not the surface.** Keep the receipts +
  design + changelog view (`SkillbookBundlePage`) as the doc for one
  shipped version; Ship is the bay it moves through.
- **Field drift ≠ local drift.** Today's `drift` (Mechanism - Drift Hint)
  compares live on-disk files to the last recorded version. Field drift —
  a shipped version diverging in the wild, or its pass rate moving under a
  model upgrade — is a distinct, unbuilt concept Receive owns.

Naming: **Board** (keep) · **Lab** (was Catalog) · **Ship** (was
Skillbook, then Port; #72 split off the outbound half) · **Receive**
(new tab, #72 split off Port's inbound half) · **Activity** (keep).

Verified: as of this writing both halves of the checkout/return-record
primitive exist in `packages/core/src`/`packages/cli/src` — `skill.shipped`
(outbound, #71, `Entity - Shipment.md`) and `skill.field_report` (inbound,
#67, `Entity - Field Report.md`); `skillmaker book build` (static site)
remains the only *delivery* mechanism, since neither event copies anything.
`Lab.tsx` (was `Catalog.tsx`, #64) renders a `drift` pill unconditionally
but `archived`/`tags` conditionally; Lab and Ship index rows are
structurally near-identical (name · stage badge · one-liner · version ·
fixture count) — the rename didn't touch that, on purpose, since it's a
separate, un-scheduled behavioral change. `Receive.tsx` (#67) now reads
`GET /api/field-reports` and renders a paste form; a field report never
moves a bundle's stage, same house rule shipping follows. This card is
`status: adopted` for the naming (now Board · Lab · Ship · Receive ·
Activity, #72); Lab's bench upgrades and field drift (a shipped version
diverging in the wild) remain unbuilt.
