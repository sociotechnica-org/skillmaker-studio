---
type: Vision
prefLabel: Board · Lab · Port
context: _index
status: proposed
links:
  related_to:
    - "./Concept - Skillmaker Studio"
    - "../board/Surface - Board"
    - "../board/Surface - Activity Feed"
    - "../outputs/Entity - Skillbook"
    - "../outputs/Mechanism - Drift Hint"
    - "../evals/Entity - Fixture"
---

## WHAT

A north-star mental model for the four viewer surfaces, framed by the
**job each one does** rather than by the data it lists. It renames and
re-scopes two of today's tabs and names one new primitive. This is a
**proposal**, not shipped reality — it exists so building agents share one
target picture.

The model is three rooms plus a ledger:

- **Board — the production floor.** *"Does this exist and roughly work?"*
  Build a skill to a first working version: research → draft → a single
  eval pass. Flow, not iteration. (Today's `Board`, unchanged.)
- **Lab — the hardening bench.** *"Can I trust this under pressure?"*
  Everything you do to a skill **after** it exists: run evals to
  statistical validity, harden, regress, split/merge, compare versions
  and providers. (Today's `Catalog`, re-scoped and renamed.)
- **Port — the shipping *and* receiving bay.** *"Where is this in the
  world, and what is it telling me?"* Skills leave in a known state for a
  known destination and purpose; field signal comes back. (Today's
  `Skillbook`, re-scoped and renamed. The *Skillbook* — receipts +
  design + changelog — survives as the paperwork that ships **with** a
  skill, not as the whole surface.)
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
  shipped version; the Port is the bay it moves through.
- **Field drift ≠ local drift.** Today's `drift` (Mechanism - Drift Hint)
  compares live on-disk files to the last recorded version. Field drift —
  a shipped version diverging in the wild, or its pass rate moving under a
  model upgrade — is a distinct, unbuilt concept the Port owns.

Naming: **Board** (keep) · **Lab** (was Catalog) · **Port** (was
Skillbook; alt: Dock/Harbor) · **Activity** (keep).

Verified: as of this writing there is no deployment/checkout/field-report
concept in `packages/core/src` or `packages/cli/src` — the only outbound
path is `skillmaker book build` (static site). `Catalog.tsx` renders a
`drift` pill unconditionally but `archived`/`tags` conditionally;
`Catalog` and `Skillbook` index rows are structurally near-identical
(name · stage badge · one-liner · version · fixture count). This card is
`status: proposed` and describes a target, not shipped code.
