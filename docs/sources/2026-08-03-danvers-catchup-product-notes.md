# Source: Jess × Danvers catch-up — product-relevant notes (2026-08-03)

*Extracted from the transcript of the first post-vacation catch-up call.
Product-relevant portions only — the company/biz-dev strategy half of the
conversation belongs in the company repo per the federated-library split
ruled on this same call (company repo = company library; this repo = the
product library). Frozen provenance: quotes are near-verbatim; framing is
the extractor's (Raven).*

## Rulings and directions stated on the call

- **Federated library split.** Skillmaker Studio is an open-source public
  repo with its own (product) context library. Company library and
  company skills live in the private company repo. Danvers's from-scratch
  product use will target the company repo ("start it up in the company
  repo and say, all right, time to build some skills").
- **Hosted ASAP as architectural intent.** Jess: "all of the decisions
  that I've been making architecturally over the last two weeks have
  been moving us towards a path where we can be hosted ASAP … stop
  assuming this runs on each individual person's machine … stop assuming
  that it runs inside of a Git repo … prep this to be a SaaS hosted in
  the cloud play." Future rulings should be biased by this.
- **Danvers = user #2, starting now, from scratch.** "15 minutes of
  asking an agent what's going on … then basically try to start from
  scratch." He will file problems as tickets/user stories as he goes.
- **Fabro factory for skillmaker-studio** to be stood up; its
  instructions given to the Discord steward agent; Raven to be taught
  about the factory so issues flow to it "done the right way."

## The persona map (drives which features get emphasized)

Full-lifecycle framing: research → skill writing → evals → publish →
**distribution → analytics → permissioning → cost tracking → audits**.

- **Ops / legal / consistency-minded**: want the product to WRITE skills
  (with them participating in research: "at our company we do it this
  way"); predictability is the value.
- **Technical buyers** (prompts-in-production, neck on the line): evals
  and the lifecycle; the early-adopter profile. "Help them solve an
  emergency, then help them build a system so the emergencies stop
  happening."
- **Non-technical / operational buyers**: distribution ("stupid simple
  one-click ways to get skills on their laptop"), analytics (installs,
  runs, power users), cost ("how much money am I saving") — may not care
  about evals at all: "Didn't the AI write the skill? … Don't overwhelm
  me with this eval stuff."
- Jess: "we're definitely leaning heavily on skill writing and skill
  evaling right now, but I'm not even sure those are the most valuable
  parts of the product that people are gonna care about."
- Danvers: some buyers "care very much about the front end of the
  product [who] maybe didn't even know that an eval was a thing" —
  teaching burden is real; evals is "the most technical part of the
  product."

## Demand evidence for the cut distribution loop (D1/D8 watch)

The simplification cut Ship/Receive pending demand evidence; the adopted
Vision card says the frozen `skill.shipped`/`skill.field_report` events
"will be waiting in history" if demand rebuilds a distribution loop.
This call supplied the demand THESIS (not yet user demand):

- Distribution: central org repository, marketplace/plugin rollout
  (Claude marketplace; Codex now supports it), one-click installs.
- Analytics: hosted endpoint counting skill runs/installs; "who your
  power users are"; feeds sales pitches and cost reporting.
- Receiving dock revived: with access to org session logs, "we can
  actually do far more than just say yes or no whether the skill ran …
  and use that to inform the eval set."
- Permissioning: "these five people should be able to edit this skill" —
  nothing on the market for skill-level permission → distribution.
- Audits as recurring revenue: model releases are "the weather" —
  re-run evals against new/cheaper models, sell the scorecard.

## The slab (provenance/trust play) — aligns with the publish stamp

Danvers: a skill does or doesn't have "a Skill Maker baseball card …
like whether a collectible is slabbed … you know what it is, it hasn't
been tampered with, you can trust it. Not counterfeit." The publish
provenance stamp (version hash, date, evidence line atop every installed
copy) is the embryo of exactly this. Campaign idea attached: put evals
around popular skill repos and publish the scorecards ("Skill Maker said
we're a top ten skill repo").

## Positioning notes that touch product

- "Selling insurance, not rocket ships" — volatility (model releases,
  price swings, provider instability) is the weather that makes the
  insurance valuable. Product surfaces that SHOW stability/regression
  (evals, audits, scorecards) are the insurance artifacts.
- Alexandria repositioned as "just the library — a wiki with built-in
  employees"; Skillmaker may "earn an Alexandria eventually." Consulting
  line item: skills perform measurably better with a library ("we
  actually have the evals to show you how it will perform differently
  with and without a library").
- Hosted offering ladder: distribution (S) → analytics dashboard (M,
  "$50/month … literally no work for us") → model-change audits (L,
  high-margin). Open source is itself the technical-vetting strategy
  ("easier for us to pass the technical bar if we're open source").
