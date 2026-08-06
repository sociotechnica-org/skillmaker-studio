Goal: GitHub Issue #190: Chat agent home seeds William helpers from the workspace only — no packaged fallback, so fresh projects trigger a permission storm

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/190

## Summary

Chat sessions seed Skillmaker's own helper skills (the William bundles) into the
agent home from the **user's workspace `skills/` directory only**, with no
product-packaged fallback. Every project that doesn't hand-carry the William
bundles — i.e. every real user project — starts its chat agent with no helpers,
so the agent goes hunting the operator's filesystem for them, and each
out-of-project path it touches raises a permission card. D6's "William ships
inside the product" was delivered for station runs (`resolveStationSkillDir`);
the chat path never got it. Give `prepareAgentHome` the same fallback.

## Motivation / Problem

This is the first-run experience for new users, and it is the opposite of what
the getting-started tour promises. The chat permission policy is deliberately
quiet — anything touching paths inside the project auto-approves silently — so a
well-provisioned agent should raise close to zero cards while it researches and
drafts inside the bundle. Instead the very first session becomes a permission
storm, and the cause is entirely self-inflicted: the agent is searching for
product machinery that should have been handed to it at spawn.

Cost is concentrated on exactly the population we can least afford to burn
(outside testers on a fresh project, per the "Your first skill" tour), and the
failure is silent — `prepareAgentHome` skips a missing helper without a warning,
so nothing in the UI, logs, or journal says the agent is running unequipped.

## Observed behavior

Fresh project on v0.6.2 via `npx skillmaker-studio@latest start`, project root
`/Users/danvers/skills`, provider `claude-code`, one chat session on a new
bundle.

The agent home has no `skills/` directory at all:

```
$ ls ~/.skillmaker/agent-home/claude-code/
.claude.json  .credentials.json  .last-cleanup  backups
projects  session-env  sessions  shell-snapshots
```

The session's transcript contains **24 tool calls, 23 of which reference paths
outside the project root** — every one of them a permission card the human had
to clear. The first call and several after it are the agent looking for its own
missing helpers, then falling back to searching the operator's machine:

```
ls /Users/danvers/.skillmaker/agent-home/claude-code/skills/
find / -maxdepth 8 -type d -iname "william-*"
find ~/.claude -maxdepth 4 -iname "*william*"
ls ~/.claude/skills/
ls ~/conductor/repos/
```

Exactly one of the 24 calls stayed inside the project.

Seeding the two bundles into `~/.skillmaker/agent-home/claude-code/skills/` by
hand removes the hunt — confirming the diagnosis and giving users a stopgap.

## Current shape

The station path already resolves this correctly, and the fix is "make chat
match station."

**Station runs (correct).** `Server.ts:2278` calls `locatePackagedSkillsDir()`
and threads it into `runStation`, which resolves per slug in
`resolveStationSkillDir` (`packages/core/src/StationEngine.ts:423`): the
workspace's own `<skillsDir>/<slug>/` wins when it has a `bundle.json`, else the
product-packaged copy. `StationRun.ts:84` does the same for the CLI. That
function's doc comment already states the fence this issue depends on —
packaged skills are visible to *station resolution only*; they never appear on
the Board, in bundle listings, or in the index.

**Chat (broken).** `prepareAgentHome` (`packages/cli/src/server/ChatSessions.ts:156-182`)
looks in one place and gives up:

```ts
const bundleDir = join(workspaceRoot, skillsDir, slug);
const sourceDir = existsSync(join(bundleDir, "output", "SKILL.md"))
  ? join(bundleDir, "output")
  : existsSync(join(bundleDir, "SKILL.md"))
    ? bundleDir
    : undefined;
if (sourceDir === undefined) continue;   // silent
```

