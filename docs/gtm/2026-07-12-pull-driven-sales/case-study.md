# Case-study selling — what we can honestly show

Pre-PMF, the sale is a case study: proof we understand the job, told as
"someone like you, in your situation, and here's what measurably
happened." We are at the **Innovator** stage — founder-led conversations,
no brand, no external customers — so the case studies must be first-person
and scrupulously labeled.

## The evidence inventory (today, v0.2.1)

What we can claim, with its honest frame attached:

1. **Adopt works on real, messy public repos.** `skillmaker adopt` was
   QA'd against real skills repos: **gstack 59/60 adopted, and the one
   failure is explainable; mattpocock/skills 39/39.** These repos have
   wildly different layouts (flat dirs, category trees, codegen'd
   SKILL.md, deprecated/ subtrees) — documented in
   [`target-repos-brownfield.md`](../../research/2026-07-11-competitive-scan/target-repos-brownfield.md).

2. **The adopt → measure → revise → re-measure loop closed, with real
   numbers.** From the story-1 rerun
   ([friction log](../../phase20/story-1-rerun-friction-log.md)): a
   hand-written skill adopted from a repo measured **67% [21%, 94%] at
   n=3**, was revised, and re-measured **100% [44%, 100%] at n=3** — both
   cells labeled **"below smoke"** by the product itself so nobody
   over-trusts n=3. Frame: *our own be-the-user QA persona, not a
   customer.* The quotable line from that log: "The measurements table is
   the product thesis in one screen."

3. **The product ships itself through its own factory.** William, the
   studio's skill-writing agent, produces skills through the same gated
   loop any bundle uses. The recursion is the proof of use.

4. **The process catches real failures.** The be-the-user loop found
   three P1 bugs at v0.1.0 (including adopted bundles silently measuring
   a naked agent — a measurement-integrity bug) and independently caught
   a P0 credential leak before it landed in git history. All fixed and
   verified not to recur at v0.2.1. Frame honestly and it becomes a
   strength: *the product's own QA is run the way we tell you to run
   skills — adversarially, with logs.*

5. **The demand existence proof.** gstack maintains 10 GitHub Actions
   workflows, including scheduled skill evals and golden-file tests —
   a team that felt this problem hard enough to hand-build the factory.
   That's the "teams who feel this hand-roll their own eval CI" line on
   the site, with a named referent.

## What we do NOT have

External, named, third-party case studies. Zero. Nothing in our materials
may imply otherwise — no logos, no "teams use Skillmaker to…", no
paraphrasing QA personas as customers.

## The case-study shapes (one per vector)

Templates to fill with the first real design partners. Structure per
Phil Green: situation → project → options considered → what happened →
measured outcome.

- **Model change (vector 1):** "___ had N skills tuned on ___. When ___
  shipped, they adopted the repo in place, ran fixtures per skill on both
  providers, and found K skills below their old pass rate. They revised
  those, re-measured, and shipped the port in ___ days with receipts."
- **Inherited skills (vector 2):** "___ took over a repo of N skills
  written by someone who'd left. Reading them said what they did, not
  whether they worked. Adopt + fixtures gave a trust list in an
  afternoon: M keep, K fix, J archive — each with a number attached."
- **Team marketplace (vector 3):** "___ published their team's blessed
  skill set as a marketplace. Every skill cleared a review gate and
  carries its design doc and measurements, so 'why do we trust this one'
  stopped being a Slack thread."

## The design-partner motion

The #1 sales job right now is converting 3–5 people who match the ICP
into real, named case studies. The offer, honestly stated:

> Pre-alpha, free, local-only. If your skills are load-bearing, we will
> personally sit with you (or work your public repo ourselves) until
> every skill you care about has an honest measurement — and we fix what
> the process breaks on. In exchange: your friction log, and if it works,
> your story with your name on it.

Selection criteria: they're in the situation *now* (a model change or
handover pending, not hypothetical), the skills have downstream
dependents, and they'll take a call. Someone who is merely enthusiastic
about the idea is a newsletter subscriber, not a design partner.
