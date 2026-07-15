# Site strategy — the Structure C spine (2026-07-15)

> Supersedes the section-level addenda in [`website.md`](website.md) as
> the copy source of record for the marketing site. Synthesizes two
> methods that independently converge for our buyer: Snyder's
> infomercial grammar (the opener workshop,
> [`opener-workshop-2026-07-15.md`](opener-workshop-2026-07-15.md)) and
> the Keller GTM framework (Shapiro skeleton, Wiebe copy, Dry
> specificity, Schwartz awareness levels — reference copy in
> `.context/mike-keller-gtm-framework.md`, not committed). Voice
> guardrails from the original marketing copy still bind every word.

## The ruling: our buyer is Schwartz Structure C

**Symptom-aware, cause-unaware.** The diagnostic, run against our own
workshop findings:

- Name the symptom ("your agent did something weird") → "yes, that's
  exactly my experience." Universal wince.
- Name the root cause (custody: unversioned, unmeasured,
  stable-but-wrong skills) → "huh, I hadn't thought about it that way."
  Most skill authors don't test for procedural failure at all.
- The coping mechanisms are famous and plateau: tighter prompts,
  eyeball reruns, hand-rolled CI harnesses, an eval bench in another
  tab.
- We (the founder) went through the coping mechanisms and hit the
  ceiling — the Alexandria story is the peer-credibility credential.

Structure C's sequence is the infomercial grammar with staging
discipline added: symptom hero → peer credibility → validate the coping
mechanisms → root-cause reveal → after-state → product → how → fan-out
→ one CTA. Nothing from the opener workshop is discarded; every ruled
line gets a slot.

## History note (why a teardown, not another graft)

