# Phase 14 Prep — Migrating the Playmaker's Studio Library into Skillmaker Studio

> **Status:** prep document, read-only investigation. Written ahead of Phase 14
> (see `plan.md` — Phase 14 is explicitly LAST). Does not migrate any cards.
> Source: `alexandria-internal/studio/sweeps/playmaker-studio/` (91 stub cards
> + apparatus) and `alexandria-internal/studio/library/` (9 earlier cards).
> Target: `data-model.md` + `plan.md` in this repo.

## 0. How to read this doc

Section 1 is the card-by-card disposition table (the bulk of the work).
Section 2 is the vocabulary map. Section 3 resolves every recorded hot spot
against the new model. Section 4 lists net-new concepts the old library never
had a card for. Section 5 proposes a target context layout. Section 6 is the
open-question list for the director.

Dispositions used: **KEEP** (still true, light vocab edit only), **REWRITE**
(concept survives, content must change), **MERGE** (folds into another
card), **RETIRE** (names dropped machinery), **NEW-HOME** (concept moves
context/becomes a different kind of artifact, not a straight rewrite).
⚠ = genuinely uncertain, flagged for the director.

---

## 1. Disposition table

### 1.1 `_index`

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Concept - Playmaker's Studio | _index | REWRITE | Becomes `Concept - Skillmaker Studio`. New one-sentence model (§1.0 of data-model.md: bundle is durable, SKILL.md is an output). New WHY (agent-first + graded read-out honesty, not "Director never reads code"). New WHERE (repo `skills/`, viewer `skillmaker start`). Keep the keystone altitude and the role as reading-order spine. |

### 1.2 `production-ladder` → target `production`

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Pattern - Production Ladder | production-ladder | REWRITE | Six-stage ladder (Backlog→Sourced→Designed→Built→Proven→Live) becomes the five-state machine (idea→researching→drafting→evaluating→published) + archived. "One stage per confirm" becomes "guarded transition, forward requires `review.resolved:approve`." Resolves hot-spot-two-advancement-mechanisms (§3.1). |
| Pattern - Make-a-Play Arc | production-ladder | RETIRE | Self-hosting meta-play (Design→Build→Prove `ax run` modules) is Fabro/Alexandria machinery. Self-hosting *itself* survives (data-model.md "Self-hosting" ruling) but as a repo convention, not a played workflow — no card-level analog. |
| Mechanism - Stage | production-ladder | REWRITE | Becomes the `stage` field on `bundles` (journal fold, §2.11) — one state set, not "stage vs status." Resolves the stage/status polysemy directly. |
| Mechanism - Director Gate | production-ladder | REWRITE | Splits into two mechanisms in the new model: the per-station **review pair** (non-blocking, §2.13) for ordinary forward transitions, and the **publish gate** (`bundle.gate_decided`) for evaluating→published only. "Two gates, both Director" becomes "N review pairs (one per state) + one terminal gate." |
| Component - Design Confirm | production-ladder | MERGE | Into the rewritten Director Gate / review-pair card — it's just the drafting-state instance of `review.resolved:approve`, not a distinct mechanism anymore. |
| Component - Proven Confirm | production-ladder | MERGE | Into the publish-gate card — it's the evaluating→published instance, now literally `bundle.gate_decided`. |
| Economy - Ready Marker | production-ladder | REWRITE | Becomes the `awaiting-review` substate (§2.13) — the same "work done, awaiting confirm without changing the stage" idea, but now a first-class substate on the journal fold instead of a `ready[]` array in a mutable JSON file. |
| Economy - Stage Status | production-ladder | MERGE | Into the rewritten Mechanism - Stage card; "the value that makes the Board legible" is now just `bundles.stage` in SQLite. |
| Mechanism - Auto-Advance Contract | production-ladder | RETIRE | The five-condition self-promotion contract is explicitly what the two-advancement-mechanisms hot spot flagged as contested; the new model rules in favor of the single guarded-transition mechanism and drops auto-advance entirely (no card, no software, ruled). |

