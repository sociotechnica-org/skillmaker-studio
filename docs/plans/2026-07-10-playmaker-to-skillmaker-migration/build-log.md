# Build Log — Skillmaker Studio

> Running notes on the phased build (see [plan.md](plan.md)). One entry per
> phase/track: what shipped, what was verified against the real thing, bugs
> found, decisions made mid-flight. Newest phases at the bottom. Maintained
> by Raven as the build proceeds; the PR descriptions carry the same facts
> per-phase, this is the connected narrative.

## How the build runs

- Each phase: sonnet builder agent on its own branch → Raven evaluates
  (re-runs tests, reads the load-bearing code, QAs the real thing in the
  test workspace + /chrome) → PR → squash-merge. Fable (Raven) writes specs
  and does verification; sonnet does the bulk implementation.
- Test workspace: `~/Documents/code/skillmaker-test` (scratch repo, studio
  installed). Fresh-directory installs re-tested per phase.
- From Phase 7 on: parallel tracks in git worktrees with explicit file
  fencing (spine phases stay serial; orthogonal tracks run alongside).

## Phase 1 — init + new (PR #1)

- Effect v4 beta (effect-smol) reality: `@effect/platform` doesn't exist on
  the v4 beta line — FileSystem/Path are bundled into `effect` itself; only
  `@effect/platform-bun` ships separately. Versions: effect@4.0.0-beta.97,
  platform-bun matching.
- Journal events use `Schema.Class` + `type: Schema.Literal(...)` union,
  NOT `TaggedClass` — TaggedClass hardcodes `_tag` as discriminant; our
  envelope discriminates on `type`.
- Journal append semantics implemented as specified: same idempotencyKey +
  same content ⇒ no-op; same key + different content ⇒ typed conflict error;
  trailing-newline repair before append.
- Fresh-install QA quirk: asdf refuses bare `bun` in directories without
  `.tool-versions` — QA scripts export `ASDF_BUN_VERSION=1.3.11`; the repo
  itself carries `.tool-versions`.
- Verified: fresh mkdtemp install, idempotent re-runs, actor picked up from
  git config, exit codes 0/1/2 (bad slug = 2, uninitialized = 1).

## Phase 2 — journal fold + SQLite index (PR #2)

- `Fold.ts` is the "board is a replay" law made code: pure, total, tolerant
  (implicit bundle creation on orphan events). Guard enforcement explicitly
  deferred to Phase 4 — the fold applies `stage_changed` verbatim forever;
  guards live at append time, not replay time (replay must accept history).
- SQLite via `bun:sqlite` (no dependency). DB is a rebuildable cache only.
- Rebuildability proven byte-identically: delete studio.db → `list --json`
  output identical (in e2e AND by hand in the test workspace).
- e2e tests needed 15-20s timeouts — cold `bun <ts-entry>` spawn + asdf
  resolution is slow; not a product issue.

## Phase 3 — start + viewer skeleton (PR #3)

- Tailwind v4 via `@tailwindcss/vite` (not legacy @astrojs/tailwind).
  Astro 5 + React 19. Viewer needed its own `typescript ^5.7` devDep —
  repo-wide TS 7 crashes @astrojs/language-server; nested resolution keeps
  core/cli on TS 7.
