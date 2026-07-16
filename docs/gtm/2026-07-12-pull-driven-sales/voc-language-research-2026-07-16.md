# Voice-of-customer language research — the pain heat map

**Date:** 2026-07-16
**Method:** Seven parallel research agents, one per pain lane, sweeping Hacker News, GitHub issues/discussions, vendor/dev forums (OpenAI community, Cursor forum), X, and practitioner blogs for 2024–2026 material. Each lane returned verbatim quotes with URLs, a lexicon of recurring maker terms, attribution patterns, and an honest heat rating. Each lane's top quotes then went through an independent verification pass that re-fetched the source page. Quotes below are tagged **[verified]** (re-fetched, exact or near-exact match) or **[unverified]** (found but source page could not be re-fetched — mostly HN rate-limiting).

**Why this exists:** The site copy was written in founder language ("entropy-dripping world," "entropy-crushing machine") by an MBA CEO. Makers are the users. This doc records how makers actually talk about the pains we solve, so the site can speak their dialect — and it tests whether the pains we bet on are actually expressed in the wild.

**Known bias:** Reddit and X were largely unfetchable this session (blocked/rate-limited), so the heat map is weighted toward HN, GitHub, and dev-forum voices — a more technical, more senior register than Reddit. Secondary evidence confirms heavy Reddit activity on these topics; treat Reddit-specific volume as undercounted, not absent. A follow-up sweep from a network that can reach Reddit is worth doing before any copy hardens permanently.

---

## 1. The heat map

| Pain lane | Heat | Signal |
|---|---|---|
| **Attribution folklore** ("they nerfed it") | **HIGH** | Ubiquitous, cross-vendor, years-deep. Multi-hundred-comment GitHub threads, on-record vendor rebuttals, mainstream press pickup. The loudest thread in AI-practitioner discourse. |
| **Agent did something weird** | **HIGH** | "Confidently wrong" recurs on HN every year 2023–2026. Viral incidents (Replit DB wipe, Cursor support bot). New OSS tools being built *specifically* to capture why an agent did something — independent proof the gap is felt. |
| **Model changed under me** | **HIGH** | Constant and unprompted across HN, OpenAI forum, GitHub deprecation threads. Drives real behavior change: version pinning, local-model migration, cancellations. |
| **Maintenance schlep** | **MEDIUM** | Real and recurring (yearly Ask-HN "how do you manage prompts" threads) but modest engagement, and explicit organic pushback exists ("obsessing over prompt versioning is exactly what's not needed"). |
| **Evals & vibe checks** | **MEDIUM** | Sustained, earnest practitioner discussion; a cottage industry (courses, tools) built on "stop vibe-checking." Wonky, not viral — confession-register, not meme-register. |
| **Skills-native** | **MEDIUM** | Very current (a wave of July-2026 GitHub issues). But the loudest skill pains are **triggering reliability**, **supply-chain trust**, and **is-this-any-good** — not drift-over-time. |
| **Team drift** ("Jerry the Jerk") | **LOW** | Almost zero first-person public venting despite ~20 targeted queries. Described extensively in prescriptive blog posts, but people don't *complain* about it in the wild — an under-vocalized pain, not a felt one. |

**Reading it strategically:** our hero (weirdness) and our situations (model-changed) sit on confirmed high-heat pain. The witches lane is the surprise asset (see §3). Team drift being cold **validates the business-model brief's sequencing**: multiplayer custody is the hosted/enterprise hypothesis to hunt via conversations, not a front-door pitch — keep Jerry as one pain-board card, no more.

---

## 2. The lexicon — what to say, what to stop saying

### Words makers actually use (adopt these)

