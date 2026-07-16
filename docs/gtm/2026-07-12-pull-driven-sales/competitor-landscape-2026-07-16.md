# Competitor landscape — who speaks to which pain, and their footprint

**Date:** 2026-07-16
**Method:** Five parallel research agents, one per competitor cluster (hosted eval platforms, OSS eval tools, prompt-management CMSes, the skills-native ecosystem, and the DIY incumbent). Each read competitors' actual homepage copy and scored it against the seven verified pain lanes in [voc-language-research-2026-07-16.md](voc-language-research-2026-07-16.md), pulled footprint numbers with primary sources (GitHub API star counts, npm/PyPI download APIs, funding press), and mined their own users' complaints. A verification pass fact-checked 79 load-bearing claims: 62 confirmed, 8 close, 5 wrong (wrong ones excluded or corrected below), 4 unverifiable.

**Premise (director's framing):** one of the best ways to get new users is to be a better solution to a known problem — and the best way to know the problem is known is that people are already using something inferior for it. This doc maps both: what the inferior solutions claim, and what their users complain about.

---

## 1. The headline: two of our three HIGH-heat lanes are unclaimed by everyone

Coverage of our verified pain lanes across all five clusters, by their **headline marketing copy**:

| Pain lane (heat) | Eval platforms | OSS eval tools | Prompt CMS | Skills ecosystem | DIY doctrine | Verdict |
|---|---|---|---|---|---|---|
| agent-weirdness (HIGH) | **direct** (all 7) | direct/indirect | Latitude direct | indirect | indirect | **Crowded** |
| model-changed (HIGH) | none named | none named¹ | none named | Tessl indirect | indirect | **OPEN** |
| folklore/attribution (HIGH) | none | none | none | none | none | **WIDE OPEN** |
| maintenance-schlep (MED) | indirect | shallow | **direct** (home turf) | Tessl direct | direct (Hamel) | Contested |
| evals-vibes (MED) | direct | direct | direct-ish | direct | direct | **Most crowded** |
| skills-native (MED) | integration demos only | untouched | untouched | **direct** (catalogs + 2 test runners) | untouched | Emerging |
| team-drift (LOW) | RBAC features only | DeepEval-ish | direct | Tessl oblique | nominal (git) | Spoken-to, unfelt |

¹ The one direct articulation of model-changed anywhere — OpenAI Evals' README framing evals as necessary *because models change* — belongs to a tool its own maker is shutting down (Nov 30 2026).

**The strategic picture:** every competitor sells into the two *crowded* cells (weirdness-observability and evals-vs-vibes). Nobody's headline says *"the model changed under you — here's what survived"* and **nobody anywhere** sells the attribution answer — *was it the vendor, the skill, a teammate, or you?* — despite that being the highest-emotion lane in the VoC corpus ("I thought I was going crazy"). Every cluster's agent independently converged on the same conclusion: the **model-changed + attribution + skill-custody triangle is exactly our positioning and it is empty.**

Structural reason it stays empty: eval platforms and OSS graders are **trace-and-score architectures bolted onto artifacts they don't own**. They can show *that* a score moved, never *whose change* moved it, because they don't hold the skill's version history, model pins, and design rationale in one place. The custody gap isn't a missing feature; it's their architecture.

---

## 2. The consolidation finding — platform risk is now our talking point

In roughly twelve months the "measure your AI" category stopped being independent:

- **Humanloop** → acqui-hired by Anthropic (Aug 2025), platform **sunset with ~1 month's customer notice** (Sept 8, 2025).
- **W&B (Weave)** → acquired by CoreWeave (Mar 2025); evals now a side product inside a GPU-infra company.
- **Promptfoo** → **acquired by OpenAI (Mar 2026)** — the category's OSS leader (23.3k stars, 363k weekly npm downloads, "25%+ of Fortune 500") is now owned by a model vendor it's used to audit. Top HN comment on the announcement: *"enterprises using Promptfoo to audit OpenAI models are now relying on a tool owned by the entity being audited."* A vendor-neutral competitor (Tessera) launched the same quarter explicitly citing this.
- **OpenAI Evals** → being shut down by OpenAI itself (read-only Oct 31 2026, dead Nov 30 2026), users funneled to Promptfoo.
- **Langfuse** → acquired by ClickHouse (Jan 2026) instead of raising a Series A.
- **Galileo** → acquired by Cisco/Splunk (closed May 2026).
- **Vellum** → exited the category entirely (site now sells a consumer assistant; moderately confident).
- **Braintrust** — still independent ($80M Series B @ $800M, Feb 2026; Notion/Replit/Cloudflare logos) but suffered a **May 2026 breach forcing all customers to rotate API keys** — a custody-of-secrets incident at a company selling confidence.

**Implication:** a buyer adopting anything in this category now carries real roadmap/platform risk, and the "who audits the auditor" version of the folklore lane is live. Our **free, local, MIT, phones-nothing-home, on-your-own-repo** stance is the structural answer to both — the receipts live in *your* git history, and no acquirer can sunset them. This belongs in the objections/closer section of the site.

---

## 3. Cluster verdicts

### Hosted eval platforms (Braintrust, LangSmith, Langfuse, Freeplay, HoneyHive, Galileo, †Humanloop)

Trace-and-score infrastructure for eng teams. All speak fluent weirdness-observability and evals-vs-vibes. None name model-changed as an event, none touch attribution, and the two that mention "skills" (Langfuse, LangSmith) ship a *skill for driving their own product* — an integration demo, not custody of your skills. Watch this: it's the closest thing to counter-positioning found, and both have blogged "evaluating agent skills."

Footprint anchors: Langfuse 31.3k GitHub stars (OSS volume leader, now ClickHouse's); Braintrust $800M valuation, closed-source; LangSmith rides LangChain's ecosystem; Freeplay ~$2M revenue/~18 people; HoneyHive $7.4M raised; Galileo had Fortune-50 logos pre-Cisco.

Their users' gripes (our leads): LangSmith — *"only the engineers have access or spend time in it... any 'insights' are very canned"* and *"I built this because LangSmith needs a cloud account to see my own traces"* (HN, verbatim). Braintrust — free→$249/mo pricing cliff; the breach. Langfuse — steep learning curve, self-host ops burden (ClickHouse/K8s).

### OSS eval tools (Promptfoo, DeepEval, Arize Phoenix, W&B Weave, OpenAI Evals, Ragas)

The measurement layer, written entirely in ML/security-engineer register — *zero* acknowledgment anywhere that the human maintaining the artifact feels confused or gaslit. Their own materials confess the evals-vibes plateau from the inside: DeepEval's official FAQ has a standing entry *"My metric scores seem random or flaky"*; Ragas' own maintainers' RFC says *"ragas is slow and unreliable"*; HN on LLM-judge metrics: *"very far from reliable... still a research problem."* They grade outputs; none owns the repair loop back into the artifact.

Footprint anchors (all GitHub-API-verified 2026-07-16): Promptfoo 23,319★ / 363k npm-weekly; DeepEval 16,893★ / 1.27M PyPI-weekly (highest download velocity; ~$2.2M seed — the credible independent now that Promptfoo is OpenAI's); Phoenix 10,585★ / 576k PyPI-weekly ($131M raised, OTel-native, engineer-only UX per G2 sentiment); Weave 1,106★ (smallest mindshare despite CoreWeave scale); OpenAI Evals 18.9k★ but **1,156 weekly PyPI downloads** — a husk; Ragas 14.9k★ / 378k weekly on $500k raised, org identity unstable.

### Prompt management CMSes (PromptLayer, Agenta, Latitude, PromptHub, †Vellum)

Our closest competitors on schlep + team-drift — all four lead with "prompts scattered everywhere" and Git-style versioning. But in every case **versioning is storage, not custody**: evals and versions are parallel features; none fuses version × model × pass-rate into one pinned receipt. None mentions model deprecation, attribution, or SKILL.md — "skill" as an artifact doesn't exist in their vocabulary.

Notable dynamics: **Latitude repositioned in 2026** from "prompt engineering platform" to "self-healing agents" — tacit admission prompt-CMS alone wasn't a wedge; its trace→eval→dispatch-a-coding-agent loop is a real (reactive, post-hoc) repair loop and the most sophisticated in the cluster. **PromptHub's free tier forces prompts public** and gates self-hosting behind Enterprise — the opposite of local custody. **Agenta's own issue tracker** shows the anti-schlep tool adding adoption schlep (broken self-host quickstart, first-login failures, OSS eval failures). And the default developer instinct is anti-category: *"I was until recently of the opinion that you should always check in your prompts into git"* (swyx, HN) — these tools compete with git; we compose with it.

Footprint: all small — PromptLayer $4.8M seed / $50/user/mo; Agenta 4.3k★; Latitude 4.4k★ / $8M seed; PromptHub bootstrapped, ~2 people.

### Skills-native ecosystem (Tessl, skillgrade, agent-skills-eval, agentskills.io spec, marketplaces)

Bifurcated: **distribution with no quality layer** (marketplaces racing on raw counts — SkillsMP claims 2M+ skills; awesome-claude-skills 67.9k★; **anthropics/skills at 161.6k★** shows the ecosystem's scale) versus **an emerging DIY-eval layer that has already converged on our receipts mechanic.**

- **The supply-chain scandal is quantified:** Snyk-scan coverage found **13.4% of 3,984 marketplace skills had at least one critical security issue**; Straiker found 71 overtly malicious + 73 high-risk among 3,505 on ClawHub. Marketplaces are catalogs that can't tell you if a skill works, for whom, on which model. Our "someone else made it — is it any good?" card sits on top of a documented crisis.
- **Tessl is the dangerous one:** $125M raised (~$750M valuation), founded by Guy Podjarny (Snyk) — tagline *"Skills are the new code. Treat them that way,"* registry + versioning + CI, evals-as-unit-tests framing. It's our thesis in enterprise-governance clothing (who published it, is it scanned, is it mandated) — IT control, not the practitioner's evidence trail. The gap: an HN commenter asked Tessl, in public, for exactly our product — *"nobody knows which ones still work after model changes. If you can make 'skill quality' visible over time (regressions, drift), that's valuable. Do you have a CI integration where you can pin a skill version and fail builds if eval scores drop?"* — implying it wasn't visibly there.
- **skillgrade (624★, Minko Gechev) and agent-skills-eval (620★)**: both <6 months old, both with/without-skill diffing + pass rates + judge grading — **independent validation of the receipts mechanic**, but one-shot CLI scaffolds: no persistence, no per-model history, no cross-session "is this still true after the model update," no repair loop. The agent-skills-eval Show HN thread (79 pts) is a free roadmap of what the audience wants next: token cost alongside correctness ("skills that technically improve outputs but cost 35–40% more tokens... not really wins"), cross-skill comparability, and — the standout — a power user (dsmmcken) who **hand-built our operating table**: a self-reflection pass after each eval that diagnoses what went wrong and emits a skill-change recommendation file. Nobody productizes it. We do.
- **agentskills.io spec** teaches with/without methodology, pass-rate math, and the iteration loop by hand — the standard-setter validating eval-driven skill development at the doc layer. *"It's the recipe, not the kitchen."*

### The DIY incumbent (git + CI + spreadsheets + eyeballing)

The biggest market share and the real opponent. In sampled threads, **DIY recommendations outnumber product recommendations roughly 4–5 : 1**, and the product mentions skew self-promotional. The intellectual flagship is Hamel Husain's doctrine — *"Keep it simple. Don't buy fancy LLM tools. Use what you have first"* — 1,000+ paid students, refreshed for Sept 2026, cited approvingly even by vendors it argues against. The "eval startups fail" HN thread supplies the distrust: *"most eval companies get torn in multiple directions and do not end up putting out useful data."*

**The objection we must answer is "don't buy tools early," and our answer is structural:** Skillmaker isn't a purchase, a cloud, or a new surface — free, local, one command, composes with the git workflow DIY-ers already defend. The DIY ceiling, in their own words: *"I keep it adhoc — models change so frequently that prompts are always broken all the time"*; the spreadsheet regression pass *"takes about 4 hours."* And the custody gap no DIY assembly reaches: git shows *that* something changed, never *whether behavior changed relative to a pinned model* — no DIY stack persists comparative, model-pinned evidence as a first-class object. Also honesty: Hamel is right that analysis discipline beats tooling — our agents-co-design-evals flow should be framed as *enforcing* that discipline, not replacing it.

---

## 4. The warm-leads map — their gripes → our properties

| Their users' complaint (verbatim, sourced in §3) | The property that answers it |
|---|---|
| "needs a cloud account to see my own traces" (LangSmith) | Local, no account, phones nothing home |
| "only the engineers have access... insights are very canned" (LangSmith) | Plain English; agents co-design evals; non-evals-people welcome |
| Free→$249/mo cliff (Braintrust); opaque sales-gated pricing (Galileo) | Free, MIT |
| Evaluator owned by the evaluated (Promptfoo/OpenAI) | Independent, open-source, vendor-neutral receipts |
| "My metric scores seem random or flaky" (DeepEval's own FAQ) | n runs, confidence intervals, "below smoke" honesty |
| No history/dashboard over time; "no way to track quality metrics over time" (promptfoo alternatives reviews) | Receipts persist per version × model, in your repo |
| Self-hosting the anti-schlep tool adds schlep (Agenta issues; Langfuse ops burden) | One command on the repo you already have; nothing to operate |
| Platform sunset with a month's notice (Humanloop) | Your receipts live in your git history; nothing to sunset |
| Marketplace skills: 13.4% with critical flaws; no quality signal | Adopt it, measure it, report card before it ships |
| "Do you have CI where you pin a skill version and fail builds if eval scores drop?" (asked of Tessl) | That's the product |

---

## 5. Threat board (ranked)

1. **Tessl** — capital, pedigree, near-identical thesis at the enterprise governance altitude. Their gap is the practitioner's evidence trail and the model-pinned receipt; if they lean into the regression/eval angle their own HN thread requested, they collide with us from above. Watch quarterly.
2. **The DIY incumbent + Hamel doctrine** — the real share-holder and the objection engine. Beaten only by being free, local, git-native, and discipline-*enforcing*.
3. **skillgrade / agent-skills-eval** — same mechanic, months old, credible authors, zero custody layer. Also our best evidence of demand; potential allies/acqui-targets as much as threats.
4. **Langfuse (ClickHouse) & LangSmith** — distribution giants one blog post deep into "evaluating agent skills." If either promotes skills from integration-demo to managed artifact, the whitespace shrinks fast.
5. **Latitude** — the only real repair-loop story in the CMS cluster, but reactive/post-hoc; watch their "self-healing" framing, which brushes our operating-table language.
6. **Braintrust** — richest, best logos, but architecturally trace-and-score and now carrying a breach story; least likely to pivot down-market to local-first skill custody.

## 6. Verification corrections (excluded from evidence above)

The fact-check pass killed five claims; recording so they don't resurface: a "user quote" about Galileo pricing was an aggregator author's editorial paraphrased as a quote (dropped; the underlying facts — free tier, sales-gated enterprise pricing — are real); the "tired of stitching Datadog + LangSmith" line is a *competitor's marketing copy* in a flagged Show HN, not a user testimonial (dropped as a gripe, kept only as category-fatigue color — not used above as user voice); a promptfoo issue quote was misattributed to the wrong issue number (dropped); agent-skills-eval's "tagline" was a paraphrase-mashup (corrected to description form); Vellum's assistant repo does have countable stars (889) contrary to the study's note. Star counts, funding figures, and pricing tiers cited above passed the check or are marked with their limitations inline.

## 7. What this changes on the site (inputs to the /b rewrite)

1. **Say the two unclaimed HIGH lanes out loud, in headline copy** — model-changed as a named event ("the model changed on someone else's schedule — know what survived by lunch") and the attribution answer ("was it the model, the skill, a teammate, or you — a lookup, not a fight"). We would be the only page on the internet saying either.
2. **Don't lead with evals-vs-vibes** — it's the most crowded claim in the category; it's our mechanism, not our door. (Consistent with the existing "score is the easy part" demotion.)
3. **The objections section gains two honest, sourced spears:** platform-risk (Humanloop's 30-day sunset; the evaluator-owned-by-the-evaluated problem) answered by local/MIT/your-repo; and marketplace trust (13.4% critical-flaw rate) answered by measure-before-you-trust.
4. **The Braintrust contrast table in VsTheBench remains accurate** and now generalizes: the custody gap is cluster-wide and architectural, not one vendor's oversight.
5. **Roadmap signals from the audience itself** (not site copy, product notes): token cost per run alongside pass rate; pin-version-fail-CI; the self-reflection/repair pass users are hand-building.
