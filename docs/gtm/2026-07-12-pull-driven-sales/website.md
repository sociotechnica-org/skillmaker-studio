# Website — the pull-driven rework

> Copy source of record for the 2026-07-12 marketing-site changes, and the
> demand-side rationale per section. Extends (does not replace)
> [`marketing-copy.md`](../../plans/2026-07-10-playmaker-to-skillmaker-migration/marketing-copy.md);
> its voice guardrails still bind every word here.

## What changed and why

The site was well-made but supply-side: hero → why → pillars → how →
features. Everything described the product; nothing met a buyer inside
their own project. The pull principle applied: a visitor in the primary
bet's situation should hit *their moment* — in their words — within one
scroll, and the evidence should be shown, not asserted.

New page order:

```
Hero → Why → Situations (new) → Pillars → HowItWorks → Receipts (new) → Features → Faq
```

## Situations (new section — the attack vectors, demand-side)

Section intro: "Skillmaker isn't for admiring the skill you just wrote.
It's for the three moments when 'seems to work' stops being an answer."

Three cards, each a situation in the buyer's second person, ending in the
command that is that situation's door:

1. **"A new model just shipped."** → `skillmaker run` — vector 1
   (re-earn skills after a model change; the wave).
2. **"You inherited skills you didn't write."** → `skillmaker adopt` —
   vector 2 (the zero-restructuring entry motion; carries the honest
   adopt numbers 59/60 and 39/39).
3. **"Your team is standardizing on skills."** → `skillmaker publish` —
   vector 3 (the marketplace bet).

Deliberately absent: greenfield authoring as a "moment." `skillmaker new`
remains in HowItWorks, but per the pull bets it is no longer a front
door.

## Receipts (new section — case-study selling, honestly)

Pre-PMF case-study selling with zero external customers means the only
honest case study is our own. The section:

- says outright we have no customer logos ("pre-alpha, no customers
  yet"),
- shows the real story-1-rerun measurement table (67% [21%, 94%] n=3 →
  100% [44%, 100%] n=3, both "below smoke"), linking to the QA logs in
  the repo,
- turns the caveat into the pitch: "the product refuses to let you
  over-trust the numbers, even when they flatter us. That refusal is the
  product,"
- ends in the pull-capture CTA: design partners via GitHub issues
  ("open an issue and tell us what broke"). This is the site's toll
  booth until there's anything better.

Update rule: the moment a real external case study exists, it replaces
our own QA numbers here. Until then, nothing on this section may imply
third-party usage.

## FAQ addition

Added the top objection from the adopt motion: *"We already have a repo
full of skills. Do we have to restructure it?"* — answered with adopt's
in-place behavior and the QA'd repo numbers. This is the objection that
kills rung 2 of the conversion ladder if unanswered.

## Left alone, on purpose

- **Hero H1** ("Ship agent skills with receipts.") — a ruled director
  decision; not overturned unilaterally. If a demand-led hero is wanted,
  candidates for ruling:
  - H1: *A model update just broke a skill you depend on.* / Sub: You
    found out downstream. Skillmaker exists so next time you find out
    from a pass rate.
  - H1: *Which of your skills still work?* / Sub: After the model
    change. After the teammate left. Skillmaker answers with a number —
    n, pass rate, confidence interval — pinned to the version and model
    that earned it.
  - **2026-07-15, leading candidate** — see the addendum below and
    [`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md):
    H1: *Agents do unexpected things. That's the point. It's also YOUR
    problem.* (H1 copy director-ruled in the workshop; the *page swap*
    is still a ruling to make.)
- **Why section** — already demand-side (the burn moment); Situations
  builds on it rather than repeating it.
- **Pillars / HowItWorks / Features / install-first hero panel** — the
  supply story and the compression (product-at-the-top) are right as-is.

## 2026-07-15 addendum — the weirdness hero and the custody section

Drafts from the opener workshop, ready to implement once the director
rules the page swap. Copy source of record for both is
[`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md); this
section says only where they land on the page.

### Hero (candidate C — replaces "Which of your skills still work?")

- **H1:** *Agents do unexpected things. That's the point. It's also
  YOUR problem.*
- **Sub (pick by out-loud test):** *Your agent will do something weird
  this week. No crash, no error — just off. And it's on you.* — or —
  *Sometime this week, your agent will be weird in front of someone who
  matters. Nothing will error. And it's on you.*
- Install panel stays beside it, unchanged.
- If this ships, the model-change moment doesn't vanish — it's already
  the first Situations card, which is its right altitude.

### New section: "The score is the easy part" (vs. the bench)

Placement: after HowItWorks, before Receipts — the visitor who knows
eval benches exist asks "how is this different?" right after seeing how
it works (the Breathe Easy contrast move).

- Lede: *An eval platform tells you the score. It can't tell you what
  to test, which version earned the number, why it drifted, or how to
  fix it. That's the other 90% of the job.*
- Body: the five-row contrast table from the workshop doc (what should
  I test / is the tested thing the shipped thing / which version earned
  this number / why did it drift / now fix it).
- Scoped-honesty line, verbatim: instrumenting an API product with an
  eng team? Braintrust is genuinely good at that. Our claim: *if you're
  on the hook for skills that ride inside agents, a bench in another
  tab is the schlep, not the solution.*
- No competitor logos, no feature-count slugfest — pull-relevant rows
  only.

### Closer (footer band or end of Receipts)

> We can't make your agent predictable — nobody can; that's what you
> hired it for. We can make sure nothing drifts silently, nothing fails
> anonymously, and nothing stays wrong. Free, local, phones nothing
> home. One command on the repo you already have.
>
> *The only thing you risk is finding out.*
