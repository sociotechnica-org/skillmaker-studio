---
type: Concept
prefLabel: Hosted-ASAP Intent
context: machine
status: new
links:
  related_to:
    - "./Mechanism - Machine Registry"
    - "../_index/Vision - The Skill Is the Product"
    - "../_index/Reference - Persona Map"
---

## WHAT

A standing architectural bias, stated by the director on the 2026-08-03
Danvers catch-up: "all of the decisions that I've been making
architecturally over the last two weeks have been moving us towards a
path where we can be hosted ASAP … stop assuming this runs on each
individual person's machine … stop assuming that it runs inside of a Git
repo … prep this to be a SaaS hosted in the cloud play." Future rulings
should be biased by this. It is an intent, not a plan: no hosted build
exists, and no hosting work is scheduled by this card.

## WHY

The persona map ([[../_index/Reference - Persona Map]]) puts much of the
suspected buyer value — distribution, analytics, permissioning, audits —
on the far side of a hosted offering; the call sketched a hosted ladder
(distribution → analytics dashboard → model-change audits). The recent
architecture already leans this way without saying so: the
machine registry separated "the server" from "a workspace directory,"
project-scoped APIs made the server multi-tenant-shaped in miniature, and
the CLI-doors direction (structured data behind CLI/API doors, events as
witness) keeps every mutation behind an interface a remote client could
call. Recording the intent here is what makes the bias legible when the
next ruling has a hosted-friendly and a hosted-hostile option.

## HOW

When a design choice arises, prefer the option that does not hard-assume
a local filesystem, a personal machine, or an enclosing git repo —
without building hosted features ahead of demand (D8 still applies). This
card records the direction so cards and proposals can cite it; it grants
no license to add hosting machinery.

Verified: quote and framing from
`docs/sources/2026-08-03-danvers-catchup-product-notes.md` ("Hosted ASAP
as architectural intent" and the hosted-offering-ladder positioning
note). No code claim made.
