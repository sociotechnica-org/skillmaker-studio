# Library Disposition Report — post-Simplification (2026-07-21)

*Produced by sweep against `2026-07-21-simplification.md` (D1–D8); all 61
cards read in full. Dispositions are proposals pending director ruling —
nothing is cut until ruled. Precedent format: `docs/library/MIGRATION.md`.*

## `_index`

| Card | Disposition | One-line reason |
|---|---|---|
| Concept - Skillmaker Studio | REVISE | Bundle/agent-first/graded-readout core survives, but the five-state machine ending in an active "published" state is wrong under D4 (ladder ends at Draft; publish redefined). |
| Role - William | KEEP | Stations-driven agent production is reinforced by D6 (CLI as agent layer). |
| Vision - Board Lab Ship Receive | CUT | D1 kills Ship/Receive; D2 restructures nav; the proposal itself calls this card "wrong at its center" and orders its redraft. (Currently marked `superseded` in place.) |
| Vision - The Skill Is the Product | KEEP | This *is* the ordered redraft — already written to match D1–D8; supersedes the card above. |

## `production`

| Card | Disposition | One-line reason |
|---|---|---|
| Capability - Adopt | REVISE | Core brownfield import survives (D6's "locally-installed skills" thesis), but its registry tripwire/triage-manifest machinery is coupled to the now-cut Receiving Dock (D1). |
| Economy - Awaiting-Review Substate | REVISE | Substate pattern survives for pre-Draft stations, but its use as the terminal publish-gate substate is voided by D4b's soft gate. |
| Economy - Station Doer | KEEP | Agent/human doer split per station is core to D6. |
| Entity - Skill Bundle | REVISE | `bundle.json` identity record survives; the stage vocabulary it references shrinks under D4. |
| Mechanism - Bundle Stage | REVISE | Journal-fold mechanism intact, but state set shrinks (ladder ends at Draft; evaluating/published become frozen historical values, D4/D4b). |
| Mechanism - Guarded Transition | REVISE | Forward/backward/archive guard pattern survives for stages up to Draft; the evaluating→published gate is removed/softened (D4b). |
| Mechanism - Stations | REVISE | Station mechanism (doer/skill/produces/review) survives; whether "evaluating" stays a discrete station vs. dissolves into D4's continuous loop is unresolved (judgment call). |
| Reference - Harden Interview Pattern | KEEP | Generic design-doc technique, untouched by any ruling. |

## `board`

| Card | Disposition | One-line reason |
|---|---|---|
| Component - Board Column | REVISE | Column-per-state pattern survives; underlying state set shrinks (D4). |
| Component - Bundle Card | KEEP | Presentational card, unaffected. |
| Entity - Todo | REVISE | Core Todo/TodoOrigin mechanism keeps, but D5 explicitly adds `{kind:"run", runId}` as the now-primary sensing channel; existing `field-report`/`intake` origins become historical (D1/D2). |
| Mechanism - Bundle Archive | KEEP | Generic, reversible archive toggle, unaffected. |
| Surface - Activity Feed | KEEP | Concept survives; D3 only renames the surface label to "activity" (already the card's own vocabulary). |
| Surface - Board | REVISE | Confirmed as D2's top-level nav, but column/state set changes (D4) and the Published-doorway mechanic is retired since published is no longer an active gated stage. |
| Surface - Lab | REVISE | Bench/Queue evidence-loop concept is *reinforced* by D4, but D2 explicitly moves it from top-level `/lab` route to within-skill navigation (a Skill-page section). |

## `authoring`

| Card | Disposition | One-line reason |
|---|---|---|
| Entity - Design Doc | KEEP | `design.md` untouched by any ruling; central to D4's authored-coverage axis. |
| Entity - Dossier | DEFER | Judgment call — seeded by Receiving Dock's elicitation tree/triage manifest, both deferred under D2; core "context-of-use" idea could stand alone but as documented is parked with the Dock. |
| Role - Director | REVISE | Judgment/ownership role survives; "the terminal publish gate" it enforces is redefined to a soft, always-allowed gate (D4b). |
| Role - Grader | KEEP | Central to D4's continuous evidence loop, unaffected in mechanics. |

## `evals`

| Card | Disposition | One-line reason |
|---|---|---|
| Capability - Coverage Lens | KEEP | Unaffected; core to surviving thesis. |
| Capability - Eval Run | KEEP | Unaffected. |
| Component - Answer Key | KEEP | Unaffected. |
| Economy - Coverage | KEEP | Unaffected; authored-coverage axis explicit in D4. |
| Economy - Pass Rate | KEEP | Unaffected. |
| Economy - Validation | KEEP | More central than before under D4's continuous loop. |
| Entity - Fixture | REVISE | Core entity keeps; its optional `field-report`-provenance and dossier-context fields are vestigial, tied to D1-cut/D2-deferred sources. |
| Entity - Read-Out | KEEP | The mechanism D4b's honesty stamp is built on. |
| Entity - Risk Map | KEEP | Unaffected; authored-coverage axis of D4's two-axis rule. |
| Mechanism - Reindex Validation | KEEP | Warnings-never-hard-fail fits D6's machine-first CLI philosophy. |
| Reference - Fixture Kit | KEEP | Unaffected. |
| Reference - Known-FPs Ledger | KEEP | Documented as optional/unimplemented; unaffected by rulings (flagged in judgment calls re: D8 fit). |
| Reference - Measurement Policy | KEEP | K-tier policy unaffected, shipped as-is. |
| Reference - Measurements Bind To Version | KEEP | More important than ever — underlies D4's drift-as-central-diff model. |
| Reference - Risk Family | KEEP | Unaffected. |
| Reference - Untrusted-Input Rule | KEEP | Unaffected. |

## `outputs`

| Card | Disposition | One-line reason |
|---|---|---|
| Entity - Bundle Output | REVISE | "Hand-editable output, no compile step" survives, but D4 redefines *where* the live/published skill.md actually lives (the real project file, not just the bundle's own `output/` copy). |
| Entity - Field Report | CUT | D1 explicitly cuts the Receive tab/paste form this entity fed; `skill.field_report` is frozen, no new emitters. |
| Entity - Shipment | CUT | D1 explicitly cuts the Ship tab/shipping-manifest surface; `skill.shipped` is frozen, no new emitters. |
| Entity - Skill Version | KEEP | Content-hash versioning is more central than ever — the substrate of D4's drift-as-central-diff. |
| Entity - Skillbook | REVISE | Judgment call — its viewer half (Ship tab) is cut with D1; the per-skill chapter (design.md-derived) likely folds into the Skill page's history/design sections (D2), and `book build`'s static-site path may survive independently as a D6 CLI capability. |
| Mechanism - Drift Hint | REVISE | Promoted to the product's central diff under D4, but the comparison target changes (live project file vs. last-published version, not bundle-internal output/). |
| Mechanism - Publish | REVISE | Core action survives but is completely redefined by D4/D4b: no more stage-gated hard exit or multi-target marketplace shipping (D2 defers marketplace) — now a soft-gated overwrite of the live skill.md. |
| Mechanism - Receiving Dock | CUT | D1 explicitly names "the receiving dock" among cut things; D2 confirms Dock/import-queue deferred entirely with no reserved surface. |
| Reference - Publish Target | CUT | Multi-target config (git-dir/marketplace) is moot once publish = overwrite-the-one-live-file (D4) and marketplace is deferred entirely (D2) — judgment call, a minimal git-dir-only notion could arguably survive. |

## `runs`

| Card | Disposition | One-line reason |
|---|---|---|
| Component - Journal Event | KEEP | Current architecture; D7's eventual sqlite swap is explicitly sequenced not to block or invalidate current cards yet. |
| Component - Review Unit | KEEP | Station review mechanism unaffected. |
| Economy - Run State | KEEP | Unaffected. |
| Entity - Journal | KEEP | Current source of truth; same D7 forward-looking caveat as Journal Event. |
| Entity - Run | KEEP | Unaffected; D5's run→todo affordance builds atop it without changing its structure. |
| Mechanism - Review Pair | KEEP | Core to guarded transitions below Draft, unaffected. |
| Reference - ACP Provider | KEEP | Core to D6's CLI-as-agent-layer. |
| Reference - Canonical Store Split | KEEP | Accurately describes the *current* architecture; D7 plans to eventually replace it but explicitly proceeds in parallel without blocking. |

## `brand`

| Card | Disposition | One-line reason |
|---|---|---|
| Concept - LifeBuild Brand | KEEP | Visual brand system, orthogonal to product-scope rulings. |
| Reference - Brand Palette | KEEP | Orthogonal to rulings. |
| Reference - Surfaces and Texture | KEEP | Orthogonal to rulings. |
| Reference - Typography | KEEP | Orthogonal to rulings. |
| Reference - Voice and Tone | REVISE | Voice/tone split survives fully (D3's plain-English scope is user-surfaces only); but the card documents the literal nav taxonomy "Board · Lab · Ship · Receive · Activity," which is stale under D1/D2. |

## Counts

| Disposition | Count |
|---|---|
| KEEP | 39 |
| REVISE | 16 |
| CUT | 5 |
| DEFER | 1 |
| **Total** | **61** |

## Judgment calls flagged for the director

1. **Dossier (authoring)** — DEFER vs. CUT vs. partial-KEEP: entangled with the deferred Receiving Dock's elicitation tree/triage manifest, but the underlying "context-of-use" idea could plausibly stand alone even without the Dock.
2. **Skillbook (outputs)** — whether the per-skill chapter concept survives folded into the Skill page (sweep's read) or should be marked closer to CUT since its only described viewer surface (Ship tab) is gone.
3. **Publish Target (outputs)** — CUT vs. a reduced KEEP for a git-dir-only publish destination; D4's "overwrite the one live file" model may leave zero room for a target-config abstraction, or may still need *some* notion of "which file/repo is live."
4. **Stations (production)** — whether "evaluating" remains a discrete, bounded station-stage or dissolves entirely into D4's continuous evidence loop; several other cards (Bundle Stage, Guarded Transition, Awaiting-Review Substate) inherit this ambiguity.
5. **Known-FPs Ledger (evals)** — kept as documented, but it's a purely speculative/unimplemented pattern, arguably in tension with D8's demand-evidence discipline.
6. **Adopt's triage-manifest/registry-tripwire machinery (production)** — marked REVISE since the base `adopt` capability is core to the thesis, but the elaborate Dock-coupled half of the card may warrant its own CUT rather than a trim.
7. **The precise new stage enum** — several REVISE verdicts depend on knowing exactly what the shortened ladder looks like (idea→researching→drafting→**draft**, then loop?) — the proposal states the *end point* (Draft) but not the full enum.
