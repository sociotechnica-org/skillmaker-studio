# The Information Architecture: One App, Many Projects, Skill at the Center

*Proposal — Jess × Raven, 2026-07-22. Builds on
[`2026-07-21-simplification.md`](2026-07-21-simplification.md) (D1–D9 stand;
D2 is amended here) and two days of real use recorded in
[`../friction/to-tickets.md`](../friction/to-tickets.md). Written to be
ruled on and then decomposed into a build loop.*

## Thesis

Skillmaker is **one app per machine** that manages **many projects**, where
a project is a directory that contains skills. The skill remains the
primary object; everything else is a view of skills or an action on one.
This sets up the desktop app without waiting for it: pivot the UI to
run-once-per-machine now, wrap it in Tauri later.

## A. Architecture

1. **Global install at `~/.skillmaker`.** Holds *machine* state only: the
   project registry, app/window state, and **system skills** (William's
   research/drafting skills and future factory machinery) — installed once,
   available to every project, upgradable with the app.
2. **A project is a directory that contains skills.** Registered with the
   app (add existing directory, or start from scratch). Each project owns a
   `.skillmaker/` directory holding that project's bundles, journal/db, and
   runs.
3. **Per-project data stays in the project.** Two different `.skillmaker`
   directories exist and must never blur: `~/.skillmaker` (machine) holds
   only app state, the project registry, and system skills;
   `<project>/.skillmaker` (per project) holds that project's bundles,
   journal, and runs — so cloning the project's repo brings the skills
   *and their evidence* along. Invariant: no project data ever migrates
   into the global dir, however convenient central storage looks later —
   the day bundles move to `~/.skillmaker`, a cloned repo arrives empty
   and the "files on disk, git-shareable" ruling silently dies.
4. **Publish stays D4c:** the project's live skill files are the installed
   location; the bundle is the workshop behind them; drift = live file vs.
   last-published version, computed per-project.
