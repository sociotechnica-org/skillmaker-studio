# Business-model brief — three tiers, one custody boundary

> Prepared 2026-07-15 for the CTO conversation (currently on vacation).
> Status: **thesis, not ruling.** The director's framing: the business
> model isn't baked anywhere yet; hosted is directionally necessary to
> monetize well, but its path and economics are unknown. This doc
> exists so that conversation starts from a written thesis instead of a
> whiteboard.

## The three tiers and their jobs

### 1. OSS free tool (exists today)

**Job: demand instrument and distribution — not a revenue line.**
Free, MIT, local-only, no account. In pull terms it's how we test the
demand bet (install → adopt → run+grade → return unprompted). In
sales-process terms it's rung one of the buying process. It stays free
forever; the moment it's gated, we lose both the demand telescope and
the "declining to run it is the weird move" pitch.

### 2. Consulting / services (sellable now)

**Job: revenue today, case-study factory, and paid discovery for
hosted.** Test, maintain, design, scale, and portfolio-ify companies'
skill estates. Three facts make this the immediate motion:

- We are already doing it unpaid — the design-partner program is
  consulting with the invoice deleted. Naming it changes nothing
  operationally.
- It requires zero product build (the framework's constraint: never
  recommend what requires building product).
- Every engagement is discovery for tier 3: who the enterprise buyer
  is, what the multi-player project looks like, what they'd pay —
  learned on their dime, before we build hosted.

Pricing posture (framework, pricing dimension): anchor against the
project the skills ride under, not against our effort — a skill
portfolio under a seven-figure agent initiative makes hands-on custody
work a rounding error. Present 1–2 options, pause. Frame the program as
structured and selective ("a small first round"), never desperate.

### 3. Hosted / enterprise multi-player (hypothesis)

**Job: the eventual monetization center — currently an unproven demand
bet.** The pull evidence we already hold is all multi-player:

- The founder's partner's company: ~30% of the job is schlep across
  four workstations; skills fork and drift *by accident*; "no way to
  run a business."
- Jerry the Jerk is a multi-player failure (same-name mutation, blame
  with no attribution, wrong-model execution).
- Vector 3 in the pull bets ("stand up our team's blessed skills
  marketplace") — medium intensity, growing wave, bigger buyers.

**The natural open-core boundary is custody scope:**
*single-player custody free forever; shared custody is what teams pay
for.* Multi-seat visibility, merge/fork discipline, org-wide receipts,
access control, the blessed skill bank. This boundary is honest (it
matches where the free tool genuinely stops helping) and it maps to the
priced problem ("more cooks, worse infrastructure").

## The tension that needs the CTO

**"Phones nothing home" is a product pillar and a brand promise; hosted
is a server.** These are reconcilable but only deliberately:

- The promise can evolve to *"local and free forever; hosted for teams
  who want shared custody"* — but the wording must be chosen, not
  drifted into, or the honesty brand (our differentiator) takes the
  hit.
- Architecture question for the CTO: is hosted a sync layer over the
  git-native journal (skills stay in their repos, the service holds
  shared state/receipts), or a full remote workspace? The former is
  more consistent with the pillar; economics differ radically.

## Open economics questions (for the CTO)

1. Unit: per seat, per skill under custody, per eval-run compute, or a
   platform fee + committed spend (the framework suggests committed
   spend so value extraction survives personnel changes)?
2. Where does eval compute run and who pays for model tokens? (This is
   the dominant marginal cost and it's usage-shaped.)
3. What's the smallest hostable thing that tests tier-3 demand — a
   shared receipts viewer? org-wide drift dashboard? — before a full
   multi-player studio?
4. Does consulting revenue fund the hosted build, and do design-partner
   contracts pre-commit them as hosted charter customers?

## What the site does meanwhile (already ruled)

Per the site strategy and the framework's roadmap rule ("coming soon"
signals *not ready*): hosted appears on the site only as a discovery
channel — *"Running skills as a team? We're designing the multi-player
studio with a handful of companies. Talk to us."* Every response is a
tier-3 demand data point, collected through the only funnel instrument
the no-telemetry constraint leaves us: conversations and public
artifacts.