`ChatSessions.ts` does not import `locatePackagedSkillsDir` at all — the only
consumers are `Server.ts` and `commands/StationRun.ts`. The declaring comment at
`ChatSessions.ts:58` records the gap as intended behavior ("silently skipped
when absent … still chats fine, just without the helpers"), which is what needs
revising: it does not chat fine, it chats loudly.

The trap worth naming: this is the same defect as friction-log entry #1
("William isn't distributed — every workspace must hand-carry his bundles"),
which PR #171 was believed to have closed. #171 fixed *station skill resolution*
and left *agent-home seeding* on the old assumption, so the repo's own
self-hosted `skills/` workspace — which does carry the William bundles — masks
it for every maintainer.

## Proposed contract

Per helper slug in `HELPER_SKILL_SLUGS`, resolution order:

| # | Source | Condition | `source` |
|---|---|---|---|
| 1 | `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md` → seed `output/` | file exists | `workspace` |
| 2 | `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md` → seed the bundle dir | file exists | `workspace` |
| 3 | `<packagedSkillsDir>/<slug>/output/SKILL.md` → seed `output/` | `locatePackagedSkillsDir()` returned a dir and the file exists | `packaged` |
| 4 | `<packagedSkillsDir>/<slug>/SKILL.md` → seed the bundle dir | as above | `packaged` |
| — | none | skip this slug, no throw | — |

Destination is unchanged: `<agentHome>/skills/<slug>/`, holding `SKILL.md` at
its root.

`installedHelpers` grows a source so callers and tests can assert *which* copy
won:

```ts
{ home: string, installedHelpers: ReadonlyArray<{ slug: string, source: "workspace" | "packaged" }> }
```

**Decisions:**

- Workspace copies always win, matching `resolveStationSkillDir` — hacking on
  William in this repo's self-hosted workspace keeps working, and any workspace
  can override a packaged helper by drafting its own.
- Resolution is **per slug**, not all-or-nothing: a workspace carrying one
  helper and not the other gets one of each source.
- The workspace probe keeps its existing two-layout shape (`output/SKILL.md`
  first, then a root `SKILL.md`), and the packaged probe uses the same shape.
- A slug that resolves to a source **replaces** the destination (existing
  `rmSync` + copy), so a stale helper from an older version cannot survive an
  upgrade. This clobbers hand-seeded workarounds, which is intended.
- A slug that resolves **nowhere** leaves any pre-existing destination
  untouched (today's behavior, unchanged) — the seeding step must not delete
  material it cannot replace.
- `locatePackagedSkillsDir()` returning `undefined` is not an error: a source
  checkout without the packaged dir behaves exactly as today.
- Packaged helpers remain invisible as workspace bundles. They are copied into
  the agent home and nowhere else — no Board row, no bundle listing, no index
  entry, no write into the user's `skills/` directory or personal config dir.
- No new UI and no new config knob. The permission policy itself is not touched.

## Acceptance criteria

- [ ] On a project whose `skills/` directory contains neither William bundle,
      starting a chat session leaves both `william-research-a-skill/SKILL.md`
      and `william-draft-skill-md/SKILL.md` present under
      `<agentHome>/<provider>/skills/`, sourced from the packaged copies.
- [ ] On a workspace that carries its own copy of a helper, that copy is what
      lands in the agent home, and `installedHelpers` reports it as
      `source: "workspace"` — the packaged copy does not override it.
- [ ] With one helper in the workspace and one only packaged, both land, each
      reporting its own source.
- [ ] Negative: when a slug resolves in neither location, `prepareAgentHome`
      returns without throwing, omits that slug from `installedHelpers`, the
      chat session still starts, and any pre-existing directory at that
      destination is left byte-identical.
- [ ] Negative: no packaged helper is written into the user's project — after a
      chat session on a fresh project, `<workspaceRoot>/<skillsDir>/` contains
      only the user's own bundles, and neither William slug appears in a bundle
      listing or on the Board.
- [ ] Idempotency: calling `prepareAgentHome` twice for the same provider yields
      the same tree — no nested `skills/<slug>/output/`, no accumulation, no
      duplicate entries in `installedHelpers`.
- [ ] Upgrade: a destination holding an older/edited copy of a helper is
      replaced by the resolved source rather than merged with it.
- [ ] Regression: station skill resolution is unchanged — the existing
      workspace-wins / packaged-fallback behavior and its precondition error
      message still hold for `skillmaker station run` and server-triggered
      station runs.
- [ ] Regression: the packaged-skills drift and location tests in
      `packages/cli/test/PackagedSkills.test.ts` still pass unmodified, and the
      compiled-binary layout still ships `packaged-skills` alongside the
      executable (`test/e2e/dist.e2e.test.ts`).
- [ ] Tests cover: packaged-only, workspace-only, mixed, neither, repeat-call
      idempotency, stale-destination replacement, and the no-write-into-project
      assertion. `prepareAgentHome` has no unit test today, so this is new
      coverage, not an amendment.

## Implementation notes

`locatePackagedSkillsDir` lives in the same package as `ChatSessions.ts`
(`packages/cli/src/PackagedSkills.ts`), so this needs no cross-package
plumbing — unlike the station path, where `StationEngine` sits in `core` and
takes the directory as an option. Prefer calling it inside `prepareAgentHome`
over threading a new parameter through every call site, unless a test seam makes
the parameter clearly better.

Scope fences, aimed at the plausible over-reaches here:

- **Do not touch the permission policy.** `makeChatPermissionPolicy` and the
  path-scoping in `AcpClient.ts` are correct as written; this issue removes the
  *reason* the agent leaves the project, not the guard that reports it. In
  particular, do not add an allowlist, an "always allow" affordance, or a
  config knob for auto-approval — those are separate product decisions.
- **Do not widen `HELPER_SKILL_SLUGS`.** Which helpers ship is a product
  ruling, not part of this fix.
- **Do not make a missing packaged directory fatal.** Source checkouts that
  haven't built `dist` must keep working.
- **Do not surface seeding in the UI.** If a signal is wanted for the silent-skip
  case, a server-side log line is the ceiling for this issue.

Relevant current files, as orientation only:

- `packages/cli/src/server/ChatSessions.ts` — `HELPER_SKILL_SLUGS` (:58),
  `prepareAgentHome` (:156), its two call sites (:598 capability probe, :793
  session start)
- `packages/cli/src/PackagedSkills.ts` — `locatePackagedSkillsDir`
- `packages/core/src/StationEngine.ts` — `resolveStationSkillDir` (:423), the
  behavior to mirror
- `packages/cli/test/PackagedSkills.test.ts` — existing drift/location coverage

## Not in scope

One adjacent defect found while diagnosing this, deliberately **not** bundled
here — file separately if wanted: `permissionPathsOutside`
(`packages/core/src/AcpClient.ts:431`) classifies every `~`-anchored path as
outside the root unconditionally, so a home-anchored reference to the project
directory itself (`~/skills/...` when the project *is* `~/skills`) raises a
permission card it shouldn't. Latent — it did not contribute to the transcript
above.


Implement exactly this issue. Verify every claim against the current code; the issue is a report, not a spec. The fix should mirror the workspace-wins-then-packaged-fallback resolution StationEngine uses (packages/core/src/StationEngine.ts resolveStationSkillDir, packages/cli/src/PackagedSkills.ts). Stay minimal: fix with tests, nothing adjacent.

Run ID: 01KZBRE9Q06N5BWK2W5A71X25P
Pipeline progress: 3 of 5 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Created the implementation plan at [2026-08-06-chat-agent-home-packaged-helper-fallback.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-06-chat-agent-home-packaged-helper-fallback.md).
  > 
  > It verifies current behavior, accounts for issue #203’s richer-result interaction, defines deterministic fallback tests, updates fresh-project chat and distribution E2E coverage, and preserves all permission, station, UI, and workspace-index scope fences. No implementation files were edited; `git diff --check` passes.
  > 
  > Plan ready for implementation: docs/proposals/2026-08-06-chat-agent-home-packaged-helper-fallback.md

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented Issue #190.
  > 
  > - [`ChatSessions.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:156) now resolves each William helper workspace-first, then falls back to `locatePackagedSkillsDir()`. Installed helpers report `{ slug, source }`; session preambles still receive only slug strings.
  > - Added deterministic agent-home coverage in [`ChatAgentHome.test.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatAgentHome.test.ts:1): packaged-only, workspace precedence, mixed sources, neither/preserve, idempotency, and stale replacement.
  > - Updated the chat E2E to use a fresh workspace and verify packaged helpers enter only the agent home, not workspace bundles/Board data.
  > - Updated the compiled-distribution E2E to copy and verify `packaged-skills/`; it passes against a freshly built distribution.
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: `bun test packages/cli/test/ChatAgentHome.test.ts`
  > - Passed: `bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000`
  > - Passed: `bun test test/e2e --timeout 30000`
  > - Passed: `bun run build:dist && bun test test/e2e/dist.e2e.test.ts --timeout 30000`
  > - Passed: `git diff --check`
  > 
  > One required gate remains externally blocked: `bun test packages` consistently has 1068 passing tests and one failure in the untouched [`JournalWatcher.test.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:34), whose existing-file append watch callback never fires in this environment. I reran that test and the full package suite; the same unrelated failure reproduced.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (3406 lines omitted)
  (pass) issue #109: GET /api/bundles/:slug lineage (custody chain + fork family) > route --as fork stamps the marker: the child carries forkOf + upstream, the parent lists the fork [867.00ms]
  (pass) issue #109: GET /api/intake salvaged (the Archive drawer's second population) > a salvage-routed crate leaves the queue and lands in the salvaged fold with its claims, testimony, and reason [813.00ms]
  (pass) issue #109: the acts land in the Feed while the items land in the drawer > retiring a bundle: the archived flag moves it to the drawer data, the act shows in GET /api/events [33.00ms]
  (pass) seam pass over #108/#109: GET /api/bundles/:slug for an in-place adopted bundle > a brownfield triage adopt's detail carries the seeded dossier, its reviewable files, and every listed file is servable [486.00ms]
  (pass) seam pass over #108/#109: GET /api/bundles/:slug for an in-place adopted bundle > the card's Record version button hashes the bundle's real in-place tree, not the conventional path [79.00ms]
  (pass) seam pass over #108/#109: GET /api/bundles/:slug for an in-place adopted bundle > card-fidelity round 2: an in-place bundle's fixture body is served from ITS OWN evals/ tree [67.00ms]
  (pass) card-fidelity simplify pass: GET /api/bundles/:slug instructionsPath for an output-dir bundle > null while output/SKILL.md doesn't exist (honest gap), then the layout's conventional path once it does [86.00ms]
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [2.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [332.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [682.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [55.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [20.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1928.01ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [830.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [822.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [1102.01ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [267.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [313.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [605.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [293.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [32.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [3.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [1.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [3.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [1.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [365.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [36.00ms]
  
  9 tests skipped:
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   376 pass
   9 skip
   0 fail
   1652 expect() calls
  Ran 385 tests across 48 files. [179.75s]
  == Build viewer: skipped (no packages/viewer changes) ==
  All repo gates passed.
  ```


# ReviewJudge

You are the single review-and-verdict gate before the PR. Review the
implementation diff against the scope plan (under `docs/proposals/`, named
by the scope stage) and the house rules, read the gates output from the
previous stage, and deliver ONE verdict. Do not edit any files.

Check:

- The diff stays within the plan's scope and package boundaries: domain
  logic and schemas in `packages/core`, deterministic CLI/server behavior
  in `packages/cli`, browser UI in `packages/viewer`.
- Comments are plain English prose explaining WHY, citing issues, dated
  proposals, and rulings (`packages/core/src/Todo.ts` is the standard).
- Behavior changes have tests (black-box CLI tests for CLI behavior,
  `test/e2e` for server-surface changes).
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- The deterministic gates output shows the repo gates passed on the final
  diff.

Grading bar — this line is load-bearing: a mergeable change with noted
imperfections is a PASSING grade — perfectionism is the expensive failure
mode; note imperfections in the PR body instead of bouncing. Only route
Fix for real defects: broken or untested behavior, scope/plan mismatch,
boundary violations, failing gates. Style nits, minor gaps, and "could be
better" observations go in a short "Imperfections to note in the PR body"
list in your response, which the Prepare PR stage will include.

Verdicts (exactly one):

- **ready** — the change is mergeable. List any imperfections for the PR
  body, then route to Prepare PR.
- **fix** — a real defect blocks merge. Allowed AT MOST ONCE per run (the
  graph enforces this: this node runs at most twice, so on your second
  run Fix is off the table — choose ready or surface). Give concrete,
  actionable fix items so the implement stage can act without guessing.
- **surface** — you and the implementation cannot converge (e.g. the fix
  round did not resolve the defect, or the plan itself is wrong). Stop
  the run with a clear summary of the disagreement for a human.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}
```

or:

```json
{"preferred_next_label":"Surface","outcome":"failed","failure_reason":"<one-line summary of the disagreement>","context_updates":{"verdict":"surface"}}
```