The site accreted four layers under two strategy regimes (see the
archaeology in this doc's git PR): a supply-side Shapiro skeleton
(2026-07-10 copy doc → PR #11), a reactive Why section (PR #57), the
pull rework (07-12), and the weirdness workshop (07-15). Result: three
cold opens, supply organs written for a dead H1, and no relief beat.
Rule going forward: **no more grafts** — every section holds exactly
one beat of the spine below, or it dies.

## The spine and the copy (source of record)

Page order:

```
Hero → Credibility → Coping → Insight → AfterState → Product(VsTheBench)
     → HowItWorks → Situations → Receipts → Faq → FinalCta
```

Killed: Pillars, Features, Why (Why's burn language is absorbed by
Coping/Insight; Pillars/Features content survives in git history and in
the original marketing-copy.md).

### 1 · Hero — the symptom, their language

- H1 (ruled): **Agents do unexpected things. That's the point. It's
  also YOUR problem.**
- Sub: *Your agent will do something weird this week. No crash, no
  error — just off. And it's on you.*
- The custody/supply sentence is **removed from the hero** (Structure
  C: the product enters late, after the insight is earned).
- Install panel stays (judgment call per the framework: symptom-aware
  buyers aren't cold; the panel is also the honesty signal).

### 2 · Credibility bar — peer form + exact numbers

> We've lived this. Our first commercial-grade skill was a 17-step
> process built across four tabs, an eval bench, and a spreadsheet —
> and we still lost hours a week hunting for work we'd already done. We
> built Skillmaker because that was no way to ship.

Numbers strip (Dry: exact, not rounded): *Adopted 59/60 skills in place
on real public repos · 39/39 on the second sweep · zero files moved.*

(Not the killed founder ad-line: no claim about how fast the product
was to build — only that we lived the coping mechanisms.)

### 3 · Coping mechanisms — validate, then show the ceiling

Intro: *You've adapted — everyone shipping skills has. The adaptations
are real, they help, and we used every one of them. Here's where each
one plateaus.*

| Coping mechanism | It helps | Where it plateaus |
|---|---|---|
| Tighter prompts, sharper SKILL.md | Fewer weird runs this week | The instructions are tuned to a model that gets replaced on someone else's schedule |
| Rerun it a few times, eyeball the output | Catches the obvious | Doesn't scale past a handful of skills; leaves no record anyone else can trust |
| A hand-rolled eval harness in CI | Real engineering, honest intent | A side project someone owns forever — and it still doesn't know what a skill version is |
| An eval bench in another tab | Real scores | Scores what you thought to ask, once, on a copy you now keep in sync |

Kicker: *They all treat the symptom — this output, this run, this
scare. The cause is one level down.*

### 4 · The insight — the custody reveal (hardest section)

Eyebrow: *the root cause*. H2: **Nobody has custody of the skill.**

> Connect the dots. The weird runs, the hunting for lost work, the
> blame that can't be resolved, the plateau of every fix you've tried —
> they're one problem wearing four costumes. The skill is the part of
> your agent you can actually operate on. And today it lives as a bare
> file: no version that binds to evidence, no measurement from the
> sessions where it actually runs, no trail from the choices inside it
> to the reasoning behind them.
>
> Which allows the failure nothing in your stack can see: a skill
> that's perfectly stable and still wrong — running clean, scoring
> green on what you thought to ask, and quietly not doing the job at
> the level the job requires.
>
> Meanwhile the ground moves. Models change constantly. Should your
> skill change with them? Did it already break? You don't just lack the
> answer — without custody, you don't know what you'd need to know.

Kicker: *That's not a tooling gap. It's a custody gap.*

### 5 · After state — the relief beat, symptom by symptom

Eyebrow: *with custody*. H2: **What changes when someone owns the
skill.** Product name deliberately absent (experience terms only):

- *The weirdness surfaces on your terms.* A number moved on a dashboard
  you check — not in a customer thread you dread. You knew first.
- *Blame resolves in one look.* The version you shipped passed on the
  model it was rated for; the thing that failed was a mutation on a
  model it never met. Thirty seconds, settled.
- *The hunting stops.* The research, the versions, the evals, and the
  reasoning live where the skill lives. Nothing orphaned, nothing in a
  tab you can't find.
- *Fixes happen on an operating table.* Trail back to why, change the
  process — not just the prompt — and re-measure on the spot.

### 6 · Product — supply sentence + the bench contrast

Now (and only now) the product. Eyebrow: *the studio*. H2: **Where
commercial-grade skills live.**

> Skillmaker Studio is where commercial-grade skills live — designed,
> versioned, measured in real agent sessions, and repaired when they
> drift. One surface, plain English, on the repo you already have.

Then the existing contrast block as an h3 ("The score is the easy
part.") with the five-row table and the scoped Braintrust honesty line
— unchanged from the workshop.

### 7 · How it works — the adopt-first motion, 3 steps

Replaces the greenfield `init/new/advance` cards and transcript (that
was the demoted front door).

1. **`skillmaker adopt`** — Point it at the repo you already have.
   Nothing moves, nothing restructures. Your existing skills become
   measurable in place.
2. **Decide what good means.** Design evals where the skill lives — our
   agents help you choose what to test and build the fixtures, in
   plain English. No eval background required.
3. **`skillmaker run`** — Read the receipts. Run against the real agent
   enough times to get a real number — n, pass rate, confidence
   interval — pinned to the exact skill version and model that earned
   it. When the number moves, you know first.

**Honesty TODO:** the terminal transcript in this section must be
re-captured from the real CLI before any public deploy (PR #11 set the
real-output standard). The rebuilt block is labeled in-source with a
TODO comment until then.

### 8 · Situations — the fan-out (unchanged this pass)

Already does the "other times you have this pull" job. A later pass may
add the two workshop fan-out lines (first commercial-grade skill due; a
teammate's version wearing your skill's name).

### 9 · Receipts — evidence only

Keeps the honest-numbers table, the "below smoke" refusal, and the QA
links. The design-partner CTA and the closer band **move to FinalCta**
(one-CTA discipline: Receipts stops asking for anything).

### 10 · FAQ — objections (unchanged)

### 11 · FinalCta — one action, three doors

Restate: *Your agent will do something unexpected — that was never in
question. Whether you find out first is the part you can choose.*

- **Door 1 (primary, terminal block):** the install curl +
  `skillmaker adopt`. Caption: *Free, local, phones nothing home.
  Ninety seconds on the repo you already have.*
- **Door 2 (design partners = consulting, selectively framed):** *Want
  hands-on help? We're working with a small first round of design
  partners — testing, maintaining, and scaling real skill portfolios
  with the teams that own them. Open an issue and tell us what broke.*
- **Door 3 (hosted discovery channel — NOT "coming soon"):** *Running
  skills as a team? We're designing the multi-player studio with a
  handful of companies. Talk to us.*

Closer: *We can't make your agent predictable — nobody can; that's what
you hired it for. We can make sure nothing drifts silently, nothing
fails anonymously, and nothing stays wrong.* Kicker, emphasized: **The
only thing you risk is finding out.**

## Rulings embedded here

1. **CTA:** self-serve adopt is primary (overrides the framework's
   human-touchpoint default — our no-telemetry constraint makes the
   issue tracker the funnel, so doors 2–3 route there).
2. **Solution timing:** product enters at section 6, not the hero
   (Schwartz over infomercial pacing — a page is skimmed, not watched).
3. **No roadmap on the page:** the hosted tier appears only as the
   door-3 discovery line (framework rule: "coming soon" signals "not
   ready").

## Open tests (unchanged from the workshop, now doubly load-bearing)

The out-loud test (three humans, count winces), the agent→skill bridge
seam, the first-timer side door. The insight section (4) is the one the
framework warns must come from voice-of-customer, not a copywriter —
if the out-loud test returns polite nods, section 4 is what gets
rewritten first.
