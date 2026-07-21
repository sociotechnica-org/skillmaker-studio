# Friction log — to-tickets (user #1)

*The requirements pipeline, per D8 of
[the simplification](../proposals/2026-07-21-simplification.md): nothing gets
added to the product without a felt need recorded here (or a run→todo).
Raw, timestamped, unfiltered — trivia especially welcome; trivia is what the
builder's eye edits out.*

**Setup:** workspace = `sociotechnica-org/skills` (public, created
2026-07-21, local: `~/Documents/code/skills`). Bundle: `to-tickets`, started
as new research. Research inputs:

1. `mattpocock/skills` → `skills/engineering/to-tickets/SKILL.md` (outside
   prior art)
2. `alexandria-dev-factory-issue-authoring` (our factory's conventions)
3. `~/Documents/code/alexandria-st/skills/implementation-planning/SKILL.md`
   (the upstream job; ref material)

Research question: is to-tickets one skill or the bottom half of a
plan→tickets pipeline, and what do the existing three do well and badly?

Jess drives every keystroke; Raven scribes. Entry format: timestamp, what I
was trying to do, what happened, how it felt.

---

## 2026-07-21

- **#1 — init scanned outside the project.** On a clean workspace
  directory, skillmaker reported `found 26 existing skill(s) nearby` and
  wrote `adopt-manifest.md` — having searched *personal* skills (outside
  the project dir). Felt: invasive. "I did kinda hate that it searched my
  personal skills." **Ruling on the spot: the scanner restricts itself to
  the project directory only — always.** No nearby/registry sweep, no
  reaching into `~/.claude` or sibling dirs. (Corroborates the disposition
  sweep's judgment call #6: Adopt's registry-tripwire half was already
  flagged as Dock-coupled machinery to cut — this is demand evidence for
  cutting it, the D8 pipeline working on day one.)

- **#2 — "Create bundle" lands on a dead end.** UI button created the
  skill card ("very cool-looking") but the card offers *nothing to do*
  except "Approve & move to Research." Stage says "Frame — in progress,"
  yet there is no affordance to actually do frame work — nowhere to type
  what the skill is for, no way to hand over the three research sources.
  The work surface is missing; the card is a read-out of work that has no
  place to happen. Felt: "definitely a surprising experience." Open
  question the user asked unprompted: "would it have been different if I
  had an agent do it?" — i.e., the human-first path through the UI is a
  dead end and the user is *guessing* the agent path is the real one.

- **#3 — Vocabulary wall on first touch.** "Frame means nothing to me. So
  much extraneous, meaningless text on that page." Jargon on a first-touch
  surface: "Frame," "PIPELINE (NEIGHBORHOOD)," "the dossier's Contexts,"
  "no risk-map.md yet," "record one to start the chain," "every figure
  pinned to a version & model." Every empty-state message assumes the
  reader already knows the whole model. Direct D3 evidence — and note the
  dossier reference points at a DEFERred concept (sweep: Dossier is
  Dock-coupled), so the empty state cites machinery that no longer exists.

- **#3b — What worked:** the brand. "It looks cool!" The card visual
  system (LifeBuild brand cards) landed even in a friction moment — keep.

- **#4 — The card is a read-out for work the UI never offers to start.**
  The dead end of #2 explained: stations default to agent doers; the card
  is the grading/review surface. But there is no "run the agent" button —
  the UI assumes the work happened elsewhere and never says where. The
  human path and the agent path never meet on the page. D2 implication:
  the Skill page must *launch* work, not just review it.

- **#5 — The first stage is unworkable by anyone; the only affordance is
  to skip it.** `npx skillmaker-studio station run to-tickets` →
  `bundle "to-tickets" has no station configured for state "idea"`. So at
  the first stage: no human affordance in the UI (#2), no agent station in
  the CLI — the sole available action in the product is "Approve & move to
  Research," i.e. *approving frame work that no one did and no one could
  do*. Also confirms the vocabulary split: the UI calls the state "Frame,"
  the store calls it "idea" — two names for one state, neither ruled on
  (D3/D4 enum question).

- **#6 — No door for research inputs.** "Research _is_ another
  nothing-burger... How do I add the research files?" The Research stage
  offers no affordance to hand over sources — the actual answer (drop
  files into `skills/<slug>/research/`, which the station engine seeds
  into the agent sandbox because the station `produces` that path) is
  knowable only from the Stations card / StationEngine source. The
  primary input to the product's first real stage is undiscoverable.
  Predicted in advance of the session; confirmed exactly.

- **#7 — William doesn't ship with the product.** Predicted from the
  Stations card, confirmed live: `station run` → `the "researching"
  station for "to-tickets" references skill "william-research-a-skill",
  which does not exist as a bundle in this workspace`. The default
  template wires every fresh workspace to agent stations whose agent
  skills exist only in the vendor's dev repo. Agent-first by default,
  agent-less in practice. Workaround: hand-copied the bundle out of
  skillmaker-studio's own checkout. Direct build item for D6 ("William +
  starter skills ship inside the product"). Credit where due: the error
  message itself was excellent — named the station, the missing slug, and
  the exact expected path. (Also: the Stations card's "placeholder slug"
  deviation note is stale — the template now names the valid
  `william-research-a-skill`; card-revise pile.)

- **#8 — The product's own tooling pollutes the user's Board.** Copying
  William in makes him appear as a card in the FRAME column — "a skill
  that it's working on. that's wrong too." The model has no distinction
  between *work-product skills* (what the user is making) and *system
  skills* (the agents/tools the product uses to make them). Station
  skills are just bundles in the workspace, so the Board renders the
  factory's machinery as if it were the user's work. Kin to the
  fixture-prop leak (restructure appendix #2): the scanner/index has no
  concept of "not the user's work." Design implication for D6: shipping
  William inside the product requires a first-class system/infra skill
  category — installed, runnable, upgradable, but *not on the Board*.

- **#9 — The UI is nearly blind to the run it started.** During the live
  station run: "Research — in progress" is a static stage label, no
  liveness signal, no link to the running transcript; the raw event list
  is the only tell. Worse, "Approve & move to Draft" stays clickable
  mid-run — the approve path never checks whether work exists or is
  in flight. (Also observed: the approve button emits `review.requested`
  + `review.resolved` in the same second — a self-approving review pair;
  the guard is paperwork.)

- **#10 — The review experience fails the review.** Station output review
  panel: raw un-rendered markdown ("no markdown formatting"), "can't tell
  what the 'diff' is," "way too much to read," and the notes end in a pile
  of open questions with no affordance to answer any of them — the run
  surfaced work and questions, and the review panel offers only
  approve/send-back (D5's missing door, felt again at the review surface).
  The content itself was GOOD — the surface made good work look like a
  wall.

- **#11 — The wager pays: William's research is promotable.** The full
  agent loop worked in a fresh workspace: sandbox → Opus → skill invoked →
  `research/notes.md` → review requested. The output answered the
  research question with a defensible recommendation (standalone
  decompose-and-publish skill) and accurate source comparisons. Director:
  "actually reading the content, it looks pretty good... we should just
  promote it into the product." → D6 build item confirmed from the demand
  side: ship `william-research-a-skill` (and the drafting twin) as
  bundled system skills.

- **#12 — Review can receive judgment but can't dispatch work.** The
  send-back notes field feeds an event; nothing in the UI acts on it —
  the user must return to the terminal to re-run the station. Predicted
  by the director before posting ("pretty sure it will just sit there").

- **#13 — After send-back, the UI gaslights the reviewer.** Notes posted
  → card looks identical to pre-review: the submitted notes are visible
  nowhere, no "sent to agent" confirmation, no next-step guidance, and no
  indication that a new station run had already started (journal showed
  `station.started` 3 min after the send-back). The *mechanism* is
  correct — notes land in `review.resolved` and `latestReviseNotes` folds
  them verbatim into the next run's prompt — but the surface reports none
  of it. Machinery flawless, interface silent. (Chat-in-viewer, proposed
  today as D9, is the single fix for #12/#13 as well as #2/#4/#5/#6/#9.)

- **#14 — The UI narrates and justifies itself.** "There's a TON of extra
  words in the UI which feels like the UI describing and justifying
  itself" — e.g. the footer tagline "every figure pinned to a version &
  model," "record one to start the chain," "shows the honest gap rather
  than an inferred graph." Distinct from #3 (jargon): this is
  *design-doc prose leaking into chrome* — the interface explaining its
  philosophy instead of stating the user's situation. The design
  rationale belongs in design docs (same rule as D3's metaphors); the UI
  should say what things are, not why they were built that way.

- **#15 — No approve-with-notes.** The review panel's notes field is
  chained to "Send back" (required there, impossible on Approve).
  "LGTM with nits" — the most common review verdict — cannot be
  expressed. Verdict and commentary merged into one control; the
  restructure proposal's own "never merge the judgments" rule, violated
  at the review panel.

- **#16 — The pipeline's pipes aren't connected.** Station sandboxes are
  seeded ONLY with the station's own `produces` paths + `design.md`
  (StationEngine seeding loop). Drafting produces `design.md` +
  `output/SKILL.md` — so `research/` never reaches the drafting agent:
  the research stage's entire output (and two rounds of director
  rulings) would be invisible to the station that needs it most.
  Workaround: add `"research/"` to drafting's `produces` in the bundle's
  stations.json. Real fix: stages must feed forward by default —
  upstream outputs belong in downstream sandboxes.

- **#17 — Every state change is a silent label swap.** Approve-to-Draft:
  "underwhelming button click — nothing happens other than label
  update." Same family as #9/#13: the product treats major moments
  (stage advance, review posted, run started) as text mutations. No
  acknowledgment of what just happened, no "what happens next" (here:
  'now run the drafting station from your terminal' — the UI knows this
  and doesn't say it). The one-sentence version of the whole log: **the
  UI is a status display for a process it refuses to narrate or drive.**

- **#18 — Reviews wear the current stage's costume.** After approving to
  Draft advanced the stage to evaluating ("Proof"), the still-pending
  drafting review re-labeled itself "APPROVE THE EVALUATION" — soliciting
  approval of evaluation work that doesn't exist (Fixtures 0, coverage
  none) when the actual pending item was the drafting station's design.md
  + SKILL.md. The review box titles itself by the bundle's *current*
  stage instead of the station that requested the review — the #5
  disease (gates soliciting approval for non-work) at the far end of the
  ladder, compounded by "evaluation" colliding with evals-the-feature
  (D3). Also observed en route: the user wandered into a different tab
  (Track) and found the same card with different buttons — #118's "card
  belongs to every room," experienced live.
