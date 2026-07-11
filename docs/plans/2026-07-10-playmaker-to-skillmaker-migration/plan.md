# Skillmaker Studio — Product Plan (draft)

> **Status:** discussion draft (2026-07-10). Companion to
> [`data-model.md`](data-model.md), which is the artifact under active
> discussion. This plan records the product shape and build approach.

## What it is

Skillmaker Studio is a standalone product (public repo under
`sociotechnica-org`) for designing, evaluating, and shipping **agent
skills** — SKILL.md files for Claude Code, Codex, and compatible agents —
where the skill's research, design thinking, eval fixtures, runs, and status
are the durable asset (**Skill Bundle**) and SKILL.md is an *output*.

It is the Playmaker's Studio rebuilt as real software: the governance ideas
(director judgment, proving before shipping, coverage-vs-validation honesty)
survive; the Fabro workflow machinery, derived-rendering cones, and
Alexandria org spine do not.

## Product shape

- **CLI-first, bun-native.** `skillmaker` CLI written in TypeScript with
  Effect (built per the `effect-ts` skill), `bin` → `src/cli/main.ts` (bun
  runs TS directly), distributed via `bun build --compile` single binary.
 
- **`skillmaker start`** serves the viewer: one `Bun.serve` on one origin
  serving the statically built Astro app (`dist/`) plus `/api/*` — SPA
  fallback, no CORS, claim-file single-instance ownership.
- **Viewer:** Astro 5 + React + Tailwind; one real Astro page, client-routed
  React; typed client boundary (fetch → schema decode → tagged errors →
  hooks), Effect confined to one runtime directory. SSE for live updates.
- **Eval engine:** drives claude-code and codex as **ACP subprocesses**
  (`@zed-industries/claude-code-acp`, `codex-acp` platform binaries —
  downloaded, pinned, and integrity-verified). A run = skill installed into a sandbox workspace +
  fixture task given to the agent + transcript captured + graded.
- **No Fabro in v1.** Skills are flat SKILL.md bundles; there is no workflow
  compilation, node prompts, or run projection.
- **Todo system baked in** (see data model §3.3) — the board's work-order
  cards generalized, surfaced in the viewer as the work queue.

## Viewer surfaces (v1)

1. **Board** — bundles by stage ladder, ready flags, drag-to-advance with
   gate confirm; todos panel.
2. **Bundle detail** — research / design / output tabs, drift hint,
   version history.
3. **Eval surface** — risk-map coverage × measured validation per provider,
   run launcher (case × k × provider), run read-outs with transcripts.
4. **Activity** — the journal rendered as a feed.

## Storage

Prose in files, state in SQLite, history in an append-only JSONL journal
(git-tracked, union-merge); SQLite is a rebuildable index. Full detail and
the canonical-store open question: data-model.md §2.

## Repo skeleton (proposed)

Monorepo (bun workspaces, package-local
guidance per package):

```
skillmaker-studio/          # sociotechnica-org/skillmaker-studio (public)
  packages/cli/             # skillmaker CLI (Effect, bun)
  packages/viewer/          # Astro + React + Tailwind product surface
  packages/core/            # shared domain: schemas, store, journal, eval engine
  packages/marketing-site/  # public landing site (Astro; later)
  docs/                     # product plans and design docs (data-model.md lives here)
  skills/                   # the repo's own Skillmaker workspace (self-hosted)
  .skillmaker/              #   its journal + local index
```

**Self-hosting (ruled 2026-07-10):** the repo carries its own Skillmaker
workspace — the studio hosts itself. The
studio's own skills are developed in the studio; its journal is real,
git-tracked shared history from the first commit.

## What migrates from `studio/`

- **Concepts:** production-ladder thinking, fixture kit (golden / refusal /
  empty / rerun / hard-case), risk families (IN/RE/OUT/ADV/CHN), two-axis
  honesty, measurement policy, provenance-on-everything, untrusted-input
  rule.
- **Content:** existing plays' research + briefs are candidate seed bundles
  (brief → design.md, prompts → SKILL.md drafts) — a later, manual pass.
