---
type: Vision
prefLabel: Board · Lab · Ship · Receive
context: _index
status: superseded
superseded_by: "./Vision - The Skill Is the Product"
links:
  related_to:
    - "./Concept - Skillmaker Studio"
    - "../board/Surface - Board"
    - "../board/Entity - Todo"
    - "../board/Surface - Lab"
    - "../board/Surface - Activity Feed"
    - "../outputs/Entity - Skillbook"
    - "../outputs/Entity - Shipment"
    - "../outputs/Entity - Field Report"
    - "../outputs/Mechanism - Receiving Dock"
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
receiving (field signal, later the cargo dock) — so it split into its
own tabs, **Ship** and **Receive**, landing the current
Board · Lab · Ship · Receive · Activity order in #72. The re-scoping half
— Lab as a pressure bench, the checkout/field-report loop Ship and
Receive exist to carry — has **not** shipped, but as of #80 it is no
longer wholly unscheduled: the director's stock-and-flow ruling below
turns it into a batch of three specced issues (#81, #82, #83). This card
remains the target picture that work still builds toward.

A second director ruling, same day (2026-07-15, #80 — "stock and flow"),
closes a question the rebuild had drifted on: *"getting clear on source
of truth for to-dos and getting clear on source of truth versus views for
the work process."* The distinction that resolves it: **stage is a
property of the skill** (how far its existence has come); **a todo is a
unit of work** (bug, experiment, eval, improvement). For a brand-new
skill the two coincide — there is exactly one unit of work, "bring this
thing into existence," and its phases are the skill's own phases — which
is why the kanban Board fits genesis perfectly and fails maintenance
completely; GitHub doesn't drag a repo across a kanban when you fix a
bug, the issue moves, not the repo. Named directly onto the rooms above:
**Board is the flow view** (skills in genesis and re-conception); **Lab
is the stock view** (the portfolio under care, once a skill exists).

The rule for where work lands: work that changes what a skill *is* — its
frame, its design — re-enters the Board as a stage move backward, already
legal-with-a-reason; work that changes how *well* a skill does what it
already is is a todo, and it lives in the Lab. A shipped skill's eval
work never moves a stage. **"Evaluated once" is a stage** — first risk
map, first fixtures, first green graded run; **"statistically valid" is
a pursuit** the Lab owns and that never ends, which is exactly why it is
not a stage.

The consequences, one issue each. The todo queue is named directly as
*the heart of the Lab* — the journal stays the sole source of truth
(`todo.*` events, folded; see `../board/Entity - Todo`); only
presentation moved, **shipped in #83**, from the persistent right-rail
panel to the Lab's Queue mode (`../board/Surface - Lab`). The Published
column is meant to become a **doorway,
not a shelf** (#82, proposed, not yet built): recently graduated skills
would pass through it into the Lab instead of accumulating on the Board
indefinitely, as they do today (see `../board/Surface - Board`). Field
signal becoming Lab work — a todo with its provenance stamped — is the
batch's connective tissue (#81), the counterpart to harvest's
report→fixture path (#68).

Shipping stays stage-independent throughout, already true in code today
(`skill.shipped` never touches the stage fold) — a Lab skill can ship,
the patch flow is fix → `skill.version_recorded` → `skill.shipped` with
fresh receipts; "skills in the Lab aren't shipped" is old-Catalog vibes,
not the data model.

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
  later, arriving skills get the receiving dock. (The inbound half of the
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
Activity, #72); field drift (a shipped version diverging in the wild)
remains unbuilt. The stock-and-flow ruling (#80) is `adopted` too — the
director has ruled — and #83, the Lab's Bench/Queue split, is no longer
docs-only: `Lab.tsx` now has a deep-linkable mode toggle
(`../board/Surface - Lab`), `AppShell.tsx`'s persistent todo rail is
retired, and `GET /api/catalog`'s `openTodoCount` feeds Bench's open-work
signal and rank. #81/#82 spec the batch's other two issues.
