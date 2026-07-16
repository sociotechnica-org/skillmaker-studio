# Library Migration Manifest — Phase 14

Playmaker's Studio card library → `docs/library/` (Skillmaker Studio),
executed 2026-07-11 against the disposition table in
`docs/_archive/plans/2026-07-10-playmaker-to-skillmaker-migration/library-migration-prep.md`.

Sources (read-only, in `alexandria-internal`):
`studio/sweeps/playmaker-studio/` (92 cards) and `studio/library/` (9 cards)
— 101 source cards total. Target: 49 cards across 7 contexts (`_index`,
`production`, `board`, `authoring`, `evals`, `outputs`, `runs`), 40 marked
`status: migrated`, 9 marked `status: new`.

Disposition totals as executed: **14 KEEP · 24 REWRITE · 16 MERGE ·
5 NEW-HOME · 42 RETIRE**, plus 9 net-new cards.

Every card except four small KEEPs carries a `Verified:` line naming the
shipped-code check performed (45 of 49 cards verified against
`packages/core/src`, `packages/cli/src/commands`, `packages/viewer`, or real
files under `skills/`).

## Manifest

Legend: → *migrated-as* / ⇒ *merged-into* / ✕ *retired-because*.
Source paths are relative to `studio/sweeps/playmaker-studio/` unless
prefixed `lib:` (= `studio/library/`).

### `_index`

| Source card | Outcome |
|---|---|
| Concept - Playmaker's Studio | → REWRITE `_index/Concept - Skillmaker Studio` (new one-sentence model §1.0; agent-first + graded-read-out WHY) |

### `production-ladder` → `production`

| Source card | Outcome |
|---|---|
| Pattern - Production Ladder | → REWRITE `production/Mechanism - Guarded Transition` (six-stage ladder → five-state machine + archived) |
| Mechanism - Director Gate | ⇒ merged into `production/Mechanism - Guarded Transition` (splits into per-station review guard + publish gate) |
| Component - Design Confirm | ⇒ merged into `production/Mechanism - Guarded Transition` (drafting-state instance of `review.resolved:approve`) |
| Component - Proven Confirm | ⇒ merged into `production/Mechanism - Guarded Transition` (the `bundle.gate_decided` publish-gate instance) |
| Mechanism - Stage | → REWRITE `production/Mechanism - Bundle Stage` (one state set, journal fold) |
| Economy - Stage Status | ⇒ merged into `production/Mechanism - Bundle Stage` |
| Economy - Ready Marker | → REWRITE `production/Economy - Awaiting-Review Substate` (first-class fold substate, not a `ready[]` array) |
| Pattern - Make-a-Play Arc | ✕ retired — self-hosting meta-play is Fabro/Alexandria machinery; self-hosting survives as a repo convention, not a played workflow |
| Mechanism - Auto-Advance Contract | ✕ retired — ruled out; exactly one advancement mechanism (guarded transition), no self-promotion path exists in `Machine.ts` |

### `catalog` → dissolved (org spine dropped; survivors re-homed)