- **Not migrating:** registry.js/board-state.json formats, Fabro packages,
  derive/lint/resync toolchain, PMS viewer components (rewrite, don't port).

## Build plan — phased, XP-style

**Principles (ruled 2026-07-10):** always working software; one small,
testable unit of value per phase; each phase ships as its own PR(s) with
build → review → test → ship before the next begins; every phase is
verified against the REAL thing — real CLI commands, real viewer driven
via browser automation (/chrome), real end-to-end runs in a dedicated
**test workspace** (a separate scratch git repo with a studio installed
via `skillmaker init`). Master docs (this file + data-model.md) stay
directional; the build proceeds piece by piece.

**Standing verification harness (set up in Phase 1, used by all):**

- `~/Documents/code/skillmaker-test/` — scratch git repo, studio installed;
  every phase's QA recipe runs here, never in the product repo.
- **Fresh-install discipline (ruled):** test real installs into a brand-new
  directory OFTEN — not just at Phase 12. Every phase's QA starts from
  `skillmaker init` in a freshly created repo at least once, so
  first-run experience and migration debt surface immediately instead of
  accumulating in a long-lived test workspace.
- Per-PR: typecheck + unit tests in CI; a scripted e2e (`bun test:e2e`)
  that drives the compiled CLI against a temp workspace.
- Per-phase: a human/Chrome QA recipe written into the PR description and
  executed before merge.

### Phase 1 — a bundle exists (`init` + `new`)

- **Value:** you can start a skill bundle in any repo.
- **Scope:** `skillmaker init` (config, `.skillmaker/`, gitattributes,
  gitignore entries) and `skillmaker new <slug>` (bundle.json,
  stations.json from the default template, design.md skeleton, dirs);
  journal append with idempotency (`bundle.created`); core types updated
  to the state-machine model.
- **Verify:** in the test repo: init, new, inspect files, `git diff` sane;
  re-run both → idempotent no-ops; journal has exactly one event per fact.

### Phase 2 — the studio can tell you the truth (journal fold + `list`)

- **Value:** current state is queryable and always rebuildable.
- **Scope:** SQLite index, journal fold (stage/substate/archived),
  `skillmaker list` + `status <slug>`, `reindex`.
- **Verify:** CLI output matches journal by hand-check; delete `studio.db`
  → `reindex` reproduces identical output; append a hand-crafted valid
  event via CLI → state moves.

### Phase 3 — the board is visible (`start` + viewer skeleton)

- **Value:** `skillmaker start` opens a real product surface.
- **Scope:** single `Bun.serve` on one origin — static Astro `dist/` +
  `/api/state`, `/api/bundles`; SSE stream; Board page: bundles by state,
  substate badges. Claim-file single instance.
- **Verify (/chrome):** start in the test repo, drive the browser to
  localhost, see the bundles created in Phase 1; `skillmaker new` in a
  second terminal → board updates live via SSE without reload.

### Phase 4 — the machine turns (transitions + reviews)

- **Value:** the gated state machine works end-to-end, human-driven.
- **Scope:** guarded `bundle.stage_changed` (POST /api/events through the
  server only), `review.requested`/`review.resolved`, awaiting-review
  substate, review panel in the viewer, backward transitions with reason,
  publish gate.
- **Verify (/chrome):** request a review from the CLI → bundle shows
  awaiting-review on the board → approve in the viewer → forward
  transition unlocks → drag/advance → journal shows the full guarded
  history; attempt an unguarded advance → rejected with a visible reason.

### Phase 5 — todos

- **Value:** the baked-in tracking system.
- **Scope:** journal-native todos (`todo.*` events), CLI (`todo add/done`),
  viewer todos panel, terminal/archive/reopen mechanics, priority sort.
- **Verify (/chrome + CLI):** create/complete/reopen todos both ways;
  archive window behavior; reindex reproduces.

### Phase 6 — outputs are versioned (versions + drift)

- **Value:** SKILL.md is tracked as a real output with provenance.
- **Scope:** `skillmaker version record` (output-tree hash, design hash),
  drift computation, bundle-detail page (design/research/output tabs,
  version history, drift badge).
- **Verify (/chrome):** author output/SKILL.md by hand in the test repo,
  record a version, edit design.md → drift badge flips to
  `design-changed`; edit SKILL.md → `output-hand-edited`.

### Phase 7 — evals have shape (fixtures + coverage)

- **Value:** the honesty layer — coverage visible before any run exists.
- **Scope:** fixture dirs + case.json + prompt.md, risk-map.md parsing,
  reindex warnings (never hard fails), eval surface: coverage axis per
  risk family, validation column reading "not yet measured".
- **Verify (/chrome):** author two fixtures + a risk map in the test repo;
  eval surface renders coverage; break a case.json → warning appears, app
  keeps working.

### Phase 8 — a real agent runs a real fixture (ACP engine, claude-code)

- **Value:** the first LLM-touching phase — one eval run, end to end.
- **Scope:** run engine: temp workspace, fixture files in, skill installed,
  claude-code driven over ACP, transcript.jsonl captured, artifacts
  diffed out, run.json + `run.started/completed`, infra-error vs failed
  split. `skillmaker run <slug> --fixture <case>`.
- **Verify:** in the test repo, a trivial real skill (e.g. "summarize this
  file into NOTES.md") runs against a golden fixture; inspect transcript
  and artifacts; kill the network mid-run → `infra-error`, not `failed`.

### Phase 9 — the read-out (human grading + measurements)

- **Value:** the ported magic — judge runs, see honest numbers.
- **Scope:** read-out surface (runs per fixture, transcript + artifacts
  inline, grading panel → `run.graded`), measurements view (n · pass rate
  · CI, keyed version × provider × model), coverage × validation join.
- **Verify (/chrome):** grade the Phase-8 runs in the viewer; run the same
  fixture k=5; watch n and pass rate move; record a new version →
  validation resets to "not yet measured".

### Phase 10 — agent-first production (station runs + review pairs)

- **Value:** the production loop itself is agent-driven.
- **Scope:** station runs (`Run.kind: station`), stations.json execution,
  the non-blocking review pair wired end-to-end (agent works → requests
  review → human resolves in viewer → approve wakes next station /
  revise re-instructs), first William skill (draft-skill-md) living in the
  self-hosted workspace.
- **Verify (/chrome):** from a bare `skillmaker new` in the test repo,
  drive a bundle to a drafted SKILL.md entirely through agent stations +
  viewer reviews.

### Phase 11 — ship it (publish + skillbook)

- **Value:** skills leave the studio with receipts.
- **Scope:** publish targets (git-dir first), `skill.published`,
  `skillmaker book build` + skillbook viewer tab (design prose +
  measurements + journal changelog per skill).
- **Verify (/chrome):** publish the Phase-10 skill; build the skillbook;
  browse it; confirm the receipts match the measurements view.

### Phase 12 — second provider + distribution

- **Value:** codex parity + installable product.
- **Scope:** codex ACP provider, per-provider measurement columns,
  `bun build --compile` binary, tarball/install story, marketing-site
  seed.
- **Verify:** full Phase-8→11 loop on codex; install the binary on a clean
  machine (or clean shell) and run the whole golden path from `init`.

### Phase 13 — docs site

- **Value:** the product explains itself publicly.
- **Scope:** a documentation site (Astro, likely Starlight) as its own
  package/surface: getting started, the bundle anatomy, the state machine,
  the journal, eval methodology, CLI reference generated from the command
  router. Deployed alongside/within the marketing site.
- **Verify (/chrome):** browse the built site; follow the getting-started
  page verbatim in a brand-new directory and reach a working board.

### Phase 14 — migrate the studio's library (LAST)

- **Value:** Skillmaker inherits the Playmaker's Studio product-knowledge
  library — the concepts, mechanisms, and hard-won laws — as its own.
- **Scope:** migrate the predecessor studio's product-knowledge card library into this repo and
  **clean it up against the new, leaner data model**: Raven edits freely —
  rename Play→Skill Bundle vocabulary throughout; retire cards for dropped
  machinery (Fabro projection, derived renderings, Protocols A–E, resync
  cone, org spine, face-agent-as-container, board-state mechanics);
  rewrite the lifecycle cards to the state machine + stations model;
  resolve the recorded hot-spots where the new model rules them (two
  advancement mechanisms → guarded transitions; blocking vs non-blocking
  gate → review pairs; stage/status polysemy → one state set); keep the
  inherited laws (two-axis honesty, measurement policy, fixture kit,
  provenance) as the library's spine.
- **Explicitly last:** everything else ships first, so the library
  describes the software that actually exists rather than the plan.
- **Verify:** the cleaned library reads true against the shipped product —
  spot-audit cards against real CLI/viewer behavior; no card references
  retired machinery.

### Phase 15 — desktop app (Tauri) (ruled in 2026-07-11)

- **Value:** Skillmaker.app — manage skills without installing a CLI.
  Serves the technical-but-app-preferring persona; the deeper non-technical
  product is a separate standing thesis
  (docs/sources/2026-07-11-desktop-app-thesis.md), not this phase.
- **Scope:** a Tauri shell (packages/desktop) bundling the Phase-12a
  compiled binary as a sidecar: app launch → pick/remember a workspace
  folder → sidecar `skillmaker start` on a local port → window points at
  the viewer. Native niceties kept minimal: dock icon, workspace-picker
  dialog, quit stops the sidecar cleanly (claim-file discipline). No new
  product surfaces — the viewer IS the app.
- **Ordering:** parallelizable any time after Phase 12a (already merged);
  most valuable after Phase 9 when the viewer carries the full read-out
  loop. macOS first; Windows/Linux deferred until asked for.
- **Verify:** fresh-machine-shaped QA — install the .app on a clean user
  account (or bare temp HOME), no bun/node/git config present beyond git
  itself, golden path init → new → review → advance entirely in the app;
  quit and relaunch → same workspace restored, single-instance claim
  respected.

Phases 1–7 involve zero LLM calls. Each phase is independently shippable;
re-ordering 5/6/7 is cheap if discussion demands it. Phases 13–14 come
after everything else, in that order; Phase 15 is a parallel track, not
part of the 13–14 tail.

## Open decisions

Tracked in data-model.md §7 (canonical store, taxonomy, gates, per-target
outputs, grading, stage names). Product-level extras:

- **Name check:** "Skillmaker Studio" vs collision scan on npm/GitHub.
- **License / public-repo hygiene** for sociotechnica-org.
- **Marketplace packaging format** — track the emerging Claude skill
  marketplace conventions before hard-coding a publish target.

### Phase 17 — UI pass: adopt the PMS Studio's nav + hierarchy (ruled 2026-07-11)

- **Value:** the viewer stops being a thrown-together single board page and
  gains the old Studio's superior navigation, organizational structure,
  and focus (director ruling: structure yes, Alexandrian styling no).
- **Scope:** walk the original PMS Studio viewer (`pms start`, :4322, in
  alexandria-internal) end to end; extract its nav model, page hierarchy,
  and focus patterns into a spec; revamp packages/viewer to match —
  improving where the old surface was rough. Keep the existing dark
  aesthetic and runtime-boundary architecture.
- **Verify (/chrome):** side-by-side walk of old Studio and new viewer;
  every existing capability (board, reviews, todos, versions, evals,
  read-out) reachable in the new structure; full loop re-run + re-recorded.

### Fold-ins from skill-creator research (2026-07-11, director pre-authorized)

Source: docs/research/2026-07-11-anthropic-skill-creator.md.

1. **Without-skill baseline runs** → Phase 10/12 scope: eval runs gain an
   optional baseline mode (same fixture, no skill installed), recorded as
   measurements with version=null; the read-out shows the with/without
   delta — the most persuasive number a skill can have.
2. **Trigger-rate measurement** → Phase 12 scope: measure whether the
   skill *activates* when it should (skill-creator's stream-JSON
   early-exit technique is directly reusable); a fixture class for
   triggering, distinct from task success.
3. **Grader self-critique** → Phase 10 scope: after grading, the grader
   flags non-discriminating checks (pass everything / fail everything);
   flagged checks surface as risk-map gaps.
- Anti-lesson (recorded, no action): skill-creator's loose-file
  persistence exhibits real schema drift + unrecoverable data by their
  own admission — validates the journal + rebuildable-index model as the
  trust wedge. The eval viewer's feedback-collection design (feedback as
  input to the next iteration) is noted for the read-out's future.

### Phase 18 — installer experience (ruled 2026-07-11)

- **Value:** installing by cloning the repo is a crummy experience; make
  install one command (and one download for the app).
- **Scope:** (a) GitHub Releases via CI: tagged builds publish
  dist/skillmaker binaries (macOS arm64 first, then x64/linux) + the
  Skillmaker.app bundle; (b) an install script
  (`curl -fsSL https://skillmaker.studio/install.sh | sh`) that fetches
  the right binary + viewer assets to ~/.skillmaker/bin and PATHs it;
  (c) evaluate npm wrapper (`npx skillmaker`) and Homebrew tap as
  fast-follows; (d) update docs getting-started + marketing hero CTA to
  the real install story.
- **Verify:** fresh machine-shaped install from the public artifact (no
  repo clone, no bun): script → init/new/start golden path; the .app
  opens from a plain download.

### Phase 19 — self-hosting for real: William's skills live in the studio (ruled 2026-07-11)

- **Value:** the repo's own studio becomes the working environment for its
  own skills — William's skills are managed AND developed through
  Skillmaker, not hand-edited files that happen to sit in skills/.
- **Scope:** bring the repo's self-hosted workspace (skills/ +
  .skillmaker/, started in Phase 10) to full product use: every William
  skill (william-draft-skill-md + future station skills: research, eval
  authoring, grading assistance) gets a real design.md, fixtures by
  failure class, a risk map, recorded versions, and measured runs on
  BOTH providers; stages driven through the board/reviews like any
  bundle; the repo's journal is the studio's own history. New William
  skills are born via `skillmaker new` + station runs — dogfood the
  agent-first loop end to end. CI guard: repo-workspace `reindex`
  warnings surface in CI (warn, never fail — ruling I).
- **Verify:** open the repo's own studio (`skillmaker start` at repo
  root) — board shows William's bundles with honest states; at least one
  William skill reaches published through the full gated loop with
  measurements on claude-code + codex; the skillbook of the repo's own
  workspace renders with receipts.