5. **Resolved by this architecture:**
   - Friction #8 — system skills never appear on any project's board
     (they're machine-level, not project bundles).
   - D6's "William ships inside the product" — he ships with the app at
     machine level; fresh projects get working agent stations day one
     (kills friction #7's hand-smuggling).
   - Import = per-project adopt, scanner scoped per #128's ruling.

## B. The Shell (ChatGPT-app pattern)

- **Left sidebar (closable):** the spine.
  - Global views at top: **Board**, **Tasks** (+ New chat later, D9).
  - **Projects** list; under each project, its **skills** (start new /
    import a file from the project).
- **Board** — all skills across projects (filterable to one), columns =
  the full ladder per D4c: Idea · Research · Drafting · Evals · Published
  (+ Archived drawer). Published is "in service," not a trophy shelf.
- **Tasks** — the improve queue across all skills: todos with origins
  (run / friction / human), the machine-level view of "what needs hands."
  Derivable suggestions (cover-this-gap, grow-n, run-on-model-X) surface
  *here* as mintable items, not as prose walls on the skill page
  (friction #26).
- **Center panel: the Skill page** — the card grown up, significantly
  simplified. Sections, not tabs-that-hide: Overview strip, Instructions
  (the live SKILL.md, rendered), **Evals** (§C), Activity. Work is
  *launched* here (run station, run fixture, publish), not just reviewed
  (friction #2/#4/#5).
- **Top-right: Overview block** — collapsible glance state: stage,
  version, drift, proven-on, coverage. (The current glance strip,
  relocated.)
- **Right sidebar (tabbed):**
  - **Files** — the bundle and fixture files, viewable *and editable*
    (friction #25; direct-manipulation amendment).
  - **Chat** — the D9 agent panel: per-skill ACP session driving frame /
    research / revision conversationally; everything it decides lands on
    disk (session = transport, bundle = memory).
- **Run detail nests** (skill → evals → fixture → run), never a modal
  (friction #23).

## C. Evals: Claim-First

The data layer already has the right shape (risk-map.md rows +
`case.json.risks`); the UI renders it upside down. Reorganize:

1. **Claims are the rows.** The evals section is the risk map rendered as
   a tree: claim text first (the description IS the row — friction #27),
   grouped by family (Input / Reasoning / Output / Adversarial / Chain),
   id as the handle not the headline.
2. **Fixtures hang under the claims they probe** (`case.json.risks` is the
   join). An unclaimed fixture is flagged: evidence without a claim.
3. **Runs hang under fixtures**; grades on runs; every run row carries an
   **invoked chip** (skill exercised vs. model-default behavior — the
   epistemic core; today it's CLI-only).
4. **Model is a column, never a level.** Each claim row shows per-model
   status chips at the pinned version: proven / unmeasured / stale.
   Claims are model-agnostic; evidence is always model-specific.
5. **Version is a pivot, not a level.** Default pin: current draft
   version; one toggle compares against the published version (the D4c
   iterate loop's central question: ready to publish over live?).
6. **Measurements roll up the tree:** run → fixture → claim → the
   Overview block's "Proven on <model>" headline. "Not yet measured" is
   the default texture, not a special banner.
7. **Gaps mint tasks.** Claim without fixture, fixture stale at current
   version, cell empty on a model that matters → one-click todo into the
   Tasks queue (D5's pattern, applied to potential work).
8. **Cell triage is explicit** (Measurement Policy): the matrix is never
   filled; the UI's job is showing which cells are worth paying for —
   daily-driver model × current version gets tight-CI treatment, second
   provider gets a canary row, history gets nothing.
9. **Grading is once-then-regrade:** the panel shows the current verdict
   and offers *regrade* with history — never presents a graded run as
   ungraded. (Friction #22 — verified 2026-07-22: the fold already joins
   the *latest* grade per run id, so regrades replace rather than
   double-count `n`; this is purely a UI-honesty fix.)
10. **Risks are structured data, stored once.** A skill's risks live as
   structured records — `{id, category, sentence}` — per skill, not as a
   markdown table (today's `risk-map.md` is data wearing prose clothing).
   The risk↔fixture link lives in exactly ONE place: the fixture's own
   config (`case.json.risks`, "I test IN-1"). "Is this risk covered?" is
   NEVER stored — always computed from the fixtures, fresh at read time,
   exactly as validation already is. The only stored judgment beyond the
   sentence is an optional "partial, because…" annotation when a linked
   fixture doesn't fully buy the claim. (Kills the live drift channel of
   the current dual-write: risk-map.md's Fixture column duplicating
   case.json.risks.)

## D. Security (gates the desktop wager)

Issue #137: run/station agents currently get every permission
auto-approved with no OS confinement — functionally
dangerously-skip-permissions on the operator's machine, while fixture
files and imported skills are untrusted input. Before the audience
broadens:

1. Deny-by-default permission policy at the ACP layer for anything
   reaching outside the sandbox dir; surface the rest in UI (the D9 chat
   panel is where permission prompts naturally live).
2. OS-level sandboxing option for the agent subprocess.
3. A documented interim stance shipped with v0.4.x.

## E. Rulings this document changes or records

- **D2 amended:** "Board above, Skill below" → **skills-in-projects as the
  spine (left sidebar); Board and Tasks are machine-level views.** The
  Skill page remains the primary object.
- **#8 resolved by architecture** (system skills at machine level) — the
  category design question is closed.
- **D6 sharpened:** William + starter skills ship in `~/.skillmaker` with
  the app.
- **D9 placed:** chat is the right-sidebar panel; direct manipulation
  (Files tab, editable fixtures) is its peer.
- D1, D3, D4 (a–c), D5, D7, D8 unchanged.

## F. Build sequence (the fix loop)

Ordered for a working-product-every-day loop; each phase is
decomposable into tracer-bullet issues:

1. **Trust & truth fixes** (small, current architecture): #137 interim
   permission policy; regrade semantics (#22); invoked chip in UI; model
   string cleanup (#19); transcript coalescing (#20); markdown rendering
   (#21); risk-table description column (#27); derivables → mintable
   todos (#26).
2. **Machine-level pivot:** project registry + `~/.skillmaker`; sidebar
   shell (Projects → skills); Board/Tasks as global views; system-skill
   install (William ships).
3. **Skill page rebuild:** sections layout, Overview block, nested run
   detail, Files tab (view then edit), launch-work affordances, publish
   flow per D4c (retire the publish-gate ceremony).
4. **Claim-first evals:** tree rendering, model columns, version pivot,
   gap→todo minting.
5. **Chat panel (D9):** per-skill ACP session, permission surface,
   disk-persistence rule.
6. **Desktop wrap:** Tauri shell over the machine-level app; sqlite swap
   beneath (D7's separable risks, in that order).

**Ruling:** _pending_
