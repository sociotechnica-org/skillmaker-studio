---
type: Mechanism
prefLabel: Intake
context: outputs
status: proposed
links:
  related_to:
    - "../_index/Vision - Board Lab Ship Receive"
    - "./Entity - Shipment"
    - "./Entity - Field Report"
    - "../production/Capability - Adopt"
    - "../evals/Economy - Validation"
---

## WHAT

The Receive bay's quarantine for **arriving skills** (issue #73). Receiving
is two inbound flows, and the shipped one only covers the first: field
reports are *signal about our own skills* (`Entity - Field Report`); intake
is for *skills themselves arriving* — foreign or returning, of unknown
pedigree. This card proposes:

- **One new journal event, `skill.received`** — the arrival's ledger fact,
  the mirror of `skill.shipped`: `{ bundle, source, ref?,
  claimedVersionHash?, notes? }`. What the sender claims, recorded at the
  dock, with the actor envelope carrying who accepted it.
- **`skillmaker receive`** — wraps `skillmaker adopt` (which stays legal
  alone): adopt makes the directory a bundle; receive is adopt **plus** the
  `skill.received` fact. Adopting your own pre-Skillmaker repo is not an
  arrival; taking in someone else's skill is.
- **Quarantine as a derived badge, never a gate.** A bundle with a
  `skill.received` event and **zero local measurements** reads *"Unverified
  — in quarantine"* on the Receive and Lab surfaces. It clears when our own
  first measurement lands. No new stage, no enforcement: trust is earned by
  measuring, not granted by a decision.

This is a **proposal** — none of it exists in code. It needs the Director's
review before any implementation issue is filed.

## WHY

Today the system takes skills in but records almost nothing about the
taking. `adopt --source <url> --ref <ref>` (Phase 20 Story 3) writes
upstream provenance **only into the `.skillmaker-adopt.json` marker file**,
deliberately record-only — the journal, the single source of history, has
no arrival fact at all. So "where did this skill come from, and what did it
claim about itself?" is answerable only by filesystem archaeology, and
nothing distinguishes a battle-tested bundle from one that walked in off
the street five minutes ago.

The Director's framing (issue #73): *"when we receive a skill, there needs
to be a quarantine where we get any information we can about it — where
it's come from, data in essence — and then it's probably going to the Lab
to be operated on."*

The quarantine design leans on two existing house laws rather than new
machinery:

1. **Coverage and validation never merge** (`Economy - Validation`). A
   received skill's traveled receipts — the Skillbook paperwork that ships
   with a crate (`Entity - Shipment`) — are *claims*. Our runs are *proof*.
   Quarantine is simply the honest display of "no proof of our own yet,"
   which is why it can be derived instead of decided.
2. **Honest states, no enforcement** (`Mechanism - Drift Hint`'s rule).
   Quarantine never blocks a run, an edit, or a publish. It is a read.

It also deliberately does **not** touch the Board: adopted bundles already
enter the stage machine at `idea` (or `archived` from a `deprecated/`
path), and received ones do the same. Arrival is not a pipeline position.

## HOW

Sequenced like the Port was — smallest honest fact first:

1. **The event + the wrapper.** `skill.received` in `Journal.ts` (pattern of
   `skill.shipped`), a `bundleForEvent` case, no board-state effect.
   `skillmaker receive [--source <url-or-path>] [--ref <ref>] [--notes]`
   runs adoption and appends one event per newly adopted bundle. Activity
   and the Skillbook changelog pick it up like every other event.
2. **The Intake section on Receive.** Arrivals listed with origin, claimed
   version, and the quarantine badge (received + no local measurements →
   *Unverified*). The exit door to the Lab is just the bundle's existing
   detail/Evals surface — once adopted it is already on the bench.
3. **Verification at the dock.** When `claimedVersionHash` was given,
   compare it against the computed hash of what actually arrived —
   *arrived-as-claimed* vs *differs from claim*. This is the first concrete
   instance of **field drift** (a shipped version diverging in the wild),
   scoped to the one moment we can check it cheaply. Rendering traveled
   receipts beside our own measurements (claims column vs proof column,
   never merged) belongs here too.

Deferred, explicitly: the **Board-as-seed** exit door (a received or
reported skill inspiring a new bundle with a provenance link) stays
unbuilt until the Design↔Lab seed relationship is thought through — the
Director has flagged it as unresolved.

Open questions for the Director before this becomes an issue:

- Is derived clearance enough, or is there value in an explicit
  `skill.cleared` decision event (a human saying "I trust this now"), at
  the cost of a second thing to keep honest?
- What clears quarantine: the first local measurement (cheap, matches
  "evaluated once"), or a statistical bar (matches the Lab's job)? Proposed:
  first measurement clears the *badge*; the Lab's coverage display already
  carries the stronger story.
- Should `receive` be able to target a single directory (receive one skill)
  rather than adopt's whole-workspace discovery sweep?

Verified: as of this writing there is no `skill.received`, quarantine, or
intake concept anywhere in `packages/core/src` or `packages/cli/src`.
`adoptWorkspace` (`Adopt.ts`) is filesystem-only — the CLI command layers
`bundle.created` / `bundle.archived` / `skill.version_recorded` events on
top, adopted bundles enter at lifecycle `idea` (or `archived`), and
`--source`/`--ref` provenance is recorded only in the
`.skillmaker-adopt.json` marker (`AdoptUpstream`, "deliberately minimal
(record-only)"), not in the journal. This card is `status: proposed` and
describes a target, not shipped code.
