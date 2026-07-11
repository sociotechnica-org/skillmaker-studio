# Phase 17 — UI pass spec: nav, hierarchy, and focus management

> Scope note: this spec is about **structure only** — navigation model, page
> hierarchy, lens/tab organization, and focus management (list→detail,
> modal-vs-route). Styling and visual aesthetics of the old PMS Studio viewer
> are irrelevant; skillmaker keeps its own dark aesthetic. All citations in
> Section 1 point into `alexandria-internal` (read-only source, not modified
> by this task).

## 1. The old Studio's structure, mapped

### 1.1 Top-level shell nav

`packages/pms/viewer/src/app/PmsApp.tsx` (157 lines) is the outer shell: one
header, a flat row of tabs, and a single `activeBadge` state reported up by
whichever surface is currently mounted (`PmsApp.tsx:1-157`). There is **no
router library** anywhere in the app — every "route" is a query param read
once (or on every render) from `URLSearchParams`.

`packages/pms/viewer/src/app/pms-surfaces.ts:9-17` defines the whole
top-level nav:

```ts
export type PmsSurface = "studio" | "pms-back" | "pms-drafts" | "notepad";

export const SURFACE_TABS = [
  { href: "/",                       label: "Studio",     surface: "studio" },
  { href: "/?surface=pms-back",      label: "PMS-Back",   surface: "pms-back" },
  { href: "/?surface=pms-drafts",    label: "PMS-Drafts",  surface: "pms-drafts" },
  { href: "/?surface=notepad",       label: "Notepad",    surface: "notepad" },
];
```

These render as real `<a>` links (full navigation, no JS interception) —
`surfaceFromLocation()` (`pms-surfaces.ts:21-26`) reads `?surface=` and
defaults to `"studio"`. `PmsApp.tsx` then either mounts `<StudioApp>`
(`surface === "studio"`) or `<FixedLibrarySurface>`, which itself routes to
`DraftsView` / `NotepadView` / an empty-library view based on the surface.

Note: `packages/pms/CLAUDE.md` describes "three surfaces" (Studio,
PMS-Back, PMS-Drafts); the code (`pms-surfaces.ts`) shows **four** —
Notepad is a real fourth surface the doc doesn't mention. Trust the code.