### 1.3 `board` → target `board` (todos + viewer, much smaller)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Entity - Board State | board | RETIRE | `board-state.json` (mutable JSON) is explicitly killed — "There is no mutable state JSON (no `board-state.json` descendant). The board *is* a journal replay." Direct match to "board-state mechanics" named for retirement in plan.md. |
| Surface - Board | board | REWRITE | Still the home Director/human surface, but now `derived_from` the journal fold (SQLite `bundles` table), not a mutable file. Columns become states, not the old six stages. |
| Component - Board Column | board | REWRITE | `derived_from Mechanism - Stage` survives conceptually as "derived from the state machine's state list" — keep the shape, replace six stages with five states + archived. |
| Component - Play Card | board | REWRITE | Becomes the Bundle card: slug/name/tags, stage badge, substate badge (awaiting-review), no more Division/Function glyph (org spine gone). |
| Capability - Graduate | board | MERGE | Into `bundle.archived`/`bundle.restored` (§2.9) — same reversible off/on-the-board idea, now a plain journal event pair, no separate "graduate" verb or `graduated[]` set. |
| Mechanism - Archive | board | REWRITE | The terminal + N-day-window + pinned-override archive rule is explicitly inherited (`archived?: boolean` derived field, §2.10, "[inherited window]") — keep the mechanism, retarget it from Work Order cards to Todos. |
| Entity - Work Order | board | REWRITE | Becomes `Todo` (§2.10) — same "second thing the board tracks, independent of bundle stage" idea. Kind enum narrows from {Testing, Improvement, Bug} to {task, bug, improvement, eval}. |
| Component - Testing Card | board | RETIRE | The "exactly one testing card per play, auto-seeded" rule is explicitly dropped: "Dropped: exactly-one-testing-card-per-play." Testing work becomes ordinary `eval`-kind todos or just eval runs directly — no forced 1:1 card. |
| Component - Bug Card | board | MERGE | Into `Todo` as `kind: "bug"` (default priority 10 survives verbatim in §2.10). |
| Component - Improvement Card | board | MERGE | Into `Todo` as `kind: "improvement"` (default priority 20 survives). The "absorbs the old decision queue" framing doesn't carry forward explicitly — flag if that use case still needs a home. |
| Component - Checklist | board | REWRITE | Survives as `Todo.checklist` (`{text, done}[]`, §2.10) — no longer Testing-Card-only, any todo may carry one. |
| Economy - Priority | board | REWRITE | Becomes `Todo.priority` — same "lower is more urgent" rule, same default-by-kind pattern (bug 10, eval 15, improvement 20, task 30 — note "eval" is a new kind here, "task" replaces the old generic default). |
| Economy - Work Order Status | board | REWRITE | Becomes `Todo.status` (open/in-progress/done/wont-do — identical enum) — "wholly independent of a Play's stage" is now literally law §1.3 ("Todo status and bundle stage are independent axes"). |
| Surface - Work Order Lane | board | MERGE | Into the viewer's todos panel (plan.md "Viewer surfaces" §1: "todos panel"); no longer a three-lane sub-surface below the Board specifically, just the todo queue. |

