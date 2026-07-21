---
type: Vision
prefLabel: The Skill Is the Product
context: _index
status: adopted
links:
  supersedes:
    - "./Vision - Board Lab Ship Receive"
  related_to:
    - "./Concept - Skillmaker Studio"
    - "../board/Surface - Board"
    - "../board/Entity - Todo"
    - "../evals/Entity - Fixture"
    - "../evals/Capability - Eval Run"
    - "../outputs/Entity - Skill Version"
    - "../outputs/Mechanism - Drift Hint"
---

## WHAT

The north-star model after the radical simplification (all eight decisions
ruled 2026-07-21; `docs/proposals/2026-07-21-simplification.md` is the
decision record). One thesis: **the core of this product is working on a
single skill** — everything else is a view of skills or an action on a
skill. The product is research + skill writing + evals on locally-installed
skills in a directory, done well enough that we use it daily for real work.
There is no install/publish/deploy phase, no marketplace, no import dock —
those wait for demand evidence from real use (D8's rule with teeth).

The shape:

- **Board** — the top level. All skills, the portfolio view; absorbs the
  catalog (its list), the feed and archive (its drawers). Cross-skill
  urgency — which skill most needs hands — surfaces here as signal.
- **The Skill page** — the primary object, reached from the Board. Design,
  evidence, runs, history as sections. Stage is a field on the skill, not a
  room it visits. **The Lab did not go away — it moved inside the skill**:
  the eval workspace is part of the process a single skill goes through
  (research → write → eval → publish), so it is within-skill navigation.
- **Activity** — the record of everything that happened, unchanged in
  spirit whatever the storage substrate becomes (D7).

Two structural rulings animate the shape:

**One evidence loop (D4).** The drafting ladder ends at Draft. After that a
skill lives in the continuous loop — author, run, grade, measure, repeat —
with urgency signals saying how badly it needs hands. "Proof" is not a
place; it is the confidence a skill has earned so far. What never merges:
authored coverage (the risk map — what you claim to have thought about) and
measured validation (what runs say) are two axes on one surface.

**Publish is a file write with an honesty stamp (D4).** The `SKILL.md`
sitting in its live location on disk — whatever project or folder it
belongs to — *is* the published artifact. A skill created in place is
published from birth; a skill imported arrives already-published. Studio's
work products are drafts — proposed revisions — and publishing means
overwriting the live file with a draft. The gate is soft: publish is always
allowed, and the graded read-out stamps the act with the evidence state at
that version ("not yet measured" is the honest default). This makes
**drift** — live file vs. last-published version — the product's central
diff, not a muted pill.

## WHY

The prior Vision (Board · Lab · Ship · Receive) was a good answer to the
wrong-sized question. Its checkout/return loop presumed a deployment
boundary the product doesn't have yet: skills live in local directories;
there is no "field" separate from "here." Meanwhile the product had grown to
roughly triple its usable size — an amalgamation of ideas, unused by humans
— and three different rooms all rendered the same noun, *skill* (the tell
that a primary object was missing its page). The simplification keeps the
two wagers that were always the point — agent-first production and graded
read-out honesty — and cuts everything a real user hasn't demanded.

The sensing job survives the cut. "What is the world telling me about this
skill" no longer needs shipping apparatus: **runs are the primary sensing
channel** (D5 — a run that surfaces work mints a todo, origin-stamped to the
transcript), local sessions can be inspected, and failures in real use
become fixtures by hand. Demand may one day rebuild a distribution loop;
the frozen `skill.shipped` / `skill.field_report` events will be waiting in
history if it does.

## HOW

- **Two interfaces, one core (D6).** The desktop app is the primary human
  interface; the CLI survives as the *agent layer* — machine-first
  (`--json`, stable exit codes), the hands through which William, 
  `/skillmaker`, and future integrations read and change what's inside
  Studio. William and a starter set of research/drafting skills ship inside
  the product.
- **Sequencing (D7): cut first, rebuild beneath.** The scope cut lands on
  the current architecture; desktop + sqlite proceed in parallel and land
  beneath a product already in daily use. Desktop-shell and sqlite-swap are
  separable risks.
- **Vocabulary (D3):** plain English on every user surface — skill, evals,
  activity. Metaphors live in design docs. Unverified / salvage / fork
  survive, with a glossary.
- **The learning-ground rule (D8):** Skillmaker-on-Skillmaker is *a* user,
  not *the* user. User #1 is to-tickets (workspace:
  `sociotechnica-org/skills`); user #2 candidate is Damien's New Media
  skills. The friction log is the requirements pipeline: nothing is added
  without a felt need from real use.

Verified: rulings cross-checked against
`docs/proposals/2026-07-21-simplification.md` (all eight rulings recorded
2026-07-21) and the superseded card's Verified section for the code-level
claims it carried (`skill.shipped`/`skill.field_report` exist and freeze;
`Lab.tsx` mode toggle exists and is now slated to move within-skill). The
build has not yet caught up to this card — it is the target picture the
scope-cut work builds toward.