PMS-Back / PMS-Drafts / Notepad are **siblings of the Studio, not children
of it** — they are separate library-browsing lenses over different roots
(`PMS_LIBRARY_ROOT`, `PMS_DRAFT_PATCH_LOG`,
`ALEXANDRIA_PRODUCT_NOTEPAD_ROOT`, all in `pms-surfaces.ts:5-7`), reusing
one `FixedLibrarySurface` component with different `catalogRequestFor()`
config. They exist for browsing already-published/drafted library content,
not for the play-production workflow. For skillmaker's purposes they carry
no direct migration weight (skillmaker has no equivalent "published library
browser" concept yet) beyond noting the pattern: one shared surface
component driven by a small per-surface config object is a reasonable
pattern to keep in mind if skillmaker ever needs a second content-browsing
lens.

### 1.2 The Studio's internal tab switcher

`packages/pms/viewer/src/components/studio/StudioApp.tsx` (1953 lines) is
the single biggest file in the old UI and owns everything under the
`studio` surface. Its own tab type:

```ts
// StudioApp.tsx:272
type StudioTab = "raven" | "catalog" | "damien" | "board" | "play" | "runs" | "tracker";
```

with a type guard at `StudioApp.tsx:274-284`. The `StudioApp` component
(`StudioApp.tsx:1822-1952`) seeds two pieces of state **once, from the URL,
on mount**:

- `tab` ← `props.searchParams.get("tab")`, default `"raven"`
- `playSlug` ← `props.searchParams.get("slug")`, default
  `"frame-the-problem"`

Tab switching itself is **7 plain buttons** (`StudioApp.tsx`'s `tabs` array
of `{key, label}`) that call `setTab(key)` — **React state only, no
`pushState`, no URL sync**. This means: reloading the page while on, say,
the Tracker tab drops you back on `?tab=raven` unless the URL happened to
already say `?tab=tracker`; and there is no browser back/forward support
for switching between Studio tabs (see 1.7 below for why this matters).

The one place `tab`/`playSlug` state IS pushed back into the URL is
`openPlayCard` (`StudioApp.tsx:834-851`, inside `BoardView`):

```ts
window.history.pushState(null, "", studioPlayHref(slug));
props.onOpenPlay(slug); // sets playSlug + tab="play" in StudioApp's own state
```

`studioPlayHref` (`packages/pms/viewer/src/components/studio/boardModel.ts:106-108`)
is the URL shape: `` `/?tab=play&slug=${encodeURIComponent(slug)}` ``.

### 1.3 Page hierarchy as a tree

```
Shell (PmsApp.tsx)
├── Surface: Studio (default, surface=studio)              — StudioApp.tsx
│   ├── StudioTab: raven      (default tab)                — RavenTab.tsx
│   ├── StudioTab: catalog                                 — CatalogTab.tsx
│   ├── StudioTab: damien                                  — DamienTab.tsx
│   ├── StudioTab: board      "Work Board"                 — BoardView (in StudioApp.tsx)
│   ├── StudioTab: play       (?slug=<play-slug>)           — PlayPage.tsx
│   │     ├── lens: Overview        (always shown)
│   │     ├── lens: Play Walk       (conditional: playwalkPresent)
│   │     ├── lens: Design          (conditional: designPresent) — sub-nav of design-history + parked docs + Improvement Plan
│   │     ├── lens: Play Testing    (conditional: hasRiskMap)    — sub-nav Preflight/Diagnostics/Coverage (PlayTesting.tsx)
│   │     └── lens: Other files     (collapsible catch-all group)
│   ├── StudioTab: runs       "Factory runs — live debug"  — RunsView (in StudioApp.tsx)
│   └── StudioTab: tracker    "Play Tracker"                — PlayTrackerTab.tsx (run-scoped, spans all plays)
├── Surface: PMS-Back    (surface=pms-back)                 — FixedLibrarySurface → library components
├── Surface: PMS-Drafts  (surface=pms-drafts)                — FixedLibrarySurface → DraftsView.tsx
└── Surface: Notepad     (surface=notepad)                   — FixedLibrarySurface → NotepadView.tsx
```

Depth is capped at 4 real levels (Shell → Surface → Studio-tab → PlayPage
lens); PlayTesting's own 3 tabs are a 5th level but only reachable from one
branch. Nothing goes deeper than that.

### 1.4 A play's detail — every lens in `PlayPage.tsx`, exhaustively

`packages/pms/viewer/src/components/studio/PlayPage.tsx` (1905 lines). Left
nav (`<nav>` at `PlayPage.tsx`, ~260px column, `max-h-[74vh] overflow-y-auto
border-r`) offers, in this fixed order, each **conditionally shown**:

| # | Lens | Glyph | Always shown? | Condition | What it renders |
|---|---|---|---|---|---|
| 1 | Overview | ⊕ | yes | — | `WalkThrough` (overview view): section#spec, section#drawn (diagram, click→`DiagramOverlay`), section#inuse, section#trigger |
| 2 | Play Walk | ⊞ | no | `playwalkPresent` (from `presentSections`) | non-modular: `WalkThrough` (playwalk view) — `OneRunFlow` (run, 3-way toggle chips) + `MoveCard` list (2 lenses per move: "The story" / "In Fabro"). Modular (`modular === true`): `ComposedPlayWalk` — per-module `ModuleWorkflowGraph`+`ModuleTrackerLegs` blocks separated by `GateSeparator` |
| 3 | Design | ◆ | no | has design-history entries, parked entries, or `improvements.md` | sub-nav lists ordered design-history files (grounding → extracted-claims → brief) + unordered "parked" files, plus a fixed "⚒ Improvement Plan" entry (open-count badge) → `ImprovementBoard` (renders `improvements.md` as a Backlog/In progress/Shipped kanban, explicitly read-only, absorbs the old "Decision queue") |
| 4 | Play Testing | 🧪 | no | `hasRiskMap` (`records.some(r => r.path === "risk-map.md")`) | sub-nav = `TESTING_TABS` (Preflight/Diagnostics/Coverage) → `PlayTesting.tsx` (see 1.5) |
| 5 | Other files | (collapsible group) | conditional | anything unclaimed by 1–4 | raw `FileBody` per file |

Main-pane state machine (`PlayPage.tsx` ~1424-1429): `selected` (file path
or null), `view: "overview"|"playwalk"|"design"|"testing"`, `testingTab`.
Render precedence (`PlayPage.tsx` ~1862-1895): `selected !== null` wins over
everything (raw file body); else dispatch on `view`.

**Logic-file wiring check** (task explicitly asked to confirm which of the
many `.ts` files in this directory are genuinely wired into the UI, vs.
pure-logic/test-only): `playRecords.ts`, `playNarrative.ts`,
`playSynopsis.ts`, `playMoves.ts`, `playModules.ts`, `playImprovements.ts`,
`measurement.ts`, `evalPlan.ts`, `preflight.ts`, `diagnostics.ts`,
`workflowGraph.ts`, `promptContract.ts` — **all of these are actually
imported and rendered** by `PlayPage.tsx` and/or `PlayTesting.tsx`. None
turned out to be orphaned. There is no "some of these are dead" case to
flag here.

### 1.5 Where testing/eval surfaces live

`PlayTesting.tsx` (755 lines) is **not** a top-level Studio tab — it is
lens #4 inside `PlayPage`, reached only after opening a specific play.
Exports `TabKey = "preflight" | "diagnostics" | "coverage"` and
`TESTING_TABS`, both consumed directly by `PlayPage`'s left sub-nav.

- **Coverage tab**: risk rows banded by family (`FAMILY_ORDER = ["Reasoning",
  "Input", "Output", "Adversarial", "Chain"]`, "Chain" labeled "Systemic" in
  UI). Each row shows two separate, never-merged axes: **Coverage**
  (authored/hand-assessed) and **Validation** (derived/measured pass rate —
  "binding"/weakest constraint across a risk's tests). Misfiled/unclassified
  risk rows get their own dashed-border callout rather than being silently
  dropped.
- **Preflight tab** ("does it run?"): derived from `workflow.fabro` + move
  prompt contracts via `preflight.ts`'s `runPreflight()`; gate states
  blocked/incomplete/pass.
- **Diagnostics tab** ("where is it fragile?"): reference-free health via
  `diagnostics.ts`'s `runDiagnostics()`.

This two-axis pattern (authored Coverage vs. measured Validation, never
pooled/collapsed) is the single most important idea to carry forward — see
1.7.

Separately, `PlayTrackerTab.tsx` (669 lines) is a **top-level** Studio tab
(`tracker`), not nested in PlayPage. It's fundamentally **run-scoped, not
play-scoped**: with no `runId` it shows `ActiveRunsLanding` (a table of ALL
in-flight Fabro runs across every play, plus a manual run-id lookup box);
with a `runId` it shows `TrackerRunView` (current step, progress bar, ETA,
step rail, link-out to the raw Factory Runs event log at `?tab=runs&run=…`,
a `ReviewFacts` panel for director-confirm gates).

### 1.6 Focus management — every list→detail transition and every modal

| # | Trigger | Affordance | Detail |
|---|---|---|---|
| 1 | Click a play card on the Board (`BoardView`, `StudioApp.tsx:834-851`, `:893`) | **Fake route** (`pushState` + React state) | `openPlayCard()` → `window.history.pushState(null, "", studioPlayHref(slug))` then `props.onOpenPlay(slug)`. URL reflects the play afterward; a page reload restores it. |
| 2 | Click a play card in the Archive section (`StudioApp.tsx:1513`) | Same fake route | Reuses `openPlayCard()` |
| 3 | Click a play row in Catalog (`CatalogTab.tsx`) | **Real `<a href>`, NOT intercepted** | Same URL shape (`studioPlayHref`-equivalent) but a genuine full page navigation, not a JS-driven transition. This is an **inconsistency**: two different mechanisms reach the identical URL for the identical destination. |
| 4 | Click a work-order card (`BoardView`, `detailCard` state, ~`StudioApp.tsx:987-1030+`) | **True modal** | `fixed inset-0 z-50 flex items-center justify-center bg-black/60` overlay. Not a route; closing just clears `detailCard` state; URL never changes. |
| 5 | Click a diagram thumbnail on Overview or Play Walk (`onOpenOverlay(diagramPath)` in `PlayPage.tsx`) | **True modal** | `overlayPath` state → `DiagramOverlay.tsx` (192 lines), `fixed inset-0 z-[200]`, scroll-zoom/drag-pan/dblclick-reset/Esc-close, SVG via `dangerouslySetInnerHTML`. Not a route. |
| 6 | Click a Studio top-nav tab button (`StudioApp.tsx` tab buttons) | **In-page state swap, no URL sync** | `setTab(key)` only; no `pushState`. Distinct from #1–3: this is neither a real route nor a modal — it's the "silent" case, and it's the one that breaks back/forward (see 1.7). |
| 7 | "← Raven" back button in `PlayPage` header (`PlayPage.tsx` ~1636-1672) | In-page state swap | `onClick={props.onBack}`, wired in `StudioApp.tsx` to `() => setTab("raven")` — literally always goes to the Raven tab, regardless of where the play was opened from (Board, Catalog, or Archive). Not "back" in any history sense. |
| 8 | Click a run row inside a fixture (n/a in old app — old app has no per-run detail modal; closest analog is `RunsView`'s raw event log, not a per-run structured view) | — | Noted for translation-table purposes only; see Section 2. |

### 1.7 What's worth preserving, and what's rough

**Worth preserving.** The single active-badge slot (`PmsApp.tsx`'s
`activeBadge` state, reported by whichever surface is mounted) is a good
discipline — one badge, one place, no per-tab notification spam competing
for attention. The non-blocking review-pair pattern (an agent finishes,
emits a review request, hands off; the human resolves async, never
blocking a running process) is the single best idea in the whole system
and both `data-model.md` (§2.13) and skillmaker's `BundlePanel.tsx`
(`awaitingReview` UI, `review.requested`/`review.resolved`) already carry
it forward correctly. And PlayTesting's two-axis honesty — Coverage
(authored) and Validation (measured) rendered as genuinely separate
columns that are never averaged or merged into one status — is exactly
right and is the direct ancestor of skillmaker's `BundlePanel`'s
`EvalsTab` (risk coverage table + `MeasurementChips`), which already ports
it faithfully.

**Rough, with specific examples.** `StudioApp.tsx` at 1953 lines is a
god-component: Board (Kanban), Work Orders (a second, differently-laned
board with its own filter/sort state), Archive (a third view with its own
filters), a modal, and a create/edit form all live in one `BoardView`
function inside one file, none separable without touching the same file.
Second, the Studio's own tab switcher never syncs to the URL after mount
(1.2, 1.6#6) — you cannot deep-link to "the Tracker tab" from outside,
and browser back/forward silently does nothing while inside the Studio
(it only affects the one `pushState` call that `openPlayCard` makes).
Third, navigation to the same destination (a play) is implemented two
different ways depending on which list you clicked from — a real
intercepted `pushState` from the Board/Archive, a plain full-reload `<a>`
from Catalog (1.6#1 vs #3) — which is exactly the kind of inconsistency
that makes "does the back button work here?" unpredictable per-entry-point.
Fourth, the "← Raven" back button (1.6#7) hardcodes a fixed destination
rather than actually reversing whatever list you came from, so it's a
"go home" button wearing a back-button costume.

## 2. Translation table

| Old (PMS Studio) | New (skillmaker) | Notes |
|---|---|---|
| Plays (`registry.rungs`, `StudioBoardCard`) | **Bundles** (`BundleRecord`, `skills/<slug>/`) | Direct concept match; skillmaker drops the org spine (Company/Division/Function) that Catalog used to group plays — ruled out explicitly in `data-model.md` §1.1 ("org spine ... deliberately dropped"). |
| Work orders (BoardView's second lane-set) | **Todos** (`TodoRecord`, `todo.*` events) | Direct match; `data-model.md` §2.10 explicitly frames this as "the board's work-order cards generalized." Priority defaults (`bug 10 / eval 15 / improvement 20 / task 30`) are the old work-order priority-sift logic, simplified. |
| Factory dry-runs (`RunsView`'s raw event log) | **Runs** (`RunRecord`, `runs/<run-id>/`) | Direct match, but shape changed: old runs were Fabro-workflow executions with a bounce-loop warning parser; new runs are one-fixture × one-version × one-provider ACP sessions (`data-model.md` §2.8), graded via `run.graded` events. No bounce-loop concept survives — there's no move graph to loop through. |
| Risk map / Play Testing → Coverage tab | **Evals tab → Risk coverage table** (`RiskCoverageRecord`, `evals/risk-map.md`) | Direct match, same two-axis (authored Coverage / measured Validation) idea, same 5-family banding (`RISK_FAMILY_ORDER` in `BundlePanel.tsx:108` = `IN/RE/OUT/ADV/CHN`, same families as old `FAMILY_ORDER`). Preflight and Diagnostics tabs (workflow-runnability / reference-free fragility checks) have **no equivalent** — see below, they were Fabro-workflow-specific. |
| Play Tracker (`PlayTrackerTab`, run-scoped landing + per-run view) | **Run detail modal** (`RunDetailModal.tsx`) | Partial match, different shape. Old Tracker was a top-level, cross-play, run-scoped surface with a step rail / progress bar / ETA (because Fabro runs are long multi-step workflows). New `RunDetailModal` is per-run, opened from inside one bundle's Evals tab, and shows transcript/artifacts/grading rather than step progress — because a skillmaker run is one ACP session, not a multi-node workflow. The "ETA / step rail" concept has **no equivalent** and probably shouldn't: nothing in the new data model has Fabro's multi-node shape to progress through. |
| Catalog tab (org-taxonomy list of all plays) | **Board's stage columns**, tags (`BundleRecord.tags`) | Uncertain / partial. Catalog's whole reason to exist was grouping by the org spine, which is gone. skillmaker's flat `tags[]` (data-model.md ruling B) is a weaker, unstructured substitute. **Flagging uncertainty**: there may be no need for a dedicated "Catalog" surface at all if tag-filtering the Board is enough — recommend deferring a dedicated catalog/registry page until there's evidence bundles need a browsing view distinct from the stage board. |
| Board stages (`STAGE_ORDER`: backlog/sourced/designed/built/proven/live) | **Bundle stage ladder** (`STAGES`: idea/researching/drafting/evaluating/published) | Direct match in kind (a linear production ladder with forward guards), different vocabulary and one fewer rung (6 old stages → 5 new). `bundle.archived` is a boolean flag off to the side rather than a stage (`Board.tsx:18`, mirrors old Archive's "off-board" framing). |
| Graduate button (old Board, `live` column only) | **`published` stage entry**, `skill.published` event | Old "Graduate" was a distinct terminal action separate from reaching the last column. New model folds this into the ordinary forward-guard transition into `published` (gated by `bundle.gate_decided: approved`, the publish gate) — no separate "graduate" verb exists. Worth confirming this simplification is intentional rather than a gap: is there a distinct "publish to a target" action (`publishTargets` in `skillmaker.config.json`, `skill.published` event) that deserves its own UI moment, or does reaching `published` stage + recording a version cover it? **Uncertain — recommend confirming with data-model.md's authors before Phase 17 locks the Evals/Versions tab boundary.** |
| Archive section (BoardView, work orders + graduated plays, 7-day window, search/filter) | **`bundle.archived` column** (Board.tsx) + **todo archive** (`archived` derived field, `TodosPanel.tsx`'s "Show archived" toggle) | Direct match for the todo half (same 7-day/pinned inherited window, `data-model.md` §2.10). The play-archive half (search/disposition/kind/date filters over old graduated+archived plays) has **no equivalent yet** for bundles — `Board.tsx`'s archived column is a single flat list, no filter/search UI. Recommend: low priority to port those filters until an install has enough archived bundles to need them. |
| Raven tab (role-tiered landing/demo-chain view) | **No equivalent** | Old Raven tab was tightly coupled to the org-spine role model (Coordinator/PM/Sr.PM tiers) that's explicitly dropped. Recommend: **skip**, no reason to reconstruct a role-tier browsing view for a product with no org spine. |
| Damien tab (media/production status stations) | **No equivalent** | Domain-specific to the old company's media pipeline, not a skillmaker concept at all. Recommend: **skip** outright, not even a stub. |
| Diagram overlay (`DiagramOverlay.tsx`, SVG zoom/pan modal) | **No equivalent** | Tied to Fabro's move-graph diagrams, which don't exist in skillmaker's flat SKILL.md model. Recommend: **skip** — nothing in the new data model produces a diagram artifact to view this way. If a future "workflow" output kind (data-model.md Part 4, per-model variants / a returning "Fabro workflow" output kind) reintroduces graphs, revisit then. |
| Work-order detail modal (BoardView) | **`BundlePanel`'s Overview tab actions** (advance/move-back/review inline) | Functionally absorbed: skillmaker never needed a separate "work order modal" because todo detail is presently just inline expansion in `TodosPanel.tsx` (checkbox + title + kind chip), and bundle-stage actions live directly in `BundlePanel`'s Overview tab rather than a separate modal. **New capability the old surface lacked**: skillmaker's "reachable-409" design (`BundlePanel.tsx:14-19` — the Advance button stays clickable even when not guard-approved, showing the server's real rejection inline) is new and better than the old app's client-side-only gating; proposed home: keep as-is, already in `BundlePanel`. |
| — | **Versions tab / drift badge** (`BundlePanel.tsx` `VersionsTab`) | New capability with no old-Studio equivalent — the old Studio had no content-hash version history at all (Protocol-E parity/resync cone, its nearest analog, was explicitly dropped per data-model.md §1.1). Proposed home: already exists as `BundlePanel`'s Versions tab; this is additive, no migration needed. |
| — | **Activity / journal feed** | New capability listed in `plan.md`'s "Viewer surfaces (v1)" (#4, "Activity — the journal rendered as a feed") but **not yet built** in `packages/viewer/src/app/`. No old-Studio equivalent (RunsView's raw event log is the closest ancestor, but it's run-scoped, not a general journal feed). Proposed home: new top-level route, see Section 3. |

**Old surfaces with no new equivalent (recommend skip/stub):**

| Old surface | Recommendation | Reasoning |
|---|---|---|
| Raven tab | Skip entirely | Org-spine-coupled, spine is gone |
| Damien tab | Skip entirely | Domain-specific to old company's media pipeline |
| Diagram overlay | Skip entirely | No graph-producing artifact in the new data model |
| Preflight / Diagnostics tabs | Skip for now | Both are Fabro-workflow-specific ("does it run", "where is it fragile" for a *workflow*); a flat SKILL.md has no workflow graph to preflight-check. Revisit only if the "Fabro workflow" output kind (data-model.md Part 4) returns. |
| Catalog tab (org-taxonomy browse) | Stub only if tag-filtering the Board proves insufficient | See row above; genuinely uncertain, don't build until there's a concrete need |
| PMS-Back / PMS-Drafts / Notepad surfaces | Skip | These were Alexandria-library-browsing lenses, orthogonal to the Studio; skillmaker has no equivalent "library" concept to browse yet |

**New capabilities the old surface lacked entirely (with proposed home):**

| New capability | Proposed home in new IA |
|---|---|
| Version history + drift badge | `BundlePanel` → Versions tab (already exists) |
| Per-run structured grading (verdict + checklist + notes, append-only regrade history) | `RunDetailModal` (already exists) |
| SSE-driven live refresh across all panels (`useEventStream`) | Already cross-cutting; no old equivalent (old app polled on a fixed interval in `RunsView` only) |
| Reachable-409 guard UI (advance button stays clickable, shows server rejection) | `BundlePanel` Overview tab (already exists) |
| Journal/Activity feed | **Not yet built** — new top-level route, proposed in Section 3 |

## 3. Proposed new IA for `packages/viewer`

### 3.1 Route list

```
/                                Board (stage columns + archived column; unchanged from today)
/bundles/:slug                   Bundle detail — Overview tab (default)
/bundles/:slug/files             Bundle detail — Files tab
/bundles/:slug/versions          Bundle detail — Versions tab
/bundles/:slug/evals             Bundle detail — Evals tab (risk coverage + fixtures)
/bundles/:slug/evals?run=:runId  Run detail — same URL shape old Studio used for the play route
                                  (`?tab=play&slug=…`), but this time the query param round-trips:
                                  opening/closing the modal DOES update the URL (fixing 1.6/1.7's
                                  "Studio tabs don't sync to the URL" rough edge)
/activity                        Journal feed (new — plan.md's listed but unbuilt 4th surface)
```

Deliberately **not** proposing `/todos` as its own route: todos are
workspace-wide and bundle-cross-cutting by design (`TodosPanel.tsx`'s doc
comment: "NOT bundle-scoped, visible without selecting a bundle"); giving
them a route would fight the persistent-panel model that already works
well and mirrors the old app's one genuinely good idea (single always-visible
work-queue, no drilling required). Todos stay a persistent panel, present
on every route via a shared layout (see 3.2).

### 3.2 Nav component proposal

A thin top-level nav bar (new — today's `Header.tsx` has no nav at all,
just a workspace name + bundle count), two entries only:

```
[ Board ]  [ Activity ]                              <workspace name>  N bundles
```

Rendered inside a shared `<AppShell>` that wraps every route: nav bar at
top, `<TodosPanel>` as a persistent right-side sibling to whatever the
route renders in the main area (mirrors `Board.tsx`'s current `main |
BundlePanel? | TodosPanel` flex row, generalized so `BundlePanel`'s slot
becomes "whatever the current route's content is" and Todos stays
constant). This directly keeps the single-active-badge discipline from
1.7 — one shell, one place for cross-cutting state (workspace name, bundle
count, todos), rather than each route reinventing chrome.

### 3.3 What leaves the single-page board, what stays

**Stays on `/` (the Board):**
- Stage columns + Archived column (`Board.tsx:10-16`, `BoardColumn.tsx`) — unchanged.
- `useBundles()` polling/SSE-refresh pattern — unchanged.
- `TodosPanel` as a persistent sibling — unchanged, just hoisted into `<AppShell>` so it's shared across routes instead of Board-local.

**Leaves the single page, becomes its own route:**
- Bundle detail (`BundlePanel.tsx`, currently a 24rem side panel rendered
  conditionally by `Board.tsx`'s `selectedSlug` state) becomes
  `/bundles/:slug`. Reason: `BundlePanel.tsx`'s own doc comment already
  flags the width problem — "the bundle panel is a 24rem side panel, far
  too narrow to render a transcript readably" — as the exact justification
  for why `RunDetailModal` had to be a full modal instead of living inside
  the panel. Promoting the whole bundle detail to a route gives Overview /
  Files / Versions / Evals room to breathe and makes a bundle linkable and
  bookmarkable — something the old Studio *did* have (via `studioPlayHref`)
  and the current single-page skillmaker board does not.
- Run detail (`RunDetailModal.tsx`) stays a **modal** (it is genuinely a
  modal-shaped concern — a transcript + grading panel over the Evals tab —
  not a full page), but gets its open/close state synced to
  `?run=:runId` on the `/bundles/:slug/evals` route, fixing the old
  Studio's worst focus-management flaw (1.6#6/1.7: tab state that silently
  doesn't survive reload or back/forward).
- Activity/journal feed: entirely new, `/activity`.

### 3.4 Improvements over the old rough edges (Section 1.7)

1. **God-component split → Improvement**: `StudioApp.tsx`'s 1953-line
   Board+WorkOrders+Archive+modal+form monolith → skillmaker's stage board,
   todos, and bundle detail are already three separate components
   (`Board.tsx`, `TodosPanel.tsx`, `BundlePanel.tsx`); promoting bundle
   detail to its own route (3.3) keeps that separation load-bearing at the
   URL level too, instead of one file owning every view like `StudioApp.tsx`
   did.
2. **Tab state that doesn't survive reload/back-forward → Improvement**:
   `BundlePanel`'s internal tab (`overview`/`files`/`versions`/`evals`)
   becomes real sub-routes (3.1) instead of `useState<PanelTab>` the way
   `StudioApp.tsx`'s `tab` state was — deep-linkable, refresh-safe,
   back/forward-safe by construction, no bespoke `pushState` call needed
   anywhere except the router itself.
3. **Two different navigation mechanisms reaching the same destination
   (pushState from Board vs. plain `<a>` from Catalog) → Improvement**:
   there's exactly one way to reach a bundle in the new IA — a real
   `<a href="/bundles/:slug">` (or router `<Link>`) from `BundleCard`,
   handled identically regardless of which list it's clicked from (Board
   column today; any future filtered/tag view later). No parallel
   "intercepted vs. not" mechanism to keep in sync.
4. **"← Raven" back button that's really a fixed "go home" → Improvement**:
   a route-based bundle detail page can use `history.back()` (or a real
   "back to board" link) which correctly returns to wherever the user
   actually came from, rather than hardcoding one destination.
5. **Run detail has no addressable URL at all today → Improvement**: today
   `RunDetailModal`'s `openRunId` is local `useState` inside `EvalsTab`
   (`BundlePanel.tsx:797`) — closing the tab loses which run you were
   looking at, and it can't be shared/bookmarked. Syncing it to
   `?run=:runId` (3.1) gives every run a shareable link, something even the
   *old* Studio never had (`RunsView` had a `?run=` query param, but it
   filtered a raw log, not a graded transcript view).

## 4. Implementation notes

### 4.1 Component-by-component fate (`packages/viewer/src/app/`)

| File | Fate | Why |
|---|---|---|
| `App.tsx` | **Restructure** | Currently `<Board />` only, no router. Needs to mount a router + `<AppShell>` + route table (4.2). |
| `components/Board.tsx` | **Restructure (light)** | Keep the stage-column layout and `useBundles()` wiring as-is; remove `selectedSlug` state and the conditional `<BundlePanel>` render — `BundleCard`'s `onSelect` becomes real navigation (`navigate("/bundles/"+slug)` or an `<a>`) instead of `setSelectedSlug`. `<TodosPanel>` moves out of `Board.tsx` into the shared `<AppShell>` (3.2). |
| `components/BoardColumn.tsx` | **Survives as-is** | Purely presentational, no coupling to routing or panel state. |
| `components/BundleCard.tsx` | **Survives as-is, one prop change** | `onSelect?: (slug) => void` stays the same shape; caller passes a navigate-function instead of a state-setter — no internal change needed. |
| `components/BundlePanel.tsx` | **Restructure** | Becomes the content of `/bundles/:slug` (and its sub-routes). The outer `<aside className="w-96 ...">` shell goes away (it's a full page now, not a 24rem side panel — the very cramped-width problem its own doc comment complains about goes away for free). Internal `PanelTab` state (`TABS`, `tab`/`setTab`) is replaced by route params — `OverviewTab`/`FilesTab`/`VersionsTab`/`EvalsTab` subcomponents survive with no internal changes, only how they're selected changes. |
| `components/RunDetailModal.tsx` | **Survives as-is, gains URL sync** | Stays a modal (3.3) — no restructuring of its own layout/content. Only the *caller* changes: instead of `EvalsTab`'s local `openRunId` state, the open/close is driven by the `?run=` query param on `/bundles/:slug/evals`, most likely via a small wrapper that reads/writes that param. |
| `components/TodosPanel.tsx` | **Survives as-is, relocates** | No internal change; moves from being `Board.tsx`-local to living in `<AppShell>` so it's present on every route, matching its own doc comment ("NOT bundle-scoped, visible without selecting a bundle"). |
| `components/Header.tsx` | **Restructure (light)** | Gains the two-entry nav bar (3.2) — currently just workspace name + bundle count, no links at all. |
| new: `components/ActivityFeed.tsx` (or similar) | **New** | `/activity` — plan.md's listed-but-unbuilt 4th viewer surface. Out of this spec's scope to design in detail (no existing component to anchor citations to); flagging it exists as a route stub only. |
| `runtime/*` (all hooks: `useBundles`, `useBundleDetail`, `useRunDetail`, `useTodos`, `useWorkspace`, `useEventStream`, `api.ts`, `client.ts`, `errors.ts`, `schemas.ts`) | **Survive as-is** | These are pure data-fetching/typing, entirely decoupled from routing today (they already take `slug`/`runId` as plain arguments, not derived from component-local state) — see 4.3, no restructuring needed regardless of routing choice. |

### 4.2 Client-side routing approach

Checked `packages/viewer/package.json`: dependencies are `@astrojs/react`,
`astro`, `effect`, `react`, `react-dom` — **no router library present**
(no `react-router`, `@tanstack/router`, `wouter`, etc.), and no other
package in the monorepo (`packages/cli`, `packages/core`) pulls one in
either.

Given the app is currently exactly one route and the target IA (3.1) is
five simple path shapes with zero nested dynamic segments beyond `:slug`
and one query param, recommend **not** adding a routing dependency.
Propose a small hand-rolled router (~50-80 lines, same complexity class as
the existing `useEventStream.ts`, which is 25 lines wrapping one browser
API): a `useRoute()` hook that reads `location.pathname` +
`URLSearchParams`, listens for `popstate`, and exposes a `navigate(path)`
that calls `history.pushState` then updates hook state — the same
`pushState`-plus-manual-state-sync mechanic the old Studio already used
successfully for `openPlayCard` (1.2), just applied consistently
everywhere instead of only for one entry point. `App.tsx` becomes a plain
`switch`/match over the parsed route rendering `<Board>`, `<BundleDetail
slug tab>`, or `<ActivityFeed>`. This avoids taking on a router
dependency's API surface (nested layouts, loaders, etc.) that this app's
five flat routes don't need, while directly fixing the old Studio's
worst flaw (1.6#6/1.7) by making URL sync the default instead of a
one-off.

If the route table grows meaningfully beyond what's in 3.1 (nested
dynamic segments, route-level data loading, guards), revisit — a real
router becomes worth its weight past a certain shape, just not at five
flat routes.

### 4.3 State-management implications of moving bundle detail to its own route

Minimal, because the data layer already doesn't assume a side panel:

- `useBundleDetail(slug: string | undefined)` (`runtime/useBundleDetail.ts:19`)
  already takes `slug` as a plain argument and is a no-op when `undefined`
  — it doesn't care whether `slug` came from `Board.tsx`'s `useState` or a
  route param. No hook signature changes needed.
- `useRunDetail`/`RunDetailModal`'s `runId` similarly just needs to be
  sourced from `?run=` instead of local state — same non-change to the
  hook itself.
- The one real implication: `Board.tsx` currently owns `selectedSlug` as
  local `useState`, which is the *only* piece of state that needs to
  migrate from component state to route state. Since navigation was
  already the sole way to change it (click a card → `setSelectedSlug`),
  swapping that setter for `navigate("/bundles/"+slug)` is a
  one-line change at the call site (`BundleCard`'s `onSelect`), not a
  data-flow redesign.
- `TodosPanel`'s state (`open`, `showArchived`, form fields) is already
  fully local and workspace-scoped, not bundle-scoped — moving it from
  `Board.tsx` to `<AppShell>` changes *where* it's mounted, not what state
  it owns.
- SSE refresh (`useEventStream`) is already subscribed per-hook-instance
  (`useBundles`, `useBundleDetail`, `useTodos` each call it independently)
  rather than through one shared store, so no cross-route cache
  invalidation design is needed — each route's hooks refetch on the same
  SSE signal they already do today, whether or not the route is currently
  mounted.