- One Bun.serve, one origin: /api/* + static dist + SPA fallback.
  Traversal-guard test subtlety: WHATWG URL collapses `../` and `%2e%2e`
  client-side; the guard is proven via `/..%2f..%2f` which survives to the
  server (404 confirmed by hand).
- SSE: fs.watch on `.skillmaker/` filtered to events.jsonl, debounced, 15s
  heartbeat. Live-update proven at the wire: `skillmaker new` in a second
  terminal → `data: journal` on an open stream.
- Claim-file single instance (PID-alive check, stale replacement, removal
  on SIGTERM).
- Visual QA deferred one phase (Chrome extension wasn't connected); wire-
  level checks covered the same paths; caught up in Phase 4's browser pass.

## Phase 4 — the state machine (PR #4) — the product's soul

- `core/Machine.ts`: pure guard logic; CLI `advance`/`review request` and
  server POST /api/events share it ("one contract, two doors").
- Guard semantics: forward one stage needs `review.resolved: approve` for
  the CURRENT stage recorded after the last stage change; publish
  additionally needs the gate; backward always legal with required reason;
  stale-`from` rejected; `override: true` escape hatch (checked first).
- POST /api/events: six-type allowlist, schema-validated by dry-decoding a
  synthesized full envelope (reuses the real schema; no duplicate per-type
  schemas), guard rejection ⇒ 409 with the reason as body.
- UI honesty choice: unapproved Advance stays clickable (dashed border +
  hint) so the 409 path is reachable through the real control — no fake
  disabled state, no dev-only backdoor.
- Full /chrome QA (covering Phase 3's deferred pass): board renders; naked
  Advance → server reason inline red; Request review → AWAITING REVIEW
  badge; Approve → guard flips, button goes solid, card moves columns live
  via SSE; Revise clears substate but guard stays false (revise ≠ approve);
  CLI backward move re-renders the open board.
- **Bug found by testing the real thing:** concurrent CLI/server rebuilds
  of studio.db can race a reader (transient stale stage, self-heals).
  Filed → fixed in Phase 5 (atomic rebuild).

## Phase 5 — todos (PR #5)

- Journal-native todos per data-model §2.10: patch immutability (id/kind/
  created/source never patchable), terminalAt stamped on entering terminal /
  preserved terminal→terminal / cleared on reopen, archived DERIVED (7-day
  window, pinned exempt), priority defaults bug 10 < eval 15 < improvement
  20 < task 30.
- **Builder's own test caught a real bug pre-merge:** reopen failed to
  clear terminalAt (conditional-spread inherited the old value). The
  inherited mechanic that mattered most, nearly lost to a JS idiom.
- Atomic index rebuild landed (temp db + rename) — closes Phase 4's race.
  macOS discovery: Apple's SQLite raises SQLITE_IOERR_VNODE on a stale
  handle's post-rename read — an honest error, not a safety violation;
  test accepts either outcome.
- Verified both doors against one journal: UI checkbox strikethrough ⇄ CLI
  `todo list` shows done + terminalAt; delete db → byte-identical rebuild.

## Phase 6 — versions + drift (PR #6)

- Version = sha256 over sorted (path, sha256) pairs of output/ tree;
  `skill.version_recorded` on the journal; drift computed live per read.
- Fifth drift state added: `no-version` (doc's four assumed a version
  exists). Deliberate deviation, documented in code.
- record-version is a dedicated server endpoint (hashing is server I/O,
  same core fn as the CLI), not a widening of /api/events.
- **Two real bugs found & fixed pre-merge:** (1) `status` never rebuilt the
  index before reading — the actual root cause of Phase 4 QA's staleness;
  (2) version idempotency + PK keyed on output hash alone collided on
  design-only edits — now keyed (designHash, outputHash). Both caught by
  live e2e against a real server, not unit tests. Lesson reinforced: test
  the REAL thing.
- CLI drift lifecycle verified exactly per plan recipe; /chrome pass on
  Overview/Files/Versions tabs (drift badge, history newest-first,
  traversal-guarded file endpoint).

## Phase 7 — fixtures + coverage (in flight)

- Director ruling mid-phase (from data-model discussion): the eval task
  prompt lives in `prompt.md` beside case.json — prose in files, JSON for
  classification. Legacy `prompt` field in case.json ⇒ warning.
- Ruling I applied: all fixture/risk-map validation is warnings (persisted
  in a `warnings` table, surfaced in CLI + viewer), never hard failures.
- Also fixing flagged debt: IndexService hardcoded `skills/` instead of
  config.skillsDir.
- Incident: first builder died mid-work (login expiry) with uncommitted
  partials; relaunched builder instructed to review-keep-or-redo. Nothing
  merged was affected.

## Parallel tracks (opened 2026-07-11, worktree-isolated)

Rationale: the spine (7→8→9→10) is serial by dependency AND file collision
(Server.ts, BundlePanel.tsx, IndexService.ts are every phase's hotspots).
Two orthogonal tracks run alongside with explicit no-touch fencing:

- **Phase 12a — compiled binary + install story** (`phase-12a-binary`):
  bun build --compile + viewer assets beside the binary + real install e2e
  (run the BINARY on a fresh machine-shaped dir). Lands after 7 rebases.
  Payoff: every later phase's fresh-install QA runs against the real
  artifact. Known risks under investigation: bun:sqlite under --compile,
  import.meta.url inside binaries (execPath is the real anchor).
- **ACP spike** (`spike-acp-client`, never merges): minimal JSON-RPC/stdio
  client driving `@zed-industries/claude-code-acp`; real run attempted on
  this machine's claude auth. Deliverable: spike/FINDINGS.md → feeds the
  Phase 8 spec (engine API shape, permission policy, infra-vs-task failure
  signals).
- Merge discipline: spine lands first; 12a rebases over it; spike is
  read-only input to Phase 8.

## Phase 12a — compiled binary (PR #9, parallel track) — SHIPPED

- `bun build --compile` works with ZERO special flags: bun:sqlite and the
  effect beta compile clean under bun 1.3.11. 59MB single binary.
- **Risk confirmed then fixed:** `import.meta.url` inside a compiled binary
  is a virtual `/$bunfs/...` path — the viewer-dist ancestor walk found
  nothing (reproduced live). Fix: additive `process.execPath`-relative walk;
  repo-checkout discovery unchanged.
- Artifact: dist/skillmaker + dist/viewer-dist/ + VERSION (semver+sha);
  `build:dist` script; docs/dist.md.
- Verified twice: builder's 5-test e2e on the real binary + orchestrator
  independent rebuild-from-scratch and a fresh-machine-shaped run (binary +
  assets in a bare temp dir, unrelated workspace, no bun involved). Phase
  QA can now exercise the compiled artifact.

## ACP spike (branch spike-acp-client, never merges) — Phase 8 prep, DONE

- **A real claude-code run completed over ACP**: adapter
  @zed-industries/claude-code-acp@0.16.2 via npx; rides the logged-in
  `claude` CLI auth — NO API key needed. ~15.3s per fixture case (spawn
  0.8s, session/new 1.4s, prompt 13.1s).
- **The gotcha that would have burned Phase 8:** the adapter refuses to
  start nested inside a Claude Code session; `CLAUDECODE` env leaks into
  children and fails as an opaque JSON-RPC -32603 (real cause only in
  stderr). Engine must strip CLAUDECODE/CLAUDE_CODE_* from spawned env —
  WILL recur when agent stations launch runs.
- Protocol confirmed against adapter source (npm-packed and read):
  ndjson JSON-RPC 2.0 over stdio, protocolVersion 1; initialize →
  session/new(cwd) → session/prompt → session/update stream → stopReason.
- Permission policy for Phase 8: auto-approve session/request_permission +
  log as synthetic transcript entry; bypassPermissions rejected (hides
  decisions from the transcript).
- Infra-vs-task signals: -32000 auth infra; -32603 ambiguous (needs
  stderr); pre-handshake exit = spawn infra; stopReason ≠ end_turn = task.
- Deliverables: spike/acp-client.ts + run-fixture.ts (runnable),
  FINDINGS.md, a captured real run (28 wire messages + artifacts).

## Idle-cycle work (2026-07-11)

- CI (PR #7, merged): typecheck/unit/viewer-build/e2e on every PR — the
  first six PRs had merged on local-only green.
- Docs (PR #8, held for Phase 7): README rewrite ("ship agent skills with
  receipts"), this build log, marketing-copy.md draft (hero, pillars, FAQ
  seeds, voice guardrails + director-ruling checklist).
- Library-migration prep agent dispatched: card-by-card disposition of the
  old studio library against the new model → library-migration-prep.md
  (Phase 14's working doc).
- Marketing site infra (director): domain skillmaker.studio bought
  (namecheap), Cloudflare CLI (`cf`) auth'd — site deploys via Cloudflare;
  DNS entries at namecheap need director setup once we know the targets.

## Standing decisions & conventions (accumulated)

- Effect idioms: services via Context.Service + Layer factories; Effect.fn
  for logic; runtime edge only in main.ts; viewer components plain React
  (Effect confined to src/app/runtime for Schema decode).
- No `any`, no `as` casts anywhere (JSON.parse `as unknown` allowed).
- Every phase PR: real-thing verification section with actual outputs.
- QA state (bundles, todos, journal events) in the test workspace is
  committed — it IS the journal's shared-history story, dogfooded.
- From Phase 8 on (director ruling 2026-07-11): ALL builder work happens in
  worktrees; the main checkout stays clean on main for QA, merges, and this
  log. Phase 7 was the last builder on the main checkout.

## Phase 8 — eval run engine (PR #15) — first LLM phase

- AcpClient productionized from the spike: env-strip (CLAUDE_CODE_*),
  permission auto-approve logged as synthetic transcript entries, stderr
  capture, 8-row failure classification (infra-error exit 3 vs failed 1).
- RunEngine: sandbox workspace, skill installed at .claude/skills/<slug>/,
  drift-aware auto version record, incremental transcript.jsonl, workspace
  diff → artifacts/, immutable run records.
- **Two real runs green**: builder's gated e2e + orchestrator's independent
  run in the test workspace — real frame-the-problem skill, claude-code
  over ACP, FRAMING.md artifact that followed the skill's rules exactly
  (no invented metrics). 292 tests, 0 fail.
- Grade columns pre-wired in the index for Phase 9.

## Strategy thread (PRs #12, #13, #14) — skills-repo mode

- Two source notes frozen (marketplace thesis, desktop thesis); Phase 15
  (Tauri) ruled into the plan.
- Six-angle competitive scan: coordinator lost its fan-out results;
  recovered all six full reports from sub-agent transcripts (lesson:
  coordinator-of-coordinators is fragile — flat fan-out + own synthesis
  beats delegation of synthesis). Archived under
  docs/research/2026-07-11-competitive-scan/.
- Verified headlines: Codex = full peer (open agentskills.io standard +
  real marketplace); gh skill + Portkey publish without evals; Anthropic
  skill-creator evals without gating; gstack hand-rolled eval CI; elicit =
  97 skills + 15 plugins + .command installers (desktop evidence). The
  version-pinned-pass-rate-gating-publish + model-change-re-earn combo is
  validated white space.
- strategy-skills-repo-mode.md v2 requests rulings R1-R5 (adopt-first,
  Phase 16 placement, Elicit pilot, positioning, dual-marketplace scope).

## Marketing site + domain (PR #11 + infra)

- Site live at skillmaker-studio.pages.dev; custom domains attached, DNS
  CNAMEs created via cf; awaiting nameserver propagation (zone pending).

## Incident: power-blip reboot (2026-07-11 ~06:51)

- House power blip (diag: `rst uv, vdd_hi_uvlo` — undervoltage reset, no
  kernel panic; not software). Killed the session mid-fleet.
- Recovery: Phase 9's 3 committed scopes survived; Phase 15's uncommitted
  work salvage-committed from the worktree (85d27d4); all agents resumed
  from transcripts; skill-creator research restarted (nothing written).
- Bonus: the director live-tested the Tauri app pre-reboot and found two
  real bugs — unclickable folder-picker dialog; infinite "Starting…"
  spinner on empty selection. Both now top of Phase 15's scope.
- Lesson banked: commit-early + worktrees + transcripts made a hard reboot
  a ~10-minute recovery.

## Deploys + standing freshness rule (2026-07-11)

- docs.skillmaker.studio LIVE (Pages project skillmaker-docs + CNAME);
  marketing header gains a Docs link.
- **Standing rule (director):** every feature merge updates the docs site
  and the marketing home page ("what works today") and redeploys both.
  Now part of the per-phase ship checklist alongside the build-log entry.

## Phase 10 — agent-first stations (PR #28)

- StationEngine: sandbox per stations.json `produces`, station skill =
  a bundle in the same workspace, revise-notes fed into rerun prompts,
  copyback filtered to produces, review.requested on completion only.
- **William's first skill is real and proven**: william-draft-skill-md
  (self-hosted workspace) drafted a genuine output/SKILL.md from design.md
  over real ACP in the gated e2e. The self-hosted journal has begun.
- Grader self-critique fold-in shipped (≥2-run floor before flagging).
- 357 pass / 0 fail (38 new); real run evidence in the PR.

## Phase 9+15 docs freshness (PR #29) + UI-pass prep (PRs #26/#27)

- Docs: grade/measurements/desktop pages with REAL captured CLI output;
  roadmap pruned; marketing feature cards + README updated; both sites
  redeployed.
- ui-pass-spec.md: 448-line cited extraction of the PMS Studio IA +
  director rulings (publish = distinct guided action; /catalog survives
  as the skill browser). Phase 17 builder executing it now.

## Phase 17 — UI pass (PR #33)

- Executed ui-pass-spec + rulings: hand-rolled router, AppShell nav
  [Board][Catalog][Activity], bundle detail as deep-linkable pages,
  ?run= URL-synced modal, guided publish flow, /catalog browser,
  /activity journal feed (paginated /api/events). 376 tests, 0 fail.
- Real find: Astro SSR prerender pass crashes a naive pushState router
  (window undefined) — SSR fallback documented in router.tsx.
- /chrome pass on all four surfaces + demo GIF in the PR.

## Phase 18 — installer, complete (PRs #31, #32, #34) + v0.1.0

- release.yml (tag-triggered darwin-arm64 + linux-x64 tarballs → GitHub
  Release); install.sh at skillmaker.studio/install.sh; v0.1.0 tagged —
  first real Release built by CI in 38s.
- **Verified against the real thing twice**: orchestrator installed from
  the raw GitHub URL pre-flip; the flip agent re-proved from the LIVE
  https://skillmaker.studio/install.sh (scratch HOME → binary →
  init/new/list, exit 0s). Docs/marketing/README flipped to
  curl-install-first; both sites redeployed.
- The 18a local proof caught a tarball-nesting bug before CI ever ran.

## Phase 11 — publish (dual marketplace) + skillbook (PR #37)

- core/Publish: git-dir + claude-marketplace + codex-marketplace targets;
  guards (stage=published AND drift in-sync); lossless manifest
  round-trips; idempotent per-target `skill.published` events. Codex
  marketplace shape flagged best-effort in-code (spec gap, not a verified
  integration).
- CLI `publish` + `book build` (static skillbook: index + per-bundle pages
  with design prose, measurement receipts incl. n·rate·CI + version hash,
  journal changelog); server `/api/skillbook` + publish endpoint; viewer
  `/skillbook` route + publish-to-targets step in the guided flow.
- Merged with main (Phase 12) — zero conflicts; full combined suite
  re-verified by orchestrator post-merge.

## Phase 12 — codex provider parity (PR #36)

- `ProviderProfile` abstraction (skill install dir: `.agents/skills` for
  codex vs `.claude/skills`; provider-aware model extraction; per-provider
  infra-stderr signatures). Adapter: `@agentclientprotocol/codex-acp@1.1.2`
  (live-verified — no model pin needed).
- Trigger fixture class + `didSkillActivate` fold-in (run detail reports
  activation; provider-tolerant — codex-acp has no dedicated skill tool
  and is detected via a `<slug>/SKILL.md` Read-path match instead of
  claude-code-acp's first-class `Skill` tool call).
- **Real codex e2e (run once, gated)**: completed — model
  gpt-5.6-sol[xhigh], artifact produced, 44 session updates, 15.95s.
- 388 pass / 0 fail (12 new); tsc clean; re-verified by orchestrator. One
  skill bundle can now be measured on claude-code AND codex — the
  vendor-agnostic claim is mechanical fact, not aspiration.

## Phase 16 — skillmaker adopt, brownfield import (PR #39)

- The strategic front door: adopt existing skills repos in place — no
  files moved, `bundle.json` + marker written into discovered dirs,
  layout-aware output hashing, permissive frontmatter (unknown keys
  preserved), pathname lifecycle mapping (`deprecated/` → archived,
  `in-progress/` → idea), generated-SKILL.md detection, idempotent
  re-adopt, manifests/eval-infra detected report-only.
- **Real-repo QA (cloned, adopted, verified)**: gstack — 60 found, 59
  adopted, 54 flagged generated, one symlinked skill deduped with a
  tolerated warning, nonstandard frontmatter preserved;
  mattpocock/skills — 39/39 adopted, 4 archived via `deprecated/`, 7
  landed at `idea` via `in-progress/`, `plugin.json` detected untouched.
- Real bug found+fixed: gstack puts `AUTO-GENERATED` comments *before*
  frontmatter — the parser now strips a leading comment (unit + e2e
  covered).
- 301 unit + 140 e2e pass, 0 fail; tsc clean; re-verified by orchestrator.
  Flagged follow-up: publish layout-awareness for adopted bundles
  (currently unreachable — the stage guard blocks it first).

## Fix: GET /api/skillbook 500s from concurrent index rebuild races (PR #40)

- Found via real-workspace browser verify (`/skillbook` 500'd while curl
  worked moments earlier).
- Root cause: concurrent `/api/*` handlers each opened their own
  `IndexService` and rebuild — a second connection's atomic rename
  invalidates the first's open vnode (`SQLITE_IOERR_VNODE`, macOS
  `bun:sqlite`); compounded by N+1 per-bundle rebuilds (13 rebuilds on one
  `/catalog` call) piling past `Bun.serve`'s 10s `idleTimeout` on cold
  loads.
- Fix: per-workspace async mutex around the DB handle (scope-ordered
  release), one rebuild per request in catalog/detail handlers,
  `idleTimeout: 30` as a safety net.
- Evidence: 20× concurrent `loadSkillbook` — reliable IOERR pre-fix, 0
  post-fix; 5-endpoint cold-load burst — intermittent 500s/6s pre → all
  200s in <0.7s post. 301 unit green post-merge with Phase 16.

## Phase 14 — library migration: the studio's knowledge, made true (PR #41)

- The predecessor Playmaker's Studio product-knowledge library migrated
  and rewritten against this leaner, shipped data model — deliberately
  scheduled after Phases 10-12/16 so the library describes software that
  actually exists, not aspiration.
- 101-card manifest: 14 KEEP / 24 REWRITE / 16 MERGE / 5 NEW-HOME / 42
  RETIRE + 9 net-new cards, spanning production (state machine, stations,
  bundle identity), board (journal-fold board, unified Todo, archive,
  activity feed), authoring (design.md, Director, Grader — 22 cards
  collapsed to 3), evals (the inherited-laws spine, including the
  `trigger` fixture class and k-tier measurement policy), outputs
  (Bundle Output, Skill Version, Skillbook, Publish, Publish Target — new
  context), and runs (Journal, Review Pair, Run State, ACP Provider,
  Canonical Store Split).
- Hot spots resolved against shipped code, not the prep doc's guesses:
  two-advancement-mechanisms (Guarded Transition merge), bank polysemy
  (Package Bank retired), stage/status polysemy (Bundle Stage), no
  refused verdict (confirmed shipped), Wake/Subscription retired after
  confirmed absence.
- Every prep-doc open question resolved or explicitly carried forward;
  Raven-reviewed against the shipped code before merge.
