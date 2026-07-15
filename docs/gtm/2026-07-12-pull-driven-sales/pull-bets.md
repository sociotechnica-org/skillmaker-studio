# Pull bets — the demand landscape

The method: demand is a project on the buyer's to-do list that exists
whether or not we do. We don't pick who we'd *like* to sell to; we find
the situations where declining our product would be the weird choice.
Each candidate framing below is an **attack vector** — a thesis about what
people are actually trying to get done when Skillmaker becomes relevant.

## Attack vectors, scored

Scored on Snyder's two demand-intensity criteria:

- **C1 — priority likelihood:** how likely is this project to be a
  buyer's #1 priority *right now*? (project frequency × wave)
- **C2 — magnitude of difference:** when they line up their real options,
  how much better do we fit than the alternatives they'd consider?

| # | Vector (the buyer's project, their words) | C1 | C2 | Notes |
|---|---|---|---|---|
| 1 | "The model changed — verify our skills still work / port them" | **High (wave)** | **High** | Re-fires on every model release and provider switch. Alternatives: eyeball reruns, hand-rolled harness. |
| 2 | "I inherited / vendored skills I didn't write — decide what to trust" | **Med-high** | **High** | Fires on every handover, vendoring, or marketplace import. `adopt` is the zero-restructuring door. |
| 3 | "Stand up our team's blessed skills marketplace" | Med (growing wave) | Med-high | Fewer buyers, bigger ones. Publishing side partly best-effort (codex manifest). The marketplace thesis says this is the long-run usage center. |
| 4 | "A skill misbehaved downstream — figure out what happened, stop it recurring" | Med (event-driven) | High | Not a standing project; it's the *trigger* that makes 1 or 2 unavoidable. Use in messaging, not targeting. |
| 5 | "Maintain a public skills repo people can trust" | Low (small population) | High | Small N, but these are the toll-booth owners and word-of-mouth engines. gstack hand-rolled 10 CI workflows incl. scheduled evals — an existence proof that this demand is real enough to build a bespoke factory for. |
| 6 | "Design a brand-new skill properly, from scratch" | **Low** | Low-med | Nobody's Trello card says "author a skill with receipts." This is supply-side framing — our current default — and it's the vector we should stop leading with. |
| 7 | "Get me a really good version of this skill" — **the commission** | Med-high | **High** | *Added 2026-07-15.* The buyer project that was hiding under dead vector 6: on the hook, to someone else, for a skill that has to be good. Founder-testified (the Alexandria story). Every persona is this sentence with a different subject — boss, CFO, the org, the model vendor's schedule. See [`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md). |

## 2026-07-15 update — the opener workshop

A live session with the director reworked the *opener* (which moment we
lead with) without discarding the vectors above. Outcome, in brief:

- **Vector 4 got promoted from trigger to opener** — generalized from
  "a skill misbehaved" to the inevitability form: *agents do unexpected
  things; that's the point; it's also YOUR problem.* Weirdness (quiet,
  graded, blames the owner) is the majority-felt form of the
  procedural-risk insight, and inevitability needs no education and no
  luck about who's been burned.
- **Vector 7 (the commission) rehabilitates the project under vector
  6** and becomes the strongest fan-out card and the conversation
  opener for people mid-commission.
- **Vectors 1+2 remain true and become Situations cards / fan-out
  lines** rather than the H1, pending a director ruling on the hero.
- New category name: **commercial-grade skills.** New positioning vs.
  eval benches: **custody, not scoring.**

Full record — locked copy, the Braintrust contrast, kills, and the
tests that must pass before any of it hardens — in
[`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md).

## The primary bet: vectors 1 + 2, one motion

Vector 1 supplies the **urgency** (a wave: model releases keep coming and
skills tuned on the old model silently rot). Vector 2 supplies the
**entry motion** (`skillmaker adopt` on the repo they already have — no
files moved, no restructuring, evidence within the hour). In practice
they compose into one repeatable case study:

> *Skills you already depend on. A change you didn't schedule. Adopt in
> place, measure on the real agent, and know — with an n, a pass rate,
> and a confidence interval — which skills survived.*

### The PULL grid

- **P — Project:** "Move our agent setup to the new model / roll these
  inherited skills out, without breaking the workflows that ride on
  them."
- **U — Unavoidable:** the change is on someone else's schedule — model
  deprecation, org mandate, cost pressure, the previous owner is gone —
  or a skill already failed visibly downstream and someone is asking
  what else is broken.
- **L — Looking:** rerun a few prompts by hand and eyeball; hand-roll an
  eval harness + CI; generic LLM-eval platforms; do nothing and hope.
- **L — Lacking:** eyeballing doesn't scale past a few skills and leaves
  no record anyone else can trust; a hand-rolled harness is a side
  project someone now owns forever; generic eval tools measure prompts
  and API calls, not skills inside real claude-code/codex sessions, and
  don't pin measurements to skill versions; hope finds out in
  production.

### Honesty note

The wave claim ("model releases force re-validation at scale") is a
**hypothesis**, not a finding. Our stories 2 and 5 simulate this demand;
no external buyer has confirmed it yet. Per the method, we test it by
selling — see the toll booths in
[`outbound-and-conversations.md`](outbound-and-conversations.md) — not by
polishing the deck.

## The ICP, reframed

Not "who we want to sell to" — who would be **weird not to install**:

**A certain kind of person:** a developer or team lead who owns a repo of
roughly five or more skills that other people or scheduled agents
actually depend on, and who has been burned at least once ("it quietly
broke and we found out downstream").

**In a certain kind of situation:** a model/provider change is happening
on a schedule they don't control, or they just took ownership of skills
they didn't write, or they've been told to publish a blessed set to the
team.

For that person in that situation, the ask is one curl and one command on
a repo they already have, from a free local tool that phones nothing
home. Declining to run it is the weird move. If we're regularly meeting
people who match this description and they *don't* pull, the bet is
wrong and we should say so out loud.

## What we deliberately don't lead with

- **Greenfield authoring** (`skillmaker new` as step one). It's real and
  it works, but it's our supply-side default framing and nobody's urgent
  project. It stays on the site; it stops being the front door.
- **The non-technical desktop audience.** Per the desktop-app thesis,
  that's a different product blocked on distribution rails we don't
  control. Not a sales target now.
- **"AI-curious tourists."** Unchanged from the voice guardrails.

## How we'll know (pull signals)

- Installs → adopts **on the call** (the Stripe-link test).
- Unprompted second sessions, issues about *their* measurements, a
  `.skillmaker/` directory appearing in a public repo we didn't touch.
- The contrast log (see outbound doc): every conversation recorded as
  bought-fast / slow / didn't, revisited monthly. The answer to "who is
  our real ICP" will be in the contrast, not in this document.
