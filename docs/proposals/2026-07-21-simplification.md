# The Simplification: Eight Decisions

*Proposal — Jess × Raven, 2026-07-21. The walkthrough plan for the radical
simplification of Skillmaker Studio. Supersedes the frame of
[`2026-07-20-skill-centric-restructure.md`](2026-07-20-skill-centric-restructure.md)
(its four rulings are absorbed below as D2–D5) and amends
[`2026-07-20-install-simplification.md`](2026-07-20-install-simplification.md)
(D6). Danvers is out through ~2026-08-03; Jess is technical owner and rules
alone. Decisions are logged here and in the Ledger so his catch-up is a read.*

## The Thesis

The product is 60% too large — an amalgamation of ideas, unused by humans.
The core worth keeping is **research + skill writing + evals on
locally-installed skills in a directory**, done well enough that we use it
daily for real work (to-tickets first). Everything else is cut or deferred
until demand pulls it back.

Two distinct bets, deliberately kept separate:

- **The scope cut** (this doc's D1–D5, D8): cheap, display-layer-heavy,
  reversible, starts today. Goal: a working, in-use product ASAP.
- **The foundations bet** (D7): desktop app + sqlite, replacing CLI-primary +
  event-sourcing. Real, decided now, but sequenced so it never blocks the
  usable product. Proceeds in parallel.

Guiding lessons (from the Alexandria retrospective, 2026-07-21):

1. Start with a small usable core; use it ourselves immediately; add
   functionality only as we need it, slowly, so we feel it.
2. Recursive use (Skillmaker-on-Skillmaker) is a user, not *the* user — it
   misleads about the outside-the-product experience.

## D1 — Cut Ship/Receive

**Cut:** the Ship and Receive tabs, the shipping-manifest surface, the
field-report paste form, and the planned field→fixture wiring (#81) and
Published-as-doorway (#82). There is no install/publish/deploy phase in
v-simple.

**Freeze, don't delete:** `skill.shipped` and `skill.field_report` journal
events stand in history (stored-vocabulary freeze pattern); no new emitters.

**The surviving job:** "what is the world telling me about this skill" —
local monitoring of installed skills, session inspection — survives as a
*Lab/evidence concern*, unbuilt, pulled in by demand later. Not a room.

**Reverses:** the Vision card's checkout/return loop (adopted 2026-07-15) and
the #72 tab split. The Vision card gets redrafted after this walk.

**Ruling:** **Accepted** (Jess, 2026-07-21). Cut both rooms entirely; freeze
events in history; failures from real use land via run→todo (D5) and
hand-authored fixtures.

## D2 — Navigation: Board above, Skill below

Ruling 1 of the restructure proposal, amended by the pivot:

- **Board** — the top level, all skills, absorbs Track (catalog = the list;
  feed and archive = drawers).
- **Skill page** — the primary object: design, evidence, runs, history as
  sections. Stage is a field; the bench is the evidence section under
  pressure.
- **Amendment:** Dock/import-queue and marketplace are *deferred entirely* —
  not designed, not built, no reserved surface. With no import phase there is
  nothing to dock.

**Ruling:** **Amended-accept** (Jess, 2026-07-21). Board + Skill page as
proposed, with this precision: **the Lab does not go away — it moves inside
the skill.** The eval workspace is part of the process a single skill goes
through (research → write → eval → publish), so it is *within-skill
navigation* — a section of the Skill page — not top-level nav. Cross-skill
urgency (which skill most needs hands) surfaces as Board signal; the
workspace where you do the eval work is per-skill.

## D3 — Vocabulary: plain English

Ruling 2 as proposed, shrunk by deletion: crate, dock, field report, harvest,
motions all name cut things. Surviving renames: skill (not Skill Bundle),
evals (not Proof), activity (not Feed/Journal on user surfaces), eval
workspace (not Lab/Bench, if D2 keeps the surface at all). Keep
**Unverified**, **salvage**, **fork** with a one-page glossary. Display-layer
only; stored values frozen.

**Ruling:** **Accepted** (Jess, 2026-07-21).

## D4 — Proof and Improve are one loop

Ruling 3 as proposed: the drafting ladder ends at **Draft**; after that the
skill lives in the continuous evidence loop (author → run → grade → measure →
repeat) with bench signals for urgency. Proof becomes earned confidence, not
a place.

**Open sub-question the original ruling can't answer anymore:** it kept "the
publish gate as the one hard exit" — but v-simple has no publish phase. What
replaces it? Candidate: there is no exit; a skill is simply *in the loop* with
a confidence read-out, and "published" freezes as a historical stage value.

**Cost:** touches stored state (`bundle.stage_changed`); handled by the
freeze pattern (old events stand, display remaps). This is the one scope-cut
decision with data-model texture — logged in detail for Danvers.

**Ruling:** **Amended-accept** (Jess, 2026-07-21). The merge stands (ladder
ends at Draft; one continuous evidence loop after). **Publish is redefined
concretely:** the skill.md sitting in its live location on disk (whatever
project/folder it belongs to) *is* the published artifact. First creation in
place = published from birth; imported skills arrive already-published.
Studio's work products are drafts/proposed revisions of the skill; **publish
= overwriting the live skill.md with a draft.** This is "SKILL.md is an
output of the bundle, not the bundle" made literal, and it makes drift
(live file vs. last-published version) the product's central diff.

**D4b — the gate:** **soft gate** (Jess, 2026-07-21). Publish is always
allowed; the graded read-out shows the evidence state at that version ("not
yet measured" / pass rates) and the publish is stamped with it. Honesty
without friction.

## D5 — Run findings become work

Ruling 4 as proposed, unchanged: `TodoOrigin` gains `{kind: "run", runId}`;
the read-out gets a second affordance ("this run surfaced work → open a
todo"); verdict and disposition stay orthogonal. Smallest decision, hardens
the eval loop, ship first.

**Ruling:** **Accepted** (Jess, 2026-07-21). Ship first — with D1 this is now
the product's primary sensing channel.

## D6 — The agent layer: CLI demoted, not killed

Amends "CLI first, desktop last" (install proposal): the desktop app is the
primary human interface; the **CLI survives as the agent layer** — the
interface through which agents (William, `/skillmaker` in Claude Code/Codex,
future integrations) read and change what's inside Studio. William plus a
starter set of research/drafting skills ship *inside* the product —
agent-first production stays a core wager.

The npm door and platform packages (#123–#125) stand: they are the transport
the desktop app wraps and the way agents resolve the CLI. No longer marketed
as the primary install vector.

**Ruling:** **Accepted** (Jess, 2026-07-21), with the design-center corollary:
the CLI's audience is now *agents* — machine-readable output, stable exit
codes, `--json` everywhere; it stops accreting human-facing ergonomics.

## D7 — The foundations bet: desktop + sqlite (Jess's call, in parallel)

**Decided by the technical owner, not deferred:** Skillmaker Studio becomes a
desktop application; the data layer moves from event-sourcing/journal to a
standard sqlite db; bundle files stay on disk so git-tracking remains
possible for those who want it. No GitHub requirement.

**Sequencing constraint (the actual ruling needed):** this work proceeds in
parallel and never blocks the usable product. The scope-cut (D1–D5) lands on
the *current* architecture first; the foundations swap happens underneath a
product that is already in daily use, so regressions are felt immediately.

**For Danvers's catch-up:** customer-experience implications (desktop-first
audience, "happy to have anything that makes evals accessible" vs. the
CLI-native power user) are his review surface; the technical substrate is
not.

**Ruling:** **Accepted — cut first, rebuild beneath** (Jess, 2026-07-21).
D1–D5 land on the current architecture this week; real use (to-tickets)
generates the rebuild's spec; desktop shell + sqlite proceed in parallel and
land beneath a product already in daily use. Noted: desktop-shell and
sqlite-swap are separable risks and need not land in the same step.

## D8 — The learning-ground rule

Skillmaker-on-Skillmaker continues (the repo stays a real workspace) but is
demoted from primary learning ground to one user among several. **User #1 is
to-tickets** — real Product/Engineering factory work, starting immediately.
User #2 candidate: Damien's New Media skills. Friction logs from real use are
the standing input to what gets built next; nothing gets added to the product
without a felt need from a real use.

**Ruling:** **Accepted** (Jess, 2026-07-21), with teeth: additions require
demand evidence — a friction-log entry or a run→todo from real use — not
design intuition.

## D9 — The chat surface: agent chat in the viewer via ACP (added post-walk, same day)

Embed agent chat in the viewer (and the desktop app) using the existing ACP
plumbing: the station/run engines already spawn `claude-code-acp`/`codex-acp`
subprocesses and stream session updates — the product discards the stream
into transcripts instead of rendering it. A chat panel on the Skill page —
backed by a per-skill ACP session the server owns — becomes the surface
where work is *driven*: frame conversationally, hand over sources, launch
stations, watch them live, answer an agent's questions, dispatch revisions.

**Demand evidence (D8-compliant):** friction log entries #2, #4, #5, #6,
#9, #12, #13 from the first day of real use are all the same absence — no
live surface where work moves forward.

**Scoping guards:** v1 is chat that starts/attaches to per-skill sessions,
not an always-running companion; the engine's current silent auto-approval
of agent permission requests must become a real UX surface; requires the
user to have Claude Code or Codex installed and authenticated — the
desktop-audience onboarding answer is an open design question for the
Danvers brief.

**Ruling:** **Accepted in principle** (Jess, 2026-07-21 — "I like it").
Detailed design pending; belongs to the desktop-app workstream with the
Skill page (D2) as its home surface.

**Amendment (same day): direct manipulation is a peer, not a fallback.**
The Skill page must also support doing things *directly* in the UI —
adding research sources, editing files, answering an agent's open
questions — without touching the filesystem. Chat handles judgment and
delegation; direct manipulation handles anything with an obvious form
(drop a file, fill a field). Friction evidence: #6 (sources required
`mkdir` + `curl` on disk — undiscoverable and terminal-bound). For the
desktop audience, "no terminal" must mean "no filesystem spelunking"
too.

## After the walk

- Record each ruling in the Ledger.
- Redraft `Vision - Board Lab Ship Receive` to match (it is wrong at its
  center after D1).
- Sweep the 61 library cards with a keep/cut/defer disposition table
  (precedent: `MIGRATION.md`, 101→49).
- Brief doc for Danvers: rulings + CX-facing changes flagged for his review.