| Term | Frequency | What it carries |
|---|---|---|
| **confidently wrong** | ubiquitous | THE folk name for the failure mode: certain-sounding output that's wrong. Recurs on HN every year since 2023. |
| **vibe check / vibe-testing / "vibes and logs"** | ubiquitous | The default QA method, named with self-aware guilt. "You can't vibe-code a prompt" (incident.io). This is the coping mechanism's real name. |
| **nerfed / stealth nerfed / lobotomized** | ubiquitous | Gaming-patch-notes vocabulary for perceived covert model degradation. Emotional core of the folklore lane. |
| **drift** (prompt drift, skill drift) | common | The truest verb in the domain, confirmed: behavior changing with no edit to the prompt. Used organically by practitioners, not just vendors. |
| **silently / quietly** | dominant adverb | "Silently ignored," "quietly does something plausible," "silently degrading." The corpus's failure physics: no signal, ever. |
| **"no idea why"** | common | The explainability gap in plain English — appears as throwaway asides, which is how you know it's felt: "six weeks later I had no idea why." |
| **regression / regressed** | common | The engineering-register synonym for nerfed; what the same complaint sounds like in a bug report. |
| **gaslighting** | common | The agent insisting it's right when the user knows it's wrong. Captures the specific sting of the trust breach. |
| **canary (prompts)** | occasional, relief-side | The community's own emergent name for the fix: known-answer prompts replayed on a schedule to catch silent regression. **This is our product described by strangers.** |
| **receipts** | occasional, organic | Multiple unrelated OSS projects (agent-receipts, etc.) independently use this exact word for a logged record of what an agent did and why. **Our existing brand word is validated maker vocabulary.** |
| **supply-chain (decision/risk)** | common in skills discourse | "Installing one is a supply-chain decision" — how makers frame third-party skill trust. |
| **overfit (to a model)** | occasional | The precise mechanism language for why model swaps break prompts: "Application prompts overfit the model they are using." |
| **prompt instability** | rare coinage, concept ubiquitous | "If we have to perform tuning on our prompts... every model release... new model releases becoming a liability more than a boon." |

### Founder language with zero corpus presence (drop from the page)

- **"entropy"** — the skills-native agent searched for it explicitly: *"I did not find any organic use of the word 'entropy' to describe this pain anywhere in the corpus."* Keep it as internal strategy shorthand; it does not belong in front of makers.
- **"custody"** — no organic usage found. Same ruling: internal positioning concept, not page copy.
- **"commercial-grade"** — no confirmed organic usage; the corpus says "production" ("production prompts," "prompt changes are production changes"). *Production-grade* is the native register.

### Borrowable practitioner coinages (quote with attribution, or echo carefully)

- *"Failure screams. Drift hums."* (cashandcache.substack.com) — the best two sentences anyone has written about this. Don't lift it; consider quoting it or writing our own variant.
- *"The failure is semantic, not syntactic. It doesn't throw exceptions. The agent responds. It always responds."* (dev.to, "Why Agent Testing Is Broken") — validates our hero physics nearly verbatim.
- *"You have no regression suite for cognition. You're flying blind."* (same post)
- *"A good skill is a scar, not a resume."* (docs.bswen.com) — the best skill-craft line found.
- *"A skill is a claim that your agent got better, and claims get tested."* (travis.media) — our pitch, in a stranger's words.
- *"Customers shouldn't be involuntary QA for model upgrades."* (GitHub issue) — the model-changed pain as a slogan.
- *"Patchwork of competing instructions that the model is resolving probabilistically."* (kanupriyayakhmi.substack.com) — the patch-spiral end state.

---

## 3. The witches report — attribution folklore

The question was: when AI behavior degrades, what do people blame? Ranked by prevalence:

1. **The vendor secretly nerfed/quantized/throttled the model** — the dominant folk theory, everywhere, cross-vendor. Vendors deny it; one forensic community report (17,871 thinking blocks analyzed) earned an on-record Anthropic response confirming real concurrent changes while disputing the causal story. Verdict: *right instinct, often wrong mechanism* — silent changes DO happen (a vendor's own account, verbatim: "differences in model behavior can be subtle — only a subset of prompts may be degraded, and it may take a long time for customers and employees to notice").
2. **Safety guardrails** — user-coined "Safety Mode": the model "lobotomizes its effective intelligence" when it perceives risk. Folk-named state with folk rituals attached.
3. **Secret A/B tests / staged rollouts** — staged rollouts are real, disclosed-in-principle practice; users experience them as covert experimentation.
4. **Deliberate profit motive** — "made to fail so you burn more tokens," escalating to "commercial fraud" accusations. Pure folklore, but emotionally load-bearing.
5. **My own prompt was overfit / my context rotted** — the technically-correct attribution, and a clear *minority* voice by volume.
6. **Rituals in retreat** — tipping, threatening, "take a deep breath": mostly 2024-era, now half-joking, tested-and-inconclusive. Folklore fading, not thriving.

**The strategic finding:** the modern witch is *the vendor*, and the wound underneath the witch-hunt is **epistemic helplessness**. The single most emotionally revealing quote in the whole sweep, from the Claude Code nerf mega-thread:

> "i thought i was going crazy/missing something" — followed by, when a data analysis appeared: "Incredible analysis. As a user, I experienced this over the past weeks and couldn't put my finger on it."

People don't just want the weirdness fixed. **They want to stop feeling crazy.** Data-backed attribution is experienced as *relief and validation* — which is precisely what a receipt is. The corpus's own relief inventory converges on our product from three directions: canary prompts (scheduled re-runs of known-answer checks), version pinning (control over *when* the world changes under you), and "write down what good means" (evals as behavioral contracts).

**Copy implication — the attribution wedge.** Our buyer's first instinct when quality drops is to suspect the vendor, doubt themselves second, and *have no way to tell*. That inability-to-tell is the sharpest form of the pull. The page should meet the nerf-suspicion head-on rather than lecture past it:

> *Maybe they nerfed the model. Maybe a teammate "improved" the skill. Maybe your prompt was overfit all along. Today you can't tell — and that's the actual problem.*

We never have to claim the vendor is innocent (we don't know) — we sell the ability to **answer the attribution question**: was it the model, the skill, a teammate, or you? Receipts turn a witch-hunt into a lookup. This also keeps us honest per the voice guardrails: we're not promising the world stops changing, we're promising you can tell what changed.

---

## 4. Lane summaries with anchor quotes

### Model changed under me — HIGH

Two HN threads alone produced 25+ independent tellings of the same failure. Behavior change is real: pinning dated model strings, migrating to local/open-weights, cancelling.

- **[verified]** "Application prompts overfit the model they are using to get the output they want. Switch model, the prompt no longer produces the output you expect..." — HN, [48868086](https://news.ycombinator.com/item?id=48868086)
- **[verified]** "...existing models start to behave worse shortly after new model releases, due to resource reallocation away from the older models..." — HN, [48871754](https://news.ycombinator.com/item?id=48871754) (folk theory, stated as speculation)
- **[unverified]** "If we have to perform tuning on our prompts ('skills', agents.md/claude.md...) every model release then I see new model releases becoming a liability more than a boon... I think the term for this is 'prompt instability'." — HN, [46104137](https://news.ycombinator.com/item?id=46104137)
- **[unverified]** "The quality degraded overnight with no warning... I just want a stable solution that's properly tested before release — not beta-tested on paying customers." — HN, [46792746](https://news.ycombinator.com/item?id=46792746)

### Agent did something weird — HIGH

The failure physics the corpus describes matches our hero exactly: plausible, silent, semantic, blames-you.

- **[verified]** "AI is not a tool, it's a tiny Kafkaesque bureaucracy inside of your codebase." — HN, [43683012](https://news.ycombinator.com/item?id=43683012)
- **[verified]** "...it hallucinated a missing brace (my code parsed fine), 'helpfully' inserted it, and then proceeded to break everything." — HN, same thread
- **[unverified]** "an agent would make a schema change, rename a function, or add a dependency, and six weeks later I had no idea why." — HN, [47884407](https://news.ycombinator.com/item?id=47884407)
- **[unverified]** "It doesn't throw exceptions. The agent responds. It always responds. The response is even plausible. The failure is semantic, not syntactic." — [dev.to](https://dev.to/dingomanhammer/why-agent-testing-is-broken-12a2)
- **[verified]** "I violated every principle I was given." — an agent's own post-incident confession, via [idsalliance.org](https://www.idsalliance.org/blog/claude-didnt-go-rogue-permissions-did/)

Note: first-person "my agent embarrassed me in front of a client/boss" material was thin — the corpus skews to "broke prod" and "wasted my afternoon." Our "in front of someone who matters" sub-line is plausible but less directly evidenced than the rest of the hero; a candidate for the out-loud test.

### Maintenance schlep — MEDIUM

- **[verified]** "I keep it adhoc — models change so frequently that prompts are always broken all the time. Most of the ones I've used last year are no longer relevant." — HN, [42325485](https://news.ycombinator.com/item?id=42325485)
- **[verified]** "We have system prompts growing past 2,000 words. Managing them as big template literals in the codebase makes iteration impossible for non-technical team members, and versioning a nightmare." — HN via [Algolia 47744802](https://hn.algolia.com/api/v1/items/47744802)
- **[verified]** "The #1 pain we kept hitting: prompt chaos. Prompts hardcoded as strings everywhere, no versioning, redeployment for every tweak, zero collaboration..." — Show HN, [46937979](https://hn.algolia.com/api/v1/items/46937979)
- **[verified]** "As users install more skills over time (currently 89+ in my installation), the skills list grows unbounded with no lifecycle management... no way to know which skills are actually used and which are dead weight." — [GitHub issue](https://github.com/NousResearch/hermes-agent/issues/11425)
- **Counter-signal, verified:** "I find that being obsessed with optimizing prompts is exactly what's not needed at this stage... the 'cost' of prompting again... is lower than the cost of having some system for cataloging, maintaining, and versioning my prompts." — HN, [43753180](https://news.ycombinator.com/item?id=43753180). The solo-hobbyist rejects the pitch; the pain concentrates where stakes and scale exist. Aim the page accordingly.

### Evals & vibe checks — MEDIUM

- **[verified]** "There were multiple situations where a tweak to a prompt passed an initial vibe check, but when run against the full eval suite, clearly performed worse." — HN, [44712315](https://news.ycombinator.com/item?id=44712315)
- **[verified]** "I wrote thirty test cases... shipped it... The bump in the score was never real... Below a hundred, you are measuring your scorer's mood, not your prompt." — [dev.to](https://dev.to/kartik-nvjk/how-i-ab-test-llm-prompts-without-fooling-myself-528f). *Directly validates the "below smoke" honesty feature.*
- **[verified]** "My process was just manual A/B testing in a spreadsheet for a while but then realized that completely fails with anything complex" — [OpenAI forum](https://community.openai.com/t/llm-and-prompt-evaluation-frameworks/945070)
- **[verified]** "We make a spreadsheet... It's a very manual process... Ours takes about 4 hours." — HN, [41019748](https://news.ycombinator.com/item?id=41019748)

### Team drift — LOW

All the vivid material is prescriptive blogging, not venting. No verifiable postmortem naming an uncoordinated prompt edit as root cause was found.

- **[verified]** "There are hundreds of system prompts scattered across the codebase... a shared document that three different engineers have edited at different times with no record of what changed or why." — [kanupriyayakhmi.substack.com](https://kanupriyayakhmi.substack.com/p/the-depreciation-of-prompt-assets)
- **[verified]** "If behavior changes, I want to know which prompt version was active, who changed it, and why." — [mattlouden.com](https://mattlouden.com/blog/prompt-changes-are-production-changes) (stated as the *missing* thing)
- Product evidence that friction exists upstream of the silence: LangSmith shipped owners-only prompt promotion; Langfuse users request branching.

### Folklore — HIGH (see §3)

- **[verified]** "Claude has regressed to the point it cannot be trusted to perform ANY engineering... MUST be watched at all times or it WILL break things." — [GitHub, claude-code #42796](https://github.com/anthropics/claude-code/issues/42796)
- **[verified]** "...stealth nerfed over the last 2 weeks to a degree I had not experienced since the massive nerfs" — HN, [48757589](https://news.ycombinator.com/item?id=48757589)
- **[unverified]** "i thought i was going crazy/missing something" — GitHub, claude-code #42796

### Skills-native — MEDIUM

The dialect of our earliest adopters. Their top three expressed pains, in order: **triggering reliability** ("it's very rare that it will pick a skill unprompted... kind of defeats the purpose"), **supply-chain trust** ("Installing one is a supply-chain decision"; a cited Snyk audit found ~37% of scanned skills had a security flaw), and **is-it-any-good** ("most of the skills you can install right now do very little, and some actively make your agent worse" — **[verified]**, [travis.media](https://travis.media/blog/write-a-good-agent-skill/)).

- **[verified]** "a verbatim antipattern in a loaded skill did not bind behavior — the model rationalized past it. Prose guardrails appear to be advisory rather than enforced." — [GitHub, claude-code #76299](https://github.com/anthropics/claude-code/issues/76299) (near-verbatim)
- **[verified]** "Losing the full skills list after compaction... is annoying as hell when you're relying on that context." — [GitHub, claude-code #74990](https://github.com/anthropics/claude-code/issues/74990)
- Relief/positive vocabulary: "reviewable in PRs, testable in CI," "no black box automation," "a skill is a claim that your agent got better, and claims get tested," measured lift cited as "+16.2 percentage points" — **the skills community already treats maintained evals as the marker of a good skill.** We're not creating that norm, we're serving it.
- Gap to note honestly: makers here mostly blame **the artifact and its author** (bad description, too broad, no evals), not an external force of decay. One more reason the enemy beat should be re-grounded (§5).

---

## 5. Copy implications for /b — the re-voicing list

1. **H1 stays.** "Your agent did something weird again." sits on confirmed high-heat pain. (Variant to out-loud test: "confidently wrong" is the corpus's own word — e.g. sub-line "Not broken. Not erroring. Just confidently wrong.")
2. **Enemy beat: kill "entropy," keep the enemy.** Replace the abstraction with the attribution wedge (§3): maybe-they-nerfed-it / maybe-a-teammate / maybe-it-was-always-overfit / *you can't tell*. The enemy in maker language is **silent drift plus not being able to tell what changed** — not a physics lecture.
3. **Machine beat: kill "crushes entropy."** It overclaims against our own closer ("we can't make your agent predictable") and uses the dead word. The corpus hands us native metal: *a canary on every skill*, *a regression suite for behavior*, *receipts*. Candidate register: "drift into a number, blame into a lookup" already survives — it's the headline that needs re-voicing.
4. **Pain board: re-voice cards in corpus phrasing.** "Model just got updated" card can carry the folklore: *"Nerfed, or was it you? Now you can answer."* The someone-else's-skill card should use supply-chain framing. Keep the Jerry/teammate card (heat is low but the card is cheap); do not expand multiplayer beyond it.
5. **Coping/objection language: "vibe check" is the native name.** Anywhere we describe the old way, say vibe check / vibes-and-logs / eyeballing — not our paraphrases.
6. **"Commercial-grade" → "production-grade"** wherever the category name appears.
7. **Receipts vocabulary confirmed** — lean in harder; it's organically theirs.
8. **New asset unlocked: a real-quotes band.** Verified public quotes (Kafkaesque bureaucracy; prompts-overfit; measuring-your-scorer's-mood; adhoc-prompts-always-broken) could run as a "you've said this yourselves" strip — stronger than any testimonial we could invent, and honest since it's public record with links. Needs a design/ethics pass on attribution.
9. **Storyboard shot 02 validated verbatim:** "For most skills, this is the first time it's ever been written down" matches the corpus's write-down-what-good-means relief language exactly. Keep.
10. **The emotional promise underneath everything: "you're not crazy."** The receipts don't just fix skills; they end the self-doubt ("i thought i was going crazy"). Worth one line somewhere near the closer.

## 6. What this does NOT yet confirm

- The "in front of someone who matters" hero sub-line (thin first-person evidence — out-loud test it).
- Reddit-register language (access-blocked; re-sweep or just read Reddit by hand for an afternoon).
- That symptom-aware buyers follow the agent→skill bridge without help (still the seam to watch; the corpus blames artifacts and vendors, rarely "my skills need an owner").
- Anything about willingness to pay — this was language research, not demand research. The toll booth (issue tracker) remains the demand instrument.
