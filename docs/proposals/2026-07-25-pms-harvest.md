# The PMS Harvest: What Playmaker Studio Still Knows

*Working notes — Jess × Raven, 2026-07-25, from a director click-through of
the live Playmaker Studio (alexandria-internal `packages/pms/`, running
locally) plus a code recon. PMS is Danvers' build; several of its ideas
never made the Playmaker → Skillmaker migration and still earn their keep.
Nothing here is ruled except where marked; the Evals items are explicitly
UNSETTLED by the director's request.*

## Why we looked

Two open questions sent us back: (1) does our stage model survive the new
shell (the director's doubt: stages barely surface anymore — the tabs
became the real mental model), and (2) how should the center panel's
Research/Eval surfaces mature. PMS solved neighboring problems through
real use; Danvers' answers are prior art we own.

## What PMS does that we ported already (validation)

- Overview / Design / Play Testing split ≈ our Overview / Research / Eval
  tabs (his are a left rail; ours horizontal folder tabs).
- Authored **Coverage** vs measured **Validation** as two never-merged
  axes — identical to our claims rule (IA §C).
- A stage ladder Board — with one difference worth studying (below).

## The harvest (steal-list)

### 1. Preflight + Diagnostics — free value for every skill *(task #1, held with Evals)*

PMS gives every play two fixture-free lenses: **Preflight** ("does it
run?" — deterministic build-validity; *blocks the other lenses until
green*) and **Diagnostics** ("where is it fragile?" — reference-free
system health: agency boundary, loop bounds, timeouts). The flat-skill
analogs cost nothing to author:

- *Preflight:* SKILL.md parses; frontmatter valid; description present and
  within budget; referenced files resolve; no name collision at the
  install target; size/token budget.
- *Diagnostics:* the tool surface the instructions assume; stale path
  references; injection-shaped content lints; "description unlikely to
  trigger" heuristics.

Placement (when Evals unfreezes): above Coverage in the Eval tab, keeping
PMS's blocking rule.

### 2. Coverage presentation *(task #2, held with Evals)*

His info-org beats ours with the same data: family bands carrying a
one-line question ("Reasoning — *is the model's thinking sound?*"),
claim-first rows with per-fixture sublines (fixture · class · built ·
N runs · validation state), a one-sentence legend stating the two axes,
and a summary count line. Also noted by the director: our
runs-inline-under-row accordion is not convincing — his
fixtures-as-sublines with validation chips (transcripts elsewhere) reads
better. **Unsettled; no build until ruled.**

Structural note: PMS treats the **Risk Map and Play Testing as different
things** — an authored artifact and a set of measurement lenses. We
collapsed them into one surface; the collapse may be part of why our Eval
tab feels unresolved.

### 3. Overview enrichment *(task #3)*

- **"Reach for it when"** — the trigger conditions, stated honestly (and
  in our world this is nearly the frontmatter `description`, the string
  that *actually* drives invocation — surfacing it as prose closes a loop).
- **"The play in use"** — an authored user story. Clever, cheap, humanizing.
- **"When it fires"** — matters the day skills invoke skills (chains);
  noted, deferred until that day.

Depends on authoring conventions → coordinate with William's prompt work.

### 4. Design-history depth *(task #5)*

PMS's Design view: a sub-nav across the design trail (grounding →
extracted-claims → brief → hardening/lint) plus an **Improvement Plan
kanban** rendered from `improvements.md`. And instead of file-level
read/unread, PMS tracks **thread resolution-state** (Open / resolved /
invalidated, badge = unresolved count) — a judgment-shaped concept, richer
than our event-stamp dot. Our Research tab renders two files; the gap is
generational. Grow toward this once conventions exist.

### 5. The Board's confirm mechanic (bears on the stage-model doubt)

PMS cards show **"● ready"** when a stage's work is done and wait for an
explicit director **"▸" confirm** to advance. Stages there are *records of
director confirmations*, not rooms work sits in. If our stage ladder
survives the upcoming from-scratch user test, this is likely the honest
semantics for it; if it doesn't, the ready/confirm pattern may survive the
ladder's death as the shape of review itself.

### 6. Play Tracker — unexplored *(task #6)*

The director suspects more portable ideas live there. Cheap recon queued.

## The big one: step-graph authoring *(task #4)*

Separately proposed in
[`2026-07-25-step-graph-authoring.md`](2026-07-25-step-graph-authoring.md)
— skills authored as a series of steps, rendered out to flat SKILL.md.
Restores the possibility of "The play, drawn" (postponed — needs the graph
format first) and **Play Walk** (the skill presented as a story with
golden path + branch callouts), which the director rates as PMS's
strongest presentation idea.

## Open questions this trip sharpened

1. **Does the stage ladder survive?** The shell's tabs are activities, not
   stages; stages surface in exactly three places now. The from-scratch
   user test (fresh project, fresh skill, no CLI) is the instrument.
   PMS's confirm-mechanic is the leading alternative semantics.
2. **Is Evals one surface or two?** (Risk map as artifact vs. testing as
   lenses.) Unsettled by the director; both held tasks wait on this.
3. **What is the authoring source of truth** if step-graphs land —
   design.md, a new graph file, or SKILL.md itself? (Proposal doc's core
   question.)

## Running PMS (for future reference)

`pnpm --filter @alexandria/pms-viewer run build` once, then
`bun packages/pms/src/cli/main.ts start` from the alexandria-internal
root → http://127.0.0.1:4322 (real plays included in-repo).