| Source card | Outcome |
|---|---|
| Entity - Play | → REWRITE `production/Entity - Skill Bundle` (central rename; identity = `bundle.json`, no tier/division/status) |
| Role - William | → REWRITE `_index/Role - William` (product's own agent; grounded in the shipped `skills/william-draft-skill-md`) |
| Reference - Company | ✕ retired — org spine dropped (ruling 2026-07-10) |
| Reference - Division | ✕ retired — same |
| Reference - Function | ✕ retired — same; filing replaced by flat `tags[]` (ruling B) |
| Surface - Catalog | ✕ retired — no successor page; listing is the Board / `skillmaker list` |
| Economy - Criticality Tier | ✕ retired — golden-path banding has no analog |
| Economy - Role Tier | ✕ retired — Alexandria/Raven product furniture, out of scope |
| Pattern - Golden Path | ✕ retired — Raven-specific demo chain |
| Reference - Legacy Status | ✕ retired — stage/status collapse into `bundle.stage` |
| Role - Face Agent | ✕ retired — face-agent-as-container named for retirement in plan.md |
| Role - Raven | ✕ retired — Alexandria product persona, out of skillmaker's scope |

### `board` → `board`

| Source card | Outcome |
|---|---|
| Surface - Board | → REWRITE `board/Surface - Board` (derived from journal fold / SQLite `bundles`, five states + Archived) |
| Component - Board Column | → REWRITE `board/Component - Board Column` |
| Component - Play Card | → REWRITE `board/Component - Bundle Card` |
| Entity - Work Order | → REWRITE `board/Entity - Todo` |
| Component - Bug Card | ⇒ merged into `board/Entity - Todo` (`kind: "bug"`, priority 10) |
| Component - Improvement Card | ⇒ merged into `board/Entity - Todo` (`kind: "improvement"`, priority 20) |
| Component - Checklist | ⇒ merged into `board/Entity - Todo` (`Todo.checklist`, any kind) |
| Economy - Priority | ⇒ merged into `board/Entity - Todo` (`Todo.priority`, defaults by kind) |
| Economy - Work Order Status | ⇒ merged into `board/Entity - Todo` (`Todo.status`, independent axis law) |
| Surface - Work Order Lane | ⇒ merged into `board/Entity - Todo` (the shipped `TodosPanel.tsx`) |
| Mechanism - Archive | → REWRITE `board/Mechanism - Bundle Archive` |
| Capability - Graduate | ⇒ merged into `board/Mechanism - Bundle Archive` (`bundle.archived`/`bundle.restored` pair) |
| Component - Testing Card | ✕ retired — exactly-one-testing-card-per-play rule explicitly dropped; testing work is ordinary `eval`-kind todos or eval runs |
| Entity - Board State | ✕ retired — `board-state.json` killed; the board is a journal replay (canonical-store ruling A) |

### `authoring` → `authoring` (22 → 3 cards)

| Source card | Outcome |
|---|---|
| Entity - Brief | → REWRITE `authoring/Entity - Design Doc` (Brief → `design.md`; recommended-not-enforced skeleton) |
| Role - Director | → KEEP `authoring/Role - Director` (resolves reviews + publish gate instead of Board button) |
| Role - Grader | → REWRITE `authoring/Role - Grader` (human-in-viewer grading, ruling E; also documents the shipped `GraderSelfCritique.ts` reindex-warning mechanism) |
| Reference - Untrusted-Input Rule | → KEEP `evals/Reference - Untrusted-Input Rule` (context moved: it is now a fixture-authoring rule) |
| Economy - Doer | → NEW-HOME `production/Economy - Station Doer` (per-station `doer: agent\|human`, one altitude up) |
| Capability - Harden | → NEW-HOME `production/Reference - Harden Interview Pattern` (guidance for station skills, not core machinery) |
| Role - Hardener | ⇒ merged into `production/Reference - Harden Interview Pattern` |
| Reference - Synopsis | → NEW-HOME `outputs/Entity - Skillbook` (per-skill chapter generated from `design.md`; no hand-authored blurb) |
| Capability - Lint | ⇒ merged into `evals/Mechanism - Reindex Validation` (warnings, never hard-fail — ruling I) |
| Mechanism - Sync Rule | ✕ retired — resync cone named for retirement; successor concept is `outputs/Mechanism - Drift Hint` (surfaced, never enforced) |
| Component - Move Graph | ✕ retired — no move-graph authoring model in v1 |
| Component - Move | ✕ retired — no per-step node record |
| Component - Node Prompt | ✕ retired — one flat SKILL.md body |
| Reference - Doer Honesty | ✕ retired — per-move honesty check has no per-station home; judgment call, see ⚠ ledger below |
| Capability - Derive | ✕ retired — no derive phase; a station skill produces `output/SKILL.md` directly |
| Reference - Projection Standard | ✕ retired — no Fabro construct to project into |
| Entity - Workflow Package | ✕ retired — superseded by the flat `output/` tree (`outputs/Entity - Bundle Output`) |
| Role - Author | ✕ retired — retires with Derive |
| Role - Checker | ✕ retired — reindex is a CLI mechanism, not an agent role |
| Surface - Diagram | ✕ retired — no source graph to render |
| Surface - Story View | ✕ retired — derived rendering with no source |
| Reference - Moves Overlay | ✕ retired — no moves to key prose to |

### `proving` → `evals`

| Source card | Outcome |
|---|---|
| Entity - Fixture | → KEEP `evals/Entity - Fixture` (real `case.json` shape; prompt lives in sibling `prompt.md` — see deviations) |
| Reference - Fixture Kit | → KEEP `evals/Reference - Fixture Kit` (now six classes: `trigger` added in Phase 12) |
| Component - Answer Key | → KEEP `evals/Component - Answer Key` (grading-only, never in the agent's workspace — verbatim inherited) |
| Entity - Risk Map | → KEEP `evals/Entity - Risk Map` (no results column — law §1.4) |
| Reference - Risk Family | → KEEP `evals/Reference - Risk Family` (IN/RE/OUT/ADV/CHN, machine-checked at reindex) |
| Economy - Coverage | → KEEP `evals/Economy - Coverage` |
| Economy - Validation | → REWRITE `evals/Economy - Validation` (pure viewer-time join; "not yet measured" default) |
| Economy - Pass Rate | → KEEP `evals/Economy - Pass Rate` (n·pass-rate·CI, never pooled — law §1.5) |
| Reference - Measurement Policy | → REWRITE `evals/Reference - Measurement Policy` (⚠ resolved: k-tiers CONFIRMED shipped — see ⚠ ledger) |
| Capability - Dry-Run | → REWRITE `evals/Capability - Eval Run` (`Run.kind: "eval"`, `skillmaker run <slug> --fixture <case>`) |
| Entity - Read-Out | → REWRITE `evals/Entity - Read-Out` (viewer surface, not a stored artifact) |
| Capability - Coverage Lens | → KEEP `evals/Capability - Coverage Lens` |
| Mechanism - Data Validator | → REWRITE `evals/Mechanism - Reindex Validation` (philosophy flip: warnings, never hard-fails) |
| Reference - Known-FPs Ledger | → KEEP `evals/Reference - Known-FPs Ledger` (⚠ resolved: documented as an optional, not-implemented pattern — see ⚠ ledger) |
| Capability - Cold-Reader Gate | → NEW-HOME: folded into `evals/Reference - Fixture Kit` as a fixture-authoring pattern (see ⚠ ledger) |
| Capability - Preflight | ✕ retired — no workflow graph to run "does it build" checks over |
| Capability - Diagnostics | ✕ retired — same; no graph contracts |

### `runs` → `runs` (+ publish machinery → `outputs`)

| Source card | Outcome |
|---|---|
| Entity - Ledger | → REWRITE `runs/Entity - Journal` (`.skillmaker/events.jsonl`; CLI/server are the only writers) |
| Component - Lifecycle Event | → KEEP `runs/Component - Journal Event` (absorbs the new envelope + idempotency-rule card need) |
| Mechanism - Human-Input Pair | → KEEP `runs/Mechanism - Review Pair` (`review.requested`/`review.resolved`; spine card for hot-spot 2) |
| Component - Review Unit | → REWRITE `runs/Component - Review Unit` (Vision's nine slots retired as example; real `buildReviewQuestion` cited instead) |
| Economy - Needs-You State | ⇒ merged into `production/Economy - Awaiting-Review Substate` (with a connecting note in `runs/Mechanism - Review Pair`) |
| Economy - Run State | → REWRITE `runs/Economy - Run State` (status: running/completed/failed/infra-error + verdict: pass/fail/partial — see ⚠ ledger, "refused") |
| Entity - Play Run | → REWRITE `runs/Entity - Run` (record class, never catalog; absorbs the new station-run card need — both `kind` values in one card) |
| Reference - ACP Provider | → KEEP `runs/Reference - ACP Provider` (providers map + the shipped `ProviderProfile.ts` per-provider deltas) |
| Capability - Output Bank | → REWRITE `outputs/Mechanism - Publish` (banked → published; `skill.published`) |
| Capability - Package Bank | ✕ retired — no separate code-deploy step; publish targets are the whole deploy story (closes the bank polysemy, hot-spot 6) |
| Mechanism - Embedded Factory | ✕ retired — no Fabro in v1; replaced by the ACP-subprocess run engine |
| Component - Subscription | ✕ retired — CONFIRMED against code: no autonomous event→agent binding exists (see ⚠ ledger) |
| Mechanism - Wake | ✕ retired — same confirmation; all runs are explicitly launched |
| Reference - Raven Vision | ✕ retired — Alexandria-specific exemplar; the pattern survives via `runs/Mechanism - Review Pair` |
| Mechanism - Review Levels | ✕ retired — was a specced design artifact, low confidence even in the source; no mention in the new model |
| Surface - Play Tracker | ⇒ merged into `board/Surface - Activity Feed` (journal-as-feed; see ⚠ ledger for the gap) |
| Surface - Factory Runs | ⇒ merged into the eval surface's run list (`evals/Capability - Eval Run` / `evals/Entity - Read-Out` describe the run detail view) |

### `studio/library/` (the earlier, smaller set)

| Source card | Outcome |
|---|---|
| lib: board/Aggregate - Board State | ✕ retired — duplicate of sweep's Entity - Board State |
| lib: board/Aggregate - Board | ✕ retired — duplicate; sweep's Surface - Board migrated instead |
| lib: board/Read-Model - Play Registry | ✕ retired — `registry.js` identity ladder dead with org spine; identity lives in `bundle.json` |
| lib: board/Value - Job Category | ✕ retired — org-spine adjacent; the "eight categories" were never enumerated even in the source |
| lib: board/Value - Prio | ✕ retired — duplicate of Criticality Tier |
| lib: board/Value - Stage | ⇒ merged into `production/Mechanism - Bundle Stage` (one half of the recorded stage/status polysemy) |
| lib: board/Value - Status | ⇒ merged into `production/Mechanism - Bundle Stage` (the other half) |
| lib: board/Value - Tier | ✕ retired — duplicate of Role Tier |
| lib: readiness/Value - Empty HOW Fixture | ✕ retired — a tooling test fixture, never product knowledge |

## Net-new cards (no source-card ancestry)

| Card | Covers (prep doc §4) |
|---|---|
| `runs/Reference - Canonical Store Split` | files / journal / SQLite law (ruling A) |
| `production/Mechanism - Stations` | `stations.json`, copied-not-referenced template, agent-first stations |
| `production/Capability - Adopt` | brownfield in-place import (`skillmaker adopt`, Phase 16) — post-dates the prep doc's list, added from shipped reality |
| `outputs/Entity - Bundle Output` | `output/` tree, SKILL.md as hand-editable output |
| `outputs/Entity - Skill Version` | content-hash versioning (`skill.version_recorded`) |
| `outputs/Mechanism - Drift Hint` | in-sync / design-changed / output-hand-edited / both (+ shipped fifth state `no-version`) |
| `outputs/Entity - Skillbook` | workspace-level generated book (chapters, receipts, changelogs) |
| `outputs/Reference - Publish Target` | pluggable `publishTargets` (git-dir + the two shipped marketplace kinds) |
| `evals/Reference - Measurements Bind To Version` | law §1.6 honest-reset rule |

Prep-doc §4 needs absorbed into migrated cards rather than standalone
files: journal envelope + idempotency → `runs/Component - Journal Event`;
`bundle.json` identity → `production/Entity - Skill Bundle`; station run →
`runs/Entity - Run`; unified Todo → `board/Entity - Todo`; reindex →
`evals/Mechanism - Reindex Validation`; guarded transition →
`production/Mechanism - Guarded Transition`. Trigger fixtures (a shipped
sixth fixture class, not in the prep doc) are documented inside
`evals/Reference - Fixture Kit`.

## ⚠ ledger — prep-doc flags and their resolutions

1. **Refused vs. failed (open question 1)** — RESOLVED against shipped
   code: `RunVerdict` in `packages/core/src/Journal.ts` is exactly
   `["pass", "fail", "partial"]`; no `refused` value. `run.json` keeps the
   infra/skill split (`failed` vs `infra-error`). A refusal is graded
   `fail` with notes. Documented in `runs/Economy - Run State`.
2. **Known-FPs Ledger (open question 2)** — grep of core + CLI found no
   implementation. Kept as a card documenting an optional,
   recommended-not-required pattern, explicitly marked not implemented.
3. **Cold-Reader Gate (open question 3)** — resolved inside
   `evals/Reference - Fixture Kit`: a cold-reader check is an ordinary
   fixture case whose `grading.checks` assert the agent reconstructed
   context cold; no separate mechanism needed.
4. **Wake / Subscription (open question 4)** — RESOLVED, both retired:
   case-insensitive grep for wake/subscription machinery across
   `packages/core/src` and `packages/cli/src/commands` found nothing; all
   runs are explicitly launched (`Run.ts`, `StationRun.ts`), never
   autonomously triggered by a journal event.
5. **Doer honesty at station granularity (open question 5)** — the old
   per-move honesty card is retired (no shipped home for it);
   `production/Economy - Station Doer` carries an explicit ⚠ note that the
   granularity loss is real and unresolved — a director call, not silently
   dropped.
6. **William's card timing (open question 6)** — RESOLVED: Phase 10
   shipped, so `_index/Role - William` was written now, grounded in the
   real `skills/william-draft-skill-md`, and explicitly distinguishes the
   still-placeholder `william/research-a-skill` station reference.
7. **Skillbook vs. Synopsis (open question 7)** — CONFIRMED in code:
   `Skillbook.ts`'s chapters are generated from raw `design.md` content;
   no separately hand-authored blurb field exists.
8. **Measurement Policy ⚠ (disposition table §1.6)** — CONFIRMED shipped:
   `Measurements.ts` defines `SMOKE_K = 5`, `ESTIMATE_K = 30`,
   `SHIP_GATE_K = 100` with rule-of-three / Wilson CIs, surfaced as
   guidance data, not enforcement.
9. **Subscription/Wake ⚠ (disposition table §1.7)** — see item 4.
10. **Play Tracker ⚠ minor (disposition table §1.7)** — partially
    resolved: the shipped `ActivityFeed` is a generic journal feed with no
    per-run progress/"needs you" specialization; the gap is flagged in
    `board/Surface - Activity Feed`.
11. **Grader's blind-agent pattern ⚠ (disposition table §1.5)** — left as
    an explicit, honest gap in `authoring/Role - Grader`; the shipped
    `GraderSelfCritique.ts` is a reindex-time non-discriminating-check
    warning pass over human verdicts, not agent grading.
12. **Improvement Card's "absorbs the decision queue" framing (§1.3)** —
    does not carry forward explicitly; flagged in `board/Entity - Todo` as
    an unclaimed use case.

## Hot-spot resolutions confirmed (prep doc §3)

1. Two advancement mechanisms → one guarded transition; Auto-Advance
   retired; verified no self-promotion path in `Machine.ts`
   (`production/Mechanism - Guarded Transition`).
2. Two human-gate models → only the non-blocking pair; no Fabro substrate
   (`runs/Mechanism - Review Pair`).
3. "Register" timing → dissolved: versioning and publishing are separate
   explicit actions (`outputs/Entity - Skill Version`,
   `outputs/Mechanism - Publish`).
4. Derived-rendering drift → inverted: drift surfaced, never prevented
   (`outputs/Mechanism - Drift Hint`).
5. "Tier" polysemy → moot; both tiers retired with the org spine.
6. "Bank" polysemy → resolved by elimination: Output Bank → Publish,
   Package Bank retired (`outputs/Mechanism - Publish`).
7. "Play Run" over-promotion → structurally enforced record class
   (`runs/Entity - Run`, `runs/Reference - Canonical Store Split`).
8. "Legacy Status" supersession → generalized: one `bundle.stage`
   (`production/Mechanism - Bundle Stage`).
9. Collapsed failure exits → infra/skill split kept; no `refused` verdict
   (confirmed shipped; ⚠ ledger item 1).
10. Stage/status polysemy thread → same resolution as 8; `lib:` Value -
    Stage / Value - Status merged into `production/Mechanism - Bundle
    Stage`.
11–13. Gap threads (why-unrecoverable, proving-never-performed,
    authoring-kit-thin) — not card-level; noted resolved/moot per prep doc
    §3.

## Deviations from the prep doc (follow-the-shipped-code rulings)

- **Fixture prompt location**: the shipped `case.json` has no `prompt`
  field in active use — the task prompt lives in a sibling `prompt.md`
  (legacy inline field tolerated with a warning). Prep doc/data-model
  showed `prompt` inline. (`evals/Entity - Fixture`)
- **Fixture classes**: six shipped classes, not five — `trigger` added in
  Phase 12. (`evals/Reference - Fixture Kit`)
- **Drift states**: five shipped values, not four — `no-version` exists for
  bundles with no recorded version. (`outputs/Mechanism - Drift Hint`)
- **Publish target kinds**: three shipped kinds (`git-dir`,
  `claude-marketplace`, `codex-marketplace`), not the doc's single git-dir
  example. (`outputs/Reference - Publish Target`)
- **Bundle Card**: no stage badge on the shipped card — stage is conveyed
  by column placement only, and `tags[]` are not rendered yet.
  (`board/Component - Bundle Card`)
- **William's skills**: only `drafting` is backed by a real shipped skill;
  the `researching` station's `william/research-a-skill` is a placeholder
  (not a valid slug). (`_index/Role - William`,
  `production/Mechanism - Stations`)
- **Grader**: the new model is not "human-only with zero agent
  involvement" — `GraderSelfCritique.ts` ships a warning pass over human
  verdicts; documented to prevent the card overclaiming.
  (`authoring/Role - Grader`)
- **Entity - Play placement**: the prep doc leaves `catalog` with no
  successor; the Skill Bundle rewrite was homed in `production/` (the
  context that owns the state machine operating on bundles) rather than
  inventing a catalog successor context.
- **Adopt**: not in the prep doc at all (Phase 16 post-dates it); added as
  a net-new card from shipped reality. (`production/Capability - Adopt`)
