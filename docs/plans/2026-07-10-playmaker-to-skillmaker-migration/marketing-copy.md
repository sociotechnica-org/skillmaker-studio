# Marketing Copy — working draft for the marketing-site phase

> Prepared ahead of the marketing-site build so the site agent starts from
> ruled copy, not a blank page. Voice: confident, concrete, anti-hype — the
> product's differentiator IS honesty, so the copy must never overclaim.
> Everything here is a draft for director review.

## Positioning (one paragraph, internal)

Skillmaker Studio is for people who ship agent skills they need to trust.
The market's default is a bare SKILL.md of unknown pedigree — copied from a
gist, tweaked until it seemed to work. Skillmaker treats the skill as a
product: designed with recorded reasoning, produced through human-gated
stages, evaluated against typed failure classes, and shipped with measured
evidence pinned to exact versions. The tagline space is "receipts for your
skills."

## Hero

**H1:** Ship agent skills with receipts.

**Sub:** Skillmaker Studio turns SKILL.md from a paste of unknown pedigree
into a measured, versioned, human-approved product — research, design
rationale, eval fixtures, and pass rates included.

**CTA:** `bun install -g skillmaker` → *Get started* (adjust to real
install story when Phase 12 lands)

### Hero alternates (director pick)

- H1: The skill is not the file. / Sub: The file is the output. Skillmaker
  keeps the asset — the thinking, the evals, the evidence — and ships the
  file.
- H1: Your agent skills, proven. / Sub: Design, evaluate, and publish
  skills for Claude Code and Codex — with pass rates, not vibes.
- H1: Stop pasting. Start proving. / Sub: A studio for building agent
  skills you can defend.

## The three pillars (feature triptych)

**1. Design is a first-class artifact.**
Every skill carries a design doc: intent, triggers, the workflow, failure
hypotheses. Six months later you'll know *why* the skill is shaped the way
it is — and so will the next person.

**2. Evals with honest math.**
Fixture cases by failure class — golden, refusal, empty-input, rerun,
hard-case — mapped against five risk families. Coverage ("a fixture
exists") and validation ("passes at 28/30 on claude-code") never merge.
A single run is a sample, not a measurement.

**3. A production line, not a folder.**
Skills move `idea → researching → drafting → evaluating → published`
through guarded gates: forward requires an approved review, publishing
requires the gate, and moving backward is legal — regression is a modeled
fact. Every decision lands on an append-only, git-tracked journal.

## Secondary features (grid)

- **Two doors, one ground.** CLI and live board share the same journal —
  agents work the CLI, humans judge in the browser, nothing desyncs.
- **Version-pinned evidence.** Measurements bind to the content hash they
  exercised. Change the skill, and the numbers honestly reset to
  "not yet measured."
- **Drift you can see.** Hand-finish your SKILL.md freely — the studio
  shows *that* it diverged from the design, and when, without policing it.
- **Journal-native todos.** The work-tracking lives in the same event
  stream as everything else. `git log` is your audit trail.
- **The skillbook.** (post-v1) Generated docs for your whole skill set —
  design rationale, changelogs, and pass rates inline. Publishable.
- **Agent-first production.** (post-v1) Stations run over ACP: an agent
  researches, drafts, and evaluates; you approve at the gates. William,
  the studio's own agent, ships with skills for writing skills.

## How it works (3 steps)

1. **`skillmaker new`** — scaffold a Skill Bundle: design doc, fixtures,
   output slot, stations.
2. **Build and prove** — draft SKILL.md from the design, add fixtures by
   failure class, run them against real agents, grade the read-outs.
3. **`skillmaker advance`** — move through the gates to published, with
   the journal recording every judgment. Ship the output; keep the asset.

## Objection handling (FAQ seeds)

- *"I can just write a SKILL.md by hand."* You can — and Skillmaker won't
  stop you (hand-edits are legal, drift is displayed, not punished). The
  studio earns its keep the first time a skill misbehaves and you need to
  know what changed, what was tested, and what was approved.
- *"Is this only for Claude?"* Bundles target any ACP-drivable agent；v1
  evals run claude-code, codex next. One skill, measured per provider.
- *"Where does my data live?"* In your repo. Files + a git-tracked JSONL
  journal. SQLite is a throwaway index. No server, no account.

## Voice guardrails (for the site agent)

- Never claim measurement that hasn't happened; the product's empty states
  say "not yet measured" and the copy must match that ethic.
- Concrete nouns over adjectives: fixtures, pass rates, gates, journal —
  not "powerful," "seamless," "magical."
- The audience: developers already shipping agent skills, and teams who
  need to trust each other's. Not AI-curious tourists.

## Open for director ruling

- Tagline pick (or a new one).
- "Receipts" as the recurring metaphor — lean in or vary?
- Install story wording (blocked on Phase 12's real artifact).
- Whether William is marketed at launch or kept post-v1 quiet.