### 1.4 `catalog` → **no direct successor context** (org spine dropped)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Reference - Company | catalog | RETIRE | Org spine (Company/Division/Function) explicitly dropped, ruled 2026-07-10. |
| Reference - Division | catalog | RETIRE | Same. Its Face Agent derivation also drops. |
| Reference - Function | catalog | RETIRE | Same. Filing role replaced by flat `tags[]` (ruling B). |
| Surface - Catalog | catalog | RETIRE | The Division→Function→Play tree page has no successor; bundle listing is just the Board / `skillmaker list`. |
| Entity - Play | catalog | REWRITE | The central rename: **Play → Skill Bundle**. Identity fields shrink to `bundle.json` (§2.3: slug/name/oneLiner/tags/created/targets) — no Tier, no Division/Function, no status. |
| Economy - Criticality Tier | catalog | RETIRE | Golden-Path prio banding (core/input/stretch/parked) has no analog; flat tags[] replaces all filing/banding. |
| Economy - Role Tier | catalog | RETIRE | Build-an-employee tier sheet (Coordinator/PM/Senior) is Alexandria-Raven-specific product furniture, out of skillmaker's scope entirely. |
| Pattern - Golden Path | catalog | RETIRE | Raven-specific demo chain; no skillmaker analog (skillmaker has no "Raven's role sheet"). |
| Reference - Legacy Status | catalog | RETIRE | Already flagged for demotion in the old library (registry.js `status:` superseded by board-state); doubly moot now that stage/status collapse into one `bundle.stage` field. Resolves the stage/status polysemy from the other direction (see §3.13). |
| Role - Face Agent | catalog | RETIRE | "face-agent-as-container" explicitly named for retirement in plan.md. |
| Role - Raven | catalog | RETIRE (in this context) | Raven-as-Division-face-agent framing retires with the org spine. Raven-the-persona is an Alexandria product concept, out of skillmaker's scope — no card here at all, not even rewritten. |
| Role - William | catalog | REWRITE | William survives explicitly: data-model.md §2.13 names him "William ships as the product's agent with his own skills for writing skills." Card needs a full rewrite away from "face agent of the PlaymakerStudio Division" to "the product's own agent, driving station runs via his own skill-writing skills in the self-hosted `skills/` workspace." ⚠ Consider deferring the rewrite to Phase 10 (when William's actual skills exist) rather than guessing his shape now — see open question 6. |

### 1.5 `authoring` → target `authoring` (much smaller — Fabro machinery mostly drops)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Entity - Brief | authoring | REWRITE | Direct rename: **Brief → `design.md`** (§2.4). Keeps "the Director-owned source of the play's logic, prompts hold only the task" spirit, but the required §4 move-graph shape becomes a recommended-not-enforced prose skeleton (Intent / When to use / The workflow / Failure hypotheses / Proof spec). |
| Component - Move Graph | authoring | RETIRE | No move-graph authoring model in v1 — `design.md`'s "The workflow" section is prose, not a doer/contract/bounce-edge graph. |
| Component - Move | authoring | RETIRE | Same — no per-step node record; SKILL.md is a single flat output. |
| Component - Node Prompt | authoring | RETIRE | No per-move prompt files; one SKILL.md body. |
| Economy - Doer | authoring | NEW-HOME | The judgment/mechanical/human per-*move* label retires with the move graph, but the underlying idea survives one altitude up: `stations.json`'s per-*station* `doer: "agent" \| "human"` field (§2.13). Worth a slimmer card at the new altitude, not a straight port. |
| Reference - Doer Honesty | authoring | RETIRE | The mislabeled-doer standard was specific to per-move honesty; with doer collapsed to per-station agent|human, the sharpest form of this risk (automating a judgment call) is much reduced but not zero — ⚠ flag whether a station-level honesty note is still worth authoring. |
| Capability - Harden | authoring | NEW-HOME | The fresh-eyes interview (Outcome/Reasoning/Breakdown + state audit) is a strong, portable pattern but has no dedicated step in the new model — it's exactly the kind of thing a `researching` or `drafting` station's skill (a William skill) could run. Best captured as guidance inside a station skill description, not a studio-core mechanism card. |
| Role - Hardener | authoring | NEW-HOME | Same — folds into whichever station skill implements the harden interview, not a standing studio role. |
| Capability - Derive | authoring | RETIRE | The brief→workflow-package projection step is gone outright — no separate "derive" phase; a station's skill (e.g. `william/draft-skill-md`) directly produces `output/SKILL.md` from `design.md`. |
| Reference - Projection Standard | authoring | RETIRE | PROJECTION.md's studio-construct→Fabro-construct rulebook has no target — there's no Fabro construct to project into. Named explicitly for retirement. |
| Entity - Workflow Package | authoring | RETIRE | `workflow.fabro` + prompts/ + run config has no successor entity; replaced by the flat `output/` tree (SKILL.md + siblings, §2.7). |
| Role - Author | authoring | RETIRE | The agent role that ran Derive retires with Derive; station work is done by whichever agent the station config names, not a standing "Author" role. |
| Capability - Lint | authoring | MERGE | The mechanical-contract-check idea survives as `reindex` validation (Mechanism - Data Validator, proving context) — "warnings, never hard-fail" (ruling I) replaces Protocol A-D pass/fail lint. Protocol E specifically (brief↔workflow parity) is superseded by the drift hint (§2.7), which is deliberately *not* enforced. |
| Role - Checker | authoring | RETIRE | The role that ran Lint retires with it; no standing Checker agent — reindex is a CLI mechanism, not an agent role. |
| Mechanism - Sync Rule | authoring | RETIRE | "Edits land in the brief and re-derive" + `play-resync.py`'s stale-cone recompute is exactly the "resync cone" named for retirement. Replaced by the drift hint, which surfaces drift instead of preventing it. |
| Surface - Diagram | authoring | RETIRE | `diagram.svg` generated from the workflow graph has no source graph to generate from. "Derived renderings" retirement, direct hit. |
| Surface - Story View | authoring | RETIRE | `story.md`, same — a derived rendering of the workflow package. |
| Reference - Moves Overlay | authoring | RETIRE | Authored per-move story prose keyed to move ids — no moves to key to. |
| Reference - Synopsis | authoring | NEW-HOME | The "What it does / Reach for it when / The story / Trigger" explainer becomes a per-skill skillbook chapter (§2.14), generated from `design.md`'s Intent/When-to-use sections rather than authored as a separate `synopsis.md` file. |
| Reference - Untrusted-Input Rule | authoring | KEEP | Directly inherited: "adversarial fixtures may plant untrusted-input attacks in `files/`" (§2.5) is verbatim the same rule. Light vocab edit only (move context to `evals`, since it's now a fixture-authoring rule more than a prompt-authoring rule). |
| Role - Director | authoring | KEEP | The human decider survives as the human resolving reviews and the publish gate — light rewrite to describe `review.resolved`/`bundle.gate_decided` instead of the Board's ▸ advance button, but the role itself (owns intent/judgment, never authors, only approves) is unchanged. |
| Role - Grader | authoring | REWRITE | Ruling E: "human-in-viewer from day one — the graded read-out experience is core magic to port." The old model's fresh-eyes *agent* grader (blind to other graders, grading against the answer key) becomes the *human* grading in the viewer's read-out surface (§2.12). The blind-agent-grader pattern itself doesn't have a stated home in the new model — ⚠ flag. |

### 1.6 `proving` → target `evals` (mostly KEEP — this is the inherited-laws spine)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Entity - Fixture | proving | KEEP | Direct match to `evals/fixtures/<case>/` (§2.5); light rewrite for path/`case.json` shape. |
| Reference - Fixture Kit | proving | KEEP | golden/refusal/empty/rerun/hard-case classes are cited verbatim in `case.json`'s `class` enum (§2.5) and named an inherited law in plan.md. |
| Component - Answer Key | proving | KEEP | "Grading-only, never enters the agent's workspace" is verbatim inherited (§2.5 rule + §1 law list). |
| Reference - Untrusted-Input Rule | (dup, see authoring) | — | Listed once; see authoring row. |
| Entity - Risk Map | proving | KEEP | `evals/risk-map.md` (§2.6) — same shape, minus a results column (validation is now computed/joined at read time, never stored, "law §1.4"). |
| Reference - Risk Family | proving | KEEP | IN/RE/OUT/ADV/CHN families are cited by id verbatim in §2.6 ("machine-checked at reindex"). |
| Economy - Coverage | proving | KEEP | The authored axis, "law §1.4: Coverage and validation never merge" is an inherited law, direct spine card. |
| Economy - Validation | proving | REWRITE | Concept survives but implementation changes: no longer a stored/computed field on the risk map row — it's now purely a viewer-time join (§2.12), "not yet measured" the default. |
| Economy - Pass Rate | proving | KEEP | n·pass-rate·CI, never pooled — law §1.5, cited nearly verbatim. |
| Reference - Measurement Policy | proving | REWRITE | The smoke/estimate/ship-gate k-tiers (k≈5/30/100) aren't restated in data-model.md explicitly — the CI/rule-of-three mechanism is kept (§2.11: "CI (rule-of-three when 0 failures, else binomial)") but the named k-tier policy table itself should be re-authored to confirm it still holds, or replaced by whatever the eval surface actually enforces once Phase 7/9 ship. ⚠ flag as likely-KEEP-but-verify-against-shipped-behavior at Phase 14 time (per the plan's own verification instruction). |
| Capability - Dry-Run | proving | REWRITE | Direct rename: **Dry-Run → eval run** (`Run.kind: "eval"`, §2.8). `ax run <slug> --fixture <case>` becomes `skillmaker run <slug> --fixture <case>`; the embedded-Fabro execution model is replaced by the ACP-subprocess run engine. |
| Entity - Read-Out | proving | REWRITE | No longer a stored `read-out.md` file — the read-out is explicitly "a viewer surface, not a stored artifact" (§2.12), reconstructed live from runs + risk-map + measurements. Same magic, different storage law. |
| Capability - Coverage Lens | proving | KEEP | Becomes the eval surface's coverage axis per provider (plan.md viewer surfaces §3); same "what's covered" lens. |
| Capability - Cold-Reader Gate | proving | NEW-HOME | The comprehension-check pattern (fresh agent reads an artifact cold, must reconstruct context) has no named home in data-model.md. Worth proposing as a `case.json` grading-checks pattern or a fixture class, not a standing capability. ⚠ flag — see open question 3. |
| Capability - Preflight | proving | RETIRE | "Does it run?" deterministic build-validity lens over the workflow graph + prompt contracts has no graph to check in v1 (flat SKILL.md, no Fabro compile step). |
| Capability - Diagnostics | proving | RETIRE | Same — reference-free system-health lens over workflow-graph contracts; no graph. |
| Mechanism - Data Validator | proving | REWRITE | Direct match to `reindex` validation (§2.11, Part 3 ruling I) — but the old model's checks hard-fail CI ("failing the build on a malformed record"); the new model explicitly reverses that: "Reindex validation surfaces warnings, never hard-fails... right for a product." This is a philosophy flip worth calling out in the card, not just a vocab edit. |
| Reference - Known-FPs Ledger | proving | ⚠ | No stated home in the new model. The pattern (a per-bundle ledger of dispositioned false-positive flags, cited with provenance) is genuinely useful and cheap; nothing in data-model.md rules it out, it's just unmentioned. Recommend KEEP as a candidate new/optional file under `evals/`, pending director confirmation — see open question 2. |

### 1.7 `runs` → target `runs` (partly KEEP — journal/ACP/review-pair spine — partly RETIRE — Fabro-specific)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Entity - Ledger | runs | REWRITE | Direct rename: **Ledger → journal** (`.skillmaker/events.jsonl`, §2.9). "Runtime is the only writer, agent never appends directly" survives as "Writes go only through the CLI/server, never freehand." |
| Component - Lifecycle Event | runs | KEEP | The event-envelope idea (idempotent, one entry naming something that happened) is directly inherited — §2.9's envelope shape (schemaVersion/id/type/at/actor/idempotencyKey/payload) is a rewrite-for-shape but a keep-for-concept. |
| Mechanism - Human-Input Pair | runs | KEEP | This *is* the spine card resolving hot-spot-two-human-gate-models: cited practically verbatim in data-model.md §2.13 ("[inherited] the non-blocking review pair... Human gates are data, never a blocked process"). Rename request/resolve verbs to `review.requested`/`review.resolved`. |
| Component - Review Unit | runs | REWRITE | The "one thing reviewed at a time, a slot/question/section, never a boolean" idea survives as the per-station unit of work under review — but the canonical example (Vision's nine slots) is Alexandria-specific and retires; needs a skillmaker-native example once one exists. |
| Economy - Needs-You State | runs | MERGE | Into the `awaiting-review` substate (§2.13) — same "Raven needs you" idea, generalized and renamed. No skillmaker-specific badge text yet. |
| Economy - Run State | runs | REWRITE | The on-track/running-slow/stuck/refused/blocked/failed/infra-error/done enum shrinks to `run.json`'s `status: running \| completed \| failed \| infra-error` (§2.8) plus a separate `verdict: pass \| fail \| partial` on the grading event. The old model's "distinct failure exits kept apart, ledger collapses them, Tracker re-splits" tension is *not* fully resolved by the new shape — see hot-spot resolution §3.9 and open question 1 (is there a place for "refused" specifically?). |
| Entity - Play Run | runs | REWRITE | Direct rename: **Play Run → Run** (`runs/<run-id>/run.json`, §2.8). The demotion the old library already proposed is now enacted structurally — Run is explicitly a record (files/journal split, §1.3), never promoted to a catalog entity. Confirms hot-spot-play-run-over-promotion. |
| Mechanism - Embedded Factory | runs | RETIRE | "The Fabro that Alexandria itself boots... the only factory plays run on" has no analog — v1 has no Fabro at all (plan.md: "No Fabro in v1"). Replaced by the ACP-subprocess run engine (create temp workspace → install skill → launch provider over ACP → capture transcript, §2.8). |
| Reference - ACP Provider | runs | KEEP | Directly survives: `skillmaker.config.json`'s `providers` map (§2.2) is the same "configured agent backend, never hardcoded in the deployable, injected at materialization" idea, now for claude-code and codex specifically. |
| Capability - Output Bank | runs | REWRITE | Direct rename: **banked → published** (`skill.published` journal event, §2.9). "Deliverable to library/state" becomes "deliverable to a publish target" (git-dir first, §2.2/plan.md). |
| Capability - Package Bank | runs | RETIRE | `bank.sh`'s studio→plugin code-deploy step has no analog — there's no separate "plugin" this ships code into; publish targets are the whole deploy story. Resolves hot-spot-bank-polysemy by leaving only one bank concept standing. |
| Component - Subscription | runs | ⚠ | The "which events wake which behavior" binding has no explicit successor. Station-driven production (§2.13) is agent-first and ACP-launched, but it's unclear whether v1 has any autonomous "journal event → wake an agent" mechanism, or whether every station run is explicitly launched (by CLI/viewer action) with no standing subscriptions. Flag — see open question 4. |
| Mechanism - Wake | runs | ⚠ | Same uncertainty as Subscription — no stated wake mechanism in data-model.md. Possibly out of scope for v1 entirely (agent runs are launched, not autonomously reactivated) — recommend RETIRE unless the director confirms a wake mechanism is planned. |
| Reference - Raven Vision | runs | RETIRE | The worked exemplar is Alexandria/Raven-specific product furniture, out of skillmaker's scope. The *pattern* it demonstrated (non-blocking review pair) is preserved via Mechanism - Human-Input Pair; the specific example retires. |
| Mechanism - Review Levels | runs | RETIRE | Card's own confidence was already `low` — "a specced design artifact," never fully built even in the old product. No mention in the new model; low-regret retire. |
| Surface - Play Tracker | runs | MERGE | Into the viewer's Activity feed (plan.md viewer surfaces §4: "the journal rendered as a feed") — the director-facing "plays in flight" live view has a rough successor there, though the new model doesn't describe a dedicated in-flight-runs surface as explicitly as the old Tracker. ⚠ minor — worth confirming at Phase 3/9 build time whether a Tracker-equivalent is still wanted. |
| Surface - Factory Runs | runs | MERGE | Into the eval surface's run list (plan.md viewer surfaces §3: "run launcher... run read-outs with transcripts") — the raw-event debug view folds into the same eval-run detail view rather than staying a separate tab. |

### 1.8 `studio/library/` (the earlier, smaller card set)

| Card | Context | Disposition | Notes |
|---|---|---|---|
| Aggregate - Board State | board | RETIRE | Same reasoning as sweep's Entity - Board State — duplicate coverage of the same mutable-JSON concept, now dropped. |
| Aggregate - Board | board | REWRITE | Same reasoning as sweep's Surface - Board — duplicate coverage, superseded by the sweep card's more complete version; this earlier card can simply be dropped in favor of migrating the sweep card. |
| Read-Model - Play Registry | catalog | RETIRE | `registry.js` identity/status ladder — org spine + Legacy Status both drop; `bundle.json` is the new identity file (no separate "registry" read-model, identity lives with the bundle itself, files-are-canonical per ruling A). |
| Value - Job Category | board | RETIRE | "One of the eight job categories" (never fully enumerated even in the source) — org-spine adjacent, drops with Division/Function. Also already flagged as a documentation gap in its own card ("docs don't enumerate the eight") — a stale unresolved gap, not worth carrying forward. |
| Value - Prio | board | RETIRE | Golden-path core/input/stretch/parked banding — duplicate of sweep's Economy - Criticality Tier, same retirement reasoning. |
| Value - Stage | board | MERGE | Into the single `bundle.stage` field — this card and Value - Status are literally the recorded stage/status polysemy hot spot (`thread:studio-board-stage-status-polysemy`); the new model's ruling F collapses both into one state set. |
| Value - Status | board | MERGE | Same merge target as Value - Stage — see §3.13. |
| Value - Tier | board | RETIRE | coordinator/manager/senior authority class — duplicate of sweep's Economy - Role Tier; same retirement reasoning, and the card's own text admits "docs don't explain rationale." |
| Value - Empty HOW Fixture | readiness-fixture | RETIRE | Not a product-knowledge card at all — it's a test fixture for the card-library tooling's own fill-readiness tests (`docs/alexandria/plans/_archive/preliminary-library-build/`). Should never have migrated as product knowledge; drop outright. |

---

## 2. Vocabulary map

| Old term | New term | Notes |
|---|---|---|
| Play | Skill Bundle (bundle) | Central rename. |
| Brief | `design.md` | Source file, prose not move-graph. |
| Workflow Package (`workflow.fabro`) | `output/SKILL.md` (+ siblings under `output/`) | No compile step; hand-editable output. |
| Derive | (station work — e.g. `william/draft-skill-md`) | No separate derive phase. |
| Register / registered | published (`skill.published`) | Publishing is its own gated transition, decoupled from "end of ladder." |
| Banked / Output Bank | published | Same journal-event rename. |
| Package Bank (`bank.sh`) | *(no analog — publish targets are the whole story)* | |
| Dry-run | eval run (`Run.kind: "eval"`) | |
| Play Run | Run (`runs/<run-id>/`) | Demoted to a record, never a catalog entity. |
| Read-out (`read-out.md`) | read-out (viewer surface, not a file) | Same name, different storage law. |
| Director confirm / Gate | review approve (per-station) / publish gate (evaluating→published only) | Two distinct mechanisms replace one "Director Gate" umbrella. |
| Ready marker | `awaiting-review` substate | |
| Board State (`board-state.json`) | journal fold (materialized `bundles` table) | No mutable state file. |
| Work Order | Todo | Kind enum: task/bug/improvement/eval. |
| Stage (Board column) / Status (proving ladder) | `bundle.stage` (one state set) | Resolves the stage/status polysemy. |
| Production Ladder (Backlog→Sourced→Designed→Built→Proven→Live) | state machine (idea→researching→drafting→evaluating→published, +archived) | |
| Ledger (`events.jsonl` under RUNTIME.md) | journal (`.skillmaker/events.jsonl`) | Same mechanics, same union-merge, new home. |
| Human-Input Pair | review pair (`review.requested` / `review.resolved`) | |
| Needs-You State ("Raven needs you") | `awaiting-review` substate | Merged with Ready Marker's successor. |
| Embedded Factory (Fabro) | ACP run engine (subprocess) | No Fabro in v1. |
| Doer (per-move: judgment/mechanical/human) | station `doer` (per-station: agent/human) | One altitude up. |
| Company / Division / Function (org spine) | `tags[]` (flat) | Ruling B. |
| Criticality Tier / Golden Path | *(no analog)* | Dropped with org spine. |
| Face Agent | *(dropped as a mechanism)*; William survives as a named product agent | |
| Synopsis (`synopsis.md`) | skillbook per-skill chapter (generated from `design.md`) | |
| Sync Rule / resync cone / Protocol E | drift hint (`in-sync` / `design-changed` / `output-hand-edited` / `both`) | Displayed, never enforced — philosophy flip. |
| Lint (Protocols A–D) | `reindex` validation | Warnings, never hard-fail (ruling I) — another philosophy flip. |
| Legacy Status | *(retired outright)* | |

---

## 3. Hot-spot resolutions

Numbering follows `HOT-SPOTS.md` / `threads.json`.

1. **Two advancement mechanisms** (manual Director confirm vs. auto-advance
   contract) — **RESOLVED.** The new model has exactly one advancement
   mechanism: a guarded `bundle.stage_changed` transition, forward guard =
   `review.resolved:approve`, publish additionally requires
   `bundle.gate_decided:approved`. No auto-advance contract exists in the
   new model; it is not ported.
2. **Two human-gate models** (blocking Fabro hexagon vs. non-blocking
   event-sourced pair) — **RESOLVED.** Only the non-blocking pair survives,
   explicitly cited as `[inherited]` in §2.13. There is no Fabro node of any
   kind in v1, so the blocking model isn't merely deprecated, it has no
   substrate to exist in.
3. **"Register" timing disagreement** (README end-of-line vs. Derive-seam) —
   **RESOLVED, differently than either side.** There's no single "register"
   step to place. Versioning (`skill.version_recorded`) and publishing
   (`skill.published`) are separate, explicit, non-ladder-bound actions —
   publishing is its own gated transition (evaluating→published) rather
   than a step embedded in some other phase. The old debate ("which end of
   the ladder does register sit at") dissolves because registration is no
   longer implicitly ladder-positioned at all.
4. **Derived-rendering drift hazard** (one source, five derived renderings,
   guarded by Protocol E + check-moves + resync) — **RESOLVED, by
   inversion.** The new model doesn't prevent drift by construction; it
   allows hand-editing `output/` and *surfaces* drift via the hint
   (`design-changed`/`output-hand-edited`/`both`), "deliberate hand-finishing
   is legitimate; the model records that and when, not that it's wrong."
   There is also only one derived-ish artifact (`output/SKILL.md`) instead
   of five, so the blast radius of drift shrinks even before the philosophy
   changes.
5. **"Tier" polysemy** (Criticality Tier vs. Role Tier) — **MOOT.** Both
   sides of the split retire with the org spine / golden path; flat
   `tags[]` replaces both. Nothing to resolve because neither concept
   survives.
6. **"Bank" polysemy** (Output Bank vs. Package Bank) — **RESOLVED by
   elimination.** Output Bank survives, renamed to "published." Package
   Bank has no successor — there's no separate code-deploy step distinct
   from publishing. One bank concept remains, so the polysemy can't recur.
7. **"Play Run" over-promotion** — **RESOLVED, confirms the old proposal.**
   The canonical-store law (§1.3) puts `runs/` and journal `run.*` events
   firmly in the "records" class, never the identity/catalog class. The
   demotion the old library only proposed is now structurally enforced.
8. **"Legacy Status" supersession** — **RESOLVED, confirms the old
   proposal, and generalizes it.** Not only does `registry.js status:` not
   survive, *no* separate status ladder survives — `bundle.stage` is the
   single state set, materialized entirely from the journal.
9. **Collapsed failure exits** (refusal / ACP-failure / FREEZE all merge to
   `play.failed`, Tracker re-splits) — **PARTIALLY RESOLVED, one gap
   remains.** The new model does keep infra vs. skill failure apart at the
   source (`run.json status: failed | infra-error`, explicitly "keeps the
   inherited infra/skill failure split... auth/sandbox/connection faults
   never pollute pass rates"). But there is no explicit "refused" verdict
   distinct from "failed" in the grading enum (`pass | fail | partial`).
   ⚠ Open — see question 1.
10. **`thread:studio-board-stage-status-polysemy`** (library set's own
    recording of the same stage/status split) — **RESOLVED**, same
    resolution as #8: one `bundle.stage` field, journal-derived.
11. **gap-why-unrecoverable** — not a card-level hot spot; N/A to this
    migration mechanically, but worth noting the gap is now filled —
    `plan.md`'s own "What it is" section supplies the value proposition the
    old library explicitly couldn't recover from code.
12. **gap-proving-never-performed** — not resolved by the new model, nor
    does it need to be; the same honesty is preserved by construction
    ("not yet measured" is still the default display state until graded
    runs exist for a given version).
13. **gap-authoring-kit-thin** (Protocol A–E under-read) — **MOOT.**
    Protocols A–E retire entirely; there is no authoring-kit depth to have
    been thin about.

---

## 4. New cards needed (concepts with no old-card coverage)

| New concept | Why it needs a card |
|---|---|
| Journal envelope + idempotency rule | The old Ledger card describes *that* there's an append-only log; the new model specifies a precise envelope shape and an idempotency-key conflict rule (§2.9) that has no prior card-level treatment. |
| `bundle.json` identity file | Distinct enough from the old Play/registry framing (immutable slug, no mutable-in-anger fields) to deserve its own card rather than inheriting Entity - Play's shape wholesale. |
| `stations.json` / stations | Per-bundle work config, copied-not-referenced from a template, agent-first by default — a genuinely new mechanism, only loosely precedented by the old per-move Doer economy. |
| Station run (`Run.kind: "station"`) | A run that does a state's production work rather than an eval — new run kind, no old analog. |
| Skill version / content-hash versioning (`skill.version_recorded`) | The old model had no output-versioning concept at all (a play was just "banked" or not); version = content hash of the output tree is entirely new. |
| Drift hint | New computed value (`in-sync`/`design-changed`/`output-hand-edited`/`both`), displayed-never-enforced — the philosophy is new even though it plays a similar navigational role to the old Sync Rule. |
| Todo (unified) | Merges three old card kinds into one with a `kind` enum including a new "eval" kind; different enough in shape (terminal/archive/reopen mechanics spelled out precisely, §2.10) to warrant a fresh card rather than a rename of Work Order. |
| Canonical-store split (files / journal / SQLite) | A named architectural law (ruling A) with no prior card — it's the thing that makes "board state is a journal replay" true, and probably deserves its own Mechanism or Reference card since so much else depends on it. |
| Publish target | `skillmaker.config.json`'s `publishTargets` (git-dir, etc.) — no analog; the old model's "banking" had one implicit destination (the plugin), the new model has a pluggable target list. |
| Skillbook (workspace-level output) | §2.14 — an entirely new artifact class: auto-generated cross-bundle documentation with receipts and changelogs. No old equivalent existed at the workspace level (Synopsis was per-play only). |
| Reindex | The rebuild-from-source-of-truth operation (`skillmaker reindex`) — conceptually related to the old Data Validators but distinct enough (it's a full index rebuild, not just a pass/fail check) to warrant its own card. |
| Guarded transition (`bundle.stage_changed` + guard table) | The mechanism itself — table of transition→guard (§2.13) — is more precisely specified than anything in the old Director Gate card and could stand alone as the spine mechanism card for the whole state machine. |

---

## 5. Proposed target structure (director rules later)

```
skills/ (self-hosted) or docs/library/... (studio's own product-knowledge library — location TBD by director)
  _index/            Concept - Skillmaker Studio (spine)
  production/         (was production-ladder) — state machine, guarded transitions,
                       review pairs, publish gate, stations
  authoring/           (slimmed) — design.md, Director role, Grader role (viewer
                       grading), Untrusted-Input Rule moves to evals/
  evals/               (was proving) — risk-map, fixture kit, coverage/validation,
                       measurement policy, eval runs, reindex validation
  outputs/             (new) — SKILL.md as output, versions, drift hint, skillbook
  runs/                (slimmed) — journal, run record, ACP provider, review pair
                       mechanics (Human-Input Pair lives here or in production/ —
                       director's call, it's genuinely load-bearing in both)
  board/               (slimmed) — todos, archive window, viewer board surface,
                       activity feed
```

Notes on the proposal:

- `catalog` has no successor context — org spine, tiers, and golden path all
  retire together. If the director wants *any* successor for "how do I find
  a bundle," it's just `tags[]` + `skillmaker list`, probably not worth a
  whole context on its own.
- `Mechanism - Human-Input Pair` / review pairs is genuinely load-bearing
  for both `production` (it's the forward-transition guard) and `runs`
  (it's a journal event pair) — pick one home and cross-link rather than
  splitting it.
- `authoring` shrinks dramatically (from 22 cards down to roughly 3–4:
  design.md, Director, Grader, plus whatever NEW-HOME cards for
  Harden/Doer survive director review) — consider whether it's still worth
  a standalone context or should fold into `production`.

---

## 6. Open questions for the director

1. **Refused vs. failed.** The old model kept a distinct "refused" exit
   apart from ACP/infra failure; the new grading enum is only
   `pass | fail | partial` with `run.json status: failed | infra-error`.
   Is "refused" worth reintroducing as a verdict value, or does a `fail`
   verdict + grading notes cover it adequately?
2. **Known-FPs Ledger.** No stated home in the new model. Keep as an
   optional per-bundle file under `evals/` (cheap, previously useful), or
   deliberately drop it?
3. **Cold-Reader Gate.** The comprehension-check pattern (fresh agent reads
   an artifact cold, must reconstruct context with no other briefing) has
   no named home. Fold into the Fixture Kit as a class, into
   `case.json`'s `grading.checks`, or drop?
4. **Wake / Subscription.** Is there any autonomous "journal event wakes an
   agent" mechanism planned for station-driven production, or is every
   station/eval run always explicitly launched (CLI/viewer action) in v1?
   If the latter, both cards should RETIRE cleanly rather than sit ⚠.
5. **Doer honesty at station granularity.** Collapsing doer labeling from
   per-move to per-station loses the old model's finer-grained honesty
   check (a mislabeled single step "made software of a conversation").
   Is that granularity loss acceptable, or does `stations.json` need a
   sub-field for it?
6. **William's card timing.** William is named in the target model as the
   product's own agent with his own skill-writing skills, but those skills
   don't exist until Phase 10. Rewrite his card now on the strength of the
   data-model text, or hold it until Phase 10 ships so the card describes
   real skills rather than a plan?
7. **Skillbook vs. Synopsis.** Confirm `design.md`'s Intent/When-to-use
   sections are meant to be the *sole* source for the skillbook's per-skill
   chapter, fully replacing the old model's separately-authored
   `synopsis.md` file (i.e., no separate marketing-style blurb is authored
   by hand going forward).
