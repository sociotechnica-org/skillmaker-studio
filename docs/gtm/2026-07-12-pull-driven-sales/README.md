# Pull-driven sales — GTM package

> Prepared 2026-07-12. Applies Rob Snyder's "Finding Pull" method (demand ≠
> desire for our supply; buyers pull when a Project is Unavoidable and the
> options they Look into are Lacking) to Skillmaker Studio. Everything here
> is a draft for director review, written under the same voice guardrails as
> [the marketing copy](../../plans/2026-07-10-playmaker-to-skillmaker-migration/marketing-copy.md):
> never claim measurement that hasn't happened.

## The one-line demand bet

A developer who owns agent skills that other people (or scheduled agents)
depend on, at the moment a **model change** or an **ownership change**
forces the question *"which of these still work?"*, whose only options are
eyeballing reruns or hand-rolling an eval harness, **cannot not try** a
free, local, no-account tool that adopts their repo in place and returns
honest per-skill measurements.

That is a testable claim about reality. The job of this package is to say
where we test it, on whom, and what counts as pull.

## Contents

- [`pull-bets.md`](pull-bets.md) — the demand landscape: candidate attack
  vectors scored on demand intensity, the primary bet's PULL grid, the ICP
  reframe ("who would be weird *not* to install"), and what we deliberately
  don't lead with.
- [`case-study.md`](case-study.md) — case-study selling for the Innovator
  stage: what evidence we honestly have today, the case-study shapes per
  vector, and the design-partner motion that produces the first external
  case studies.
- [`outbound-and-conversations.md`](outbound-and-conversations.md) — the
  toll booths, outbound message drafts (including the "receipts drop"),
  the sales-conversation guide, and the pull instrumentation (contrast
  log).
- [`website.md`](website.md) — what changed on the marketing site and the
  pull rationale per section; the copy source of record for the new
  components.
- [`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md) — the
  live opener/closer workshop: the weirdness pull ("Agents do unexpected
  things… it's also YOUR problem"), the commission vector, the
  commercial-grade-skills category, custody-not-scoring positioning vs.
  Braintrust, the kills, and the tests before any of it hardens.
- [`site-strategy-2026-07-15.md`](site-strategy-2026-07-15.md) — the
  Structure C ruling (symptom-aware/cause-unaware buyer) and the full
  page spine with copy source of record; supersedes `website.md` for the
  site. Synthesizes the infomercial grammar with the Keller GTM
  framework (Schwartz awareness levels). "No more grafts."
- [`business-model-brief.md`](business-model-brief.md) — thesis for the
  CTO conversation: OSS as demand instrument, consulting as revenue-now,
  hosted multi-player as hypothesis; the single-player-free /
  shared-custody-paid boundary and the phones-nothing-home tension.

## What "buying" means here

The product is free, MIT, local-only. The conversion ladder that replaces
a Stripe link:

1. **Install** during or right after the conversation (one curl).
2. **Adopt** their own repo (`skillmaker adopt` — in place, no files
   moved).
3. **Run + grade** at least one fixture on a skill they care about.
4. **Return** unprompted — a second session, an issue, a question about
   their own measurements.

Rung 4 is the dam-burst signal. Rungs 1–2 on the call are the equivalent
of "offering the Stripe link": if someone in the claimed situation won't
spend ninety seconds adopting their own repo, their demand was a damn lie,
and that's data.

## The constraint that shapes everything

No server, no account, no telemetry is a product pillar — which means we
cannot watch a funnel. The only demand instrument we have is
**conversations and public artifacts** (issues, PRs, their repo gaining a
`.skillmaker/` directory). Snyder would call this a feature: it forces the
1:1 sales conversations where pull is actually visible.
