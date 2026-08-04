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


Implement exactly this issue. Verify every claim in the issue against the current code before acting on it; the issue is a report, not a spec — the code is the truth. Stay minimal: fix the reported defect with tests, nothing adjacent.

Run ID: 01KZ6YKBW883Y184M1BA028WDJ
Pipeline progress: 9 of 7 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Plan ready for implementation: docs/proposals/2026-08-04-chat-agent-home-packaged-william-fallback.md
  > 
  > --- BEGIN PLAN DOC ---
  > # Chat Agent-Home Packaged William Fallback
  > 
  > *Implementation plan — 2026-08-04. GitHub issue #190; run
  > `01KZ6YKBW883Y184M1BA028WDJ`.*
  > 
  > ## Status
  > 
  > Ready for implementation. The defect and the proposed source precedence are
  > confirmed against the current code. The change is confined to chat helper
  > seeding in `packages/cli`, with direct unit coverage and one existing chat
  > server E2E updated so a fresh workspace no longer masks the packaged fallback.
  > 
  > ## Outcome
  > 
  > Before a capability probe or chat session starts an ACP provider,
  > `prepareAgentHome` will install each of Skillmaker's two existing William
  > helpers from the workspace when that workspace carries a usable copy, and
  > otherwise from the product-packaged skills directory located by
  > `locatePackagedSkillsDir()`.
  > 
  > Resolution remains independent per helper slug. A self-hosting workspace can
  > override one or both packaged helpers, while a fresh user project receives both
  > packaged copies without gaining William bundles in its own `skills/` directory,
  > bundle listing, index, or Board data.
  > 
  > The destination remains:
  > 
  > ```text
  > <agent-home-base>/<provider>/skills/<helper-slug>/SKILL.md
  > ```
  > 
  > The return value will report provenance:
  > 
  > ```ts
  > {
  >   home: string;
  >   installedHelpers: ReadonlyArray<{
  >     slug: string;
  >     source: "workspace" | "packaged";
  >   }>;
  > }
  > ```
  > 
  > No provenance is added to a server response or viewer surface. The two current
  > callers continue to consume only `home`; the richer result exists so the
  > seeding contract is observable in focused tests and available to future
  > diagnostics without changing chat behavior now.
  > 
  > ## Verified current state
  > 
  > The issue is a report rather than the source of truth. The following claims
  > were checked against the current branch before planning the change.
  > 
  > ### Chat seeding is workspace-only
  > 
  > `packages/cli/src/server/ChatSessions.ts` currently defines exactly these
  > helper slugs:
  > 
  > ```text
  > william-research-a-skill
  > william-draft-skill-md
  > ```
  > 
  > For each slug, `prepareAgentHome` checks only:
  > 
  > 1. `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md`, then copies the
  >    contents of `output/`;
  > 2. `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md`, then copies the contents of
  >    the bundle directory.
  > 
  > If neither file exists, the slug is silently skipped. The function does not
  > import or call `locatePackagedSkillsDir`, and returns helper slugs without
  > source metadata. Both production callers—provider capability probing and real
  > session start—discard `installedHelpers` and use only `home`.
  > 
  > The current `rmSync` is deliberately after successful source resolution.
  > Therefore, the strongest accurate statement is that a fresh workspace plus a
  > fresh agent home receives no helpers. If an unresolved helper already exists
  > in the agent home, current behavior leaves it untouched; this preservation is
  > part of the required contract.
  > 
  > The first-prompt preamble tells the agent to use installed William guidance,
  > so the empty fresh-project home contradicts the instructions handed to the
  > agent. The reported filesystem hunt is consistent with that contradiction.
  > The exact transcript counts and provider decisions are runtime observations,
  > not facts reproducible from static repository inspection.
  > 
  > ### The packaged source already exists
  > 
  > `packages/cli/src/PackagedSkills.ts` provides
  > `locatePackagedSkillsDir()`. It first locates `packages/cli/skills` from a
  > source checkout, then looks for `packaged-skills` relative to the executable
  > for compiled distribution layouts, and returns `undefined` without throwing
  > when neither location exists.
  > 
  > The checked-in packaged directory contains both William bundles with
  > `output/SKILL.md`. `scripts/build-dist.sh`, npm package staging, and desktop
  > sidecar staging already carry that directory with the product. Existing
  > `packages/cli/test/PackagedSkills.test.ts` coverage checks source-copy drift,
  > source-checkout location, compiled-layout location, and the missing-directory
  > case.
  > 
  > ### Station behavior is already correct and is not the implementation seam
  > 
  > `packages/core/src/StationEngine.ts` resolves each station skill by workspace
  > `bundle.json`, then packaged `bundle.json`, returning source provenance. The
  > CLI station command and server-triggered station route locate and pass the
  > packaged directory. The station precondition error names both locations when
  > resolution fails.
  > 
  > Chat must mirror station's workspace-wins/product-fallback policy, but it must
  > not call the core station resolver: station validity is based on
  > `bundle.json`, while the established chat contract installs either an
  > `output/SKILL.md` payload or a root `SKILL.md` payload.
  > 
  > ### Existing test coverage masks the chat defect
  > 
  > There is no direct unit test for `prepareAgentHome`. The existing
  > `test/e2e/chat-sessions.e2e.test.ts` creates a workspace-local
  > `william-draft-skill-md` before starting the server, then checks only that this
  > one helper reaches the agent home and that `.claude/skills` is not created in
  > the project. Maintainers therefore exercise the workspace override path, not
  > the fresh-project packaged fallback.
  > 
  > The issue's reference to `test/e2e/dist.e2e.test.ts` needs one qualification:
  > that suite currently guards and copies only the compiled binary and
  > `viewer-dist`; it does not assert or copy `packaged-skills`. The distribution
  > scripts and `PackagedSkills.test.ts` establish the current packaged layout.
  > Strengthening the general dist E2E is useful follow-up work, but is not needed
  > to change chat seeding and would exceed this defect's minimal scope.
  > 
  > ## Resolution contract
  > 
  > For every slug in the unchanged `HELPER_SKILL_SLUGS`, use the first matching
  > probe:
  > 
  > | Priority | Probe | Copied directory | Reported source |
  > |---|---|---|---|
  > | 1 | `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md` | workspace bundle's `output/` | `workspace` |
  > | 2 | `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md` | workspace bundle directory | `workspace` |
  > | 3 | `<packagedSkillsDir>/<slug>/output/SKILL.md` | packaged bundle's `output/` | `packaged` |
  > | 4 | `<packagedSkillsDir>/<slug>/SKILL.md` | packaged bundle directory | `packaged` |
  > | — | no matching `SKILL.md` | do not copy or delete | omit the slug |
  > 
  > Resolve the packaged directory once per `prepareAgentHome` call, then resolve
  > each slug independently. The packaged source is optional: an unavailable
  > directory or a directory missing one helper is an ordinary unresolved probe,
  > not an exception.
  > 
  > After a source resolves, remove `<home>/skills/<slug>/` recursively before
  > copying the source directory's contents into it. This preserves upgrade
  > behavior: stale files and edited workarounds cannot survive when Skillmaker has
  > a source it can install. Keep removal after all probes fail so an unresolved
  > slug cannot destroy a pre-existing destination.
  > 
  > The copy destination and flattening behavior do not change. In particular,
  > copy the contents of `output/`, never the `output/` directory itself; repeated
  > calls must not create `skills/<slug>/output/` nesting.
  > 
  > ## Scope and files
  > 
  > ### Implementation
  > 
  > - Update `packages/cli/src/server/ChatSessions.ts`.
  >   - Import `locatePackagedSkillsDir`.
  >   - Revise the stale helper comment that says an absent workspace helper is
  >     acceptable and silently leaves chat without guidance.
  >   - Add the packaged fallback to helper resolution with the exact precedence
  >     above.
  >   - Change `installedHelpers` from slug strings to `{ slug, source }` records.
  >   - Keep auth seeding, provider-home selection, helper slugs, destination
  >     paths, recursive replacement, and both call sites otherwise unchanged.
  >   - Any new explanatory comment should cite issue #190 and D6 in
  >     `docs/proposals/2026-07-21-simplification.md`, and explain why workspace
  >     overrides and packaged fallback coexist.
  > 
  > Use a narrow test seam rather than changing manager or server plumbing. The
  > preferred shape is an optional packaged-skills locator function parameter on
  > `prepareAgentHome`, defaulting to `locatePackagedSkillsDir`. Production still
  > calls the locator inside `prepareAgentHome`; direct tests can supply a locator
  > that returns a scratch packaged directory or `undefined`. This avoids
  > environment-dependent source-tree discovery and does not require either
  > production call site to pass a new option.
  > 
  > ### Tests
  > 
  > - Add `packages/cli/test/ChatSessions.test.ts` for direct
  >   `prepareAgentHome` coverage.
  > - Update `test/e2e/chat-sessions.e2e.test.ts` so its project does not
  >   hand-carry a William helper and its real server/session-start assertion
  >   verifies the packaged fallback.
  > 
  > ### Explicitly unchanged
  > 
  > - `packages/cli/src/PackagedSkills.ts` and its existing tests.
  > - `packages/core`, including `StationEngine`, `AcpClient`, permission policy,
  >   provider profiles, schemas, and exports.
  > - Helper membership: do not widen `HELPER_SKILL_SLUGS`.
  > - Workspace discovery, indexing, bundle APIs, catalog/Board behavior, and the
  >   user's project files.
  > - Viewer, desktop, docs-site, public UI, config files, API response shapes, and
  >   journal events.
  > - Distribution/staging scripts and `test/e2e/dist.e2e.test.ts`.
  > - `docs/library`; it is read-only context for this work.
  > 
  > ## Implementation steps
  > 
  > 1. **Introduce source-aware helper resolution.** In `ChatSessions.ts`, define
  >    the small local source/result types needed by `prepareAgentHome`. Resolve
  >    workspace output, workspace root, packaged output, and packaged root in
  >    order. Keep this logic in the CLI server module because it is deterministic
  >    chat-home behavior, not a core domain schema.
  > 
  > 2. **Locate packaged skills at the preparation boundary.** Call the defaulted
  >    packaged-skills locator once after preparing the provider home and before
  >    iterating helper slugs. A test-supplied locator must be able to return
  >    either an isolated directory or `undefined`; no manager or server call site
  >    changes are needed.
  > 
  > 3. **Preserve replacement and unresolved semantics.** For a resolved result,
  >    retain the existing remove-then-copy operation and append one
  >    `{ slug, source }` record. For an unresolved result, continue without
  >    removing the destination and without appending a record.
  > 
  > 4. **Add a focused fixture matrix.** In the new CLI unit test, create isolated
  >    workspace, packaged, auth-source, and agent-home directories. Point
  >    `SKILLMAKER_AGENT_HOME_DIR` and the provider auth source at scratch
  >    locations, and restore environment variables and remove temp directories
  >    after each test so no operator state is read or written.
  > 
  > 5. **Exercise all source combinations and layouts.** Use distinguishable
  >    `SKILL.md` bytes and sibling files to prove which source won. Include at
  >    least one root-layout fixture as well as output-layout fixtures, and assert
  >    exact ordered provenance records.
  > 
  > 6. **Turn the chat E2E into the fresh-project regression.** Remove its
  >    workspace William fixture. After the existing explicit session start,
  >    assert both packaged helpers have root `SKILL.md` files in the scratch
  >    Claude agent home. Assert neither helper directory exists under the
  >    project's configured `skills/`, and assert both `/api/bundles` and
  >    `/api/catalog` continue to return only the user-created bundles. This tests
  >    the default locator and real session-start wiring without a real LLM.
  > 
  > 7. **Run focused and repository-wide validation.** Start with the new direct
  >    suite and the changed chat E2E, then run packaged-skill and station
  >    regressions, typechecks, all package tests, the viewer build prerequisite,
  >    and all E2E tests. Build the host distribution once to inspect that the
  >    existing packaged layout remains present beside the binary.
  > 
  > ## Test cases
  > 
  > The new direct suite must cover these behaviors:
  > 
  > 1. **Packaged only.** With neither helper in the workspace and both in the
  >    packaged directory, both land under the provider home and both report
  >    `source: "packaged"`.
  > 2. **Workspace only.** With packaged lookup unavailable and workspace
  >    helpers present, both install from the workspace and report
  >    `source: "workspace"`.
  > 3. **Mixed per slug.** Put one helper in the workspace and both or the other
  >    helper in the packaged fixture. Assert the workspace helper wins while the
  >    missing workspace helper falls back to packaged, with one provenance record
  >    for each in `HELPER_SKILL_SLUGS` order.
  > 4. **Layout precedence.** Exercise output and root `SKILL.md` layouts, and
  >    prove `output/SKILL.md` wins when both layouts are present for one source.
  > 5. **Neither source.** Return `undefined` from packaged lookup and leave the
  >    workspace empty. Assert no throw, no installed record, and a pre-existing
  >    destination tree retains the same relative paths and file bytes.
  > 6. **Repeat-call idempotency.** Call preparation twice against the same
  >    source. Assert the same records and destination tree, with no nested
  >    `output/`, duplicate record, or accumulated file.
  > 7. **Stale destination replacement.** Seed an old `SKILL.md` plus an obsolete
  >    sibling in the destination. Assert a resolved source replaces the skill
  >    and removes the obsolete file rather than merging.
  > 8. **No project write.** Snapshot the fresh project tree around packaged-only
  >    preparation. Assert neither helper is created in the configured project
  >    `skills/` directory and existing user bundles are unchanged.
  > 
  > The updated chat E2E must additionally prove that an actual fresh-project
  > session start uses the default packaged locator and that packaged helpers stay
  > absent from bundle-list and Board/catalog data.
  > 
  > ## Validation
  > 
  > Run from the repository root, in this order:
  > 
  > ```sh
  > bun test packages/cli/test/ChatSessions.test.ts
  > bun test packages/cli/test/PackagedSkills.test.ts packages/cli/test/ChatPreamble.test.ts
  > bun test packages/core/test/StationEngine.test.ts
  > bun run build:viewer
  > bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000
  > 
  > bunx tsc --noEmit -p packages/core
  > bunx tsc --noEmit -p packages/cli
  > bun test packages
  > bun test test/e2e --timeout 30000
  > ```
  > 
  > For the existing compiled distribution contract:
  > 
  > ```sh
  > bun run build:dist
  > test -x dist/skillmaker
  > test -f dist/packaged-skills/william-research-a-skill/output/SKILL.md
  > test -f dist/packaged-skills/william-draft-skill-md/output/SKILL.md
  > bun test test/e2e/dist.e2e.test.ts
  > ```
  > 
  > Then inspect:
  > 
  > - `git diff --check`;
  > - `git status --short`;
  > - the implementation diff contains no project-write, index, Board, permission,
  >   station, distribution, or viewer changes;
  > - the existing packaged-skills drift/location tests pass without edits;
  > - the existing station workspace-wins, packaged-fallback, and missing-source
  >   precondition tests pass without edits.
  > 
  > The expected authored implementation-stage diff is limited to
  > `ChatSessions.ts`, the new direct test, the chat-session E2E, and this proposal.
  > `dist/` is a gitignored build artifact.
  > 
  > ## Risks and mitigations
  > 
  > | Risk | Mitigation |
  > |---|---|
  > | Workspace overrides regress because packaged lookup is performed first or applied all-or-nothing. | Encode the four-step order once, resolve independently per slug, and assert distinguishable mixed-source bytes plus provenance. |
  > | Tests accidentally discover the repository's real packaged directory, making missing/mixed cases dishonest. | Inject a locator function into `prepareAgentHome`; every direct case explicitly returns its scratch directory or `undefined`. |
  > | Direct tests read or write operator auth/home state. | Point agent-home and provider auth environment variables at temp directories, save and restore prior values, and clean up in test hooks. |
  > | A missing source deletes a manually seeded workaround. | Do not move destination removal ahead of successful resolution; test an unresolved destination tree byte-for-byte. |
  > | An upgrade merges new files with stale helper files. | Preserve remove-then-copy for every resolved source and test removal of an obsolete sibling. |
  > | Packaged helpers leak into project discovery or Board data. | Keep all copies under the provider home; assert project paths, `/api/bundles`, and `/api/catalog` in the real-server E2E. |
  > | A source-checkout or partial package has no packaged directory. | Treat locator `undefined` and per-slug misses as ordinary fallthrough, retaining workspace-only and no-source behavior. |
  > | Station resolution changes while making chat “match station.” | Do not reuse or edit core station resolution; run its existing focused tests and full suites unchanged. |
  > 
  > ## Acceptance criteria
  > 
  > - [ ] A real chat session started for a fresh project installs
  >       `william-research-a-skill/SKILL.md` and
  >       `william-draft-skill-md/SKILL.md` under the provider's agent-home
  >       `skills/`, using packaged copies.
  > - [ ] A workspace helper overrides the packaged helper for the same slug, and
  >       `installedHelpers` reports `source: "workspace"`.
  > - [ ] Resolution is per slug: a mixed workspace/packaged setup installs both
  >       helpers and reports the correct source for each.
  > - [ ] Workspace and packaged probes both support output and root layouts, with
  >       `output/SKILL.md` preferred within each source.
  > - [ ] A helper found nowhere is omitted without throwing, leaves a
  >       pre-existing destination tree unchanged, and does not stop session
  >       startup.
  > - [ ] Resolved helpers replace stale destinations rather than merging.
  > - [ ] Repeated preparation yields the same tree and one result per resolved
  >       slug, with no nested `output/` directory or accumulated files.
  > - [ ] Packaged helpers are written only to agent home: no helper appears in
  >       the user's project, `/api/bundles`, or `/api/catalog`.
  > - [ ] The permission policy, helper slug set, UI, API, index, journal, and
  >       project configuration remain unchanged.
  > - [ ] Existing packaged-skill drift/location tests and station-resolution
  >       tests pass unmodified, including the station missing-source error.
  > - [ ] The host distribution still places both packaged William bundles beside
  >       the executable under `dist/packaged-skills`.
  > - [ ] Core and CLI typechecks, all package tests, viewer build, and all E2E
  >       tests pass.
  > 
  > ## Deferred follow-ups
  > 
  > - Fix `permissionPathsOutside` home-anchored path classification separately;
  >   issue #190 must not change permission policy.
  > - Decide separately whether missing helper seeding deserves a server log,
  >   metric, or user-visible diagnostic.
  > - Decide separately whether the general compiled-binary E2E should copy and
  >   assert every sidecar payload, including `packaged-skills`; its current gap
  >   predates this chat defect.
  > - Any change to the William helper set, delivery mechanism, or public
  >   configuration is a product ruling outside this fix.
  > 
  > ## Open questions
  > 
  > None. The current code and issue #190 establish the precedence, replacement,
  > missing-source, visibility, and scope decisions needed for implementation.
  > --- END PLAN DOC ---

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Added the missing workspace-precedence fixture to [ChatSessions.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSessions.test.ts:106): the mixed-source case now places `william-research-a-skill` in both workspace and packaged locations, and confirms the workspace `output/SKILL.md` still wins.
  > 
  > The underlying Issue #190 implementation already resolves helpers per slug in workspace-first, packaged-fallback order and reports provenance; this closes the review-identified coverage gap.
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: `bun test packages/cli/test/ChatSessions.test.ts` — 5 tests
  > - Passed: `bun test test/e2e --timeout 30000` — 370 passed; 16 environment-gated skips
  > - Passed: `git diff --check`
  > 
  > The required `bun test packages` remains blocked by a reproducible pre-existing failure in `packages/cli/test/JournalWatcher.test.ts` (“fires (debounced) on appends to an existing journal”). Both its test and implementation are byte-identical to `HEAD`, outside this issue’s scope, so I did not alter them.
  > 
  > Final diff: 1 file, 1 insertion.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1683 lines omitted)
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [3.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [343.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [684.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [36.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [54.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1843.99ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [773.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [771.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [1106.00ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [282.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [284.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [557.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [286.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [96.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [7.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [2.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [3.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [2.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [377.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [84.00ms]
  
  16 tests skipped:
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/health reports ok
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/bundles shows the bundle created via the binary
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET / serves the viewer HTML from the standalone viewer-dist/
  (skip) skillmaker distributed binary: golden path (Phase 12a) > claim file exists at the started port
  (skip) skillmaker distributed binary: golden path (Phase 12a) > SIGTERM stops the binary cleanly and removes the claim file
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1636 expect() calls
  Ran 386 tests across 48 files. [173.62s]
  == Build viewer: skipped (no packages/viewer changes) ==
  All repo gates passed.
  ```

## Stage: review
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > One remaining test gap blocks PR readiness: the direct suite never puts the same helper in both the workspace and packaged locations. Its mixed test has workspace `william-research-a-skill` and packaged `william-draft-skill-md`, so it proves per-slug fallback and layout precedence, but not the acceptance-critical guarantee that a workspace helper wins over an available packaged copy.
  > 
  > Add a distinguishable packaged `william-research-a-skill` fixture to the mixed test, then assert the installed bytes and `source: "workspace"` still come from the workspace. This is a test-only change; the implementation’s ordered resolver already appears correct.
  > 
  > Everything else is properly scoped: only CLI chat seeding and tests changed; no core, permission policy, viewer, project indexing, or `docs/library` changes. The explanatory comment cites Issue #190 and the dated D6 proposal. Focused chat, packaged-skill, and station tests passed locally; the recorded repository gate also passed (370 tests, with 16 explicitly gated skips).
  > 
  > ```json
  > {"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
  > ```

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Added the missing workspace-precedence fixture to [ChatSessions.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSessions.test.ts:106): the mixed-source case now places `william-research-a-skill` in both workspace and packaged locations, and confirms the workspace `output/SKILL.md` still wins.
  > 
  > The underlying Issue #190 implementation already resolves helpers per slug in workspace-first, packaged-fallback order and reports provenance; this closes the review-identified coverage gap.
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: `bun test packages/cli/test/ChatSessions.test.ts` — 5 tests
  > - Passed: `bun test test/e2e --timeout 30000` — 370 passed; 16 environment-gated skips
  > - Passed: `git diff --check`
  > 
  > The required `bun test packages` remains blocked by a reproducible pre-existing failure in `packages/cli/test/JournalWatcher.test.ts` (“fires (debounced) on appends to an existing journal”). Both its test and implementation are byte-identical to `HEAD`, outside this issue’s scope, so I did not alter them.
  > 
  > Final diff: 1 file, 1 insertion.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1683 lines omitted)
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [3.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [343.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [684.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [36.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [54.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1843.99ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [773.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [771.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [1106.00ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [282.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [284.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [557.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [286.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [96.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [7.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [2.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [3.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [2.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [377.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [84.00ms]
  
  16 tests skipped:
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/health reports ok
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/bundles shows the bundle created via the binary
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET / serves the viewer HTML from the standalone viewer-dist/
  (skip) skillmaker distributed binary: golden path (Phase 12a) > claim file exists at the started port
  (skip) skillmaker distributed binary: golden path (Phase 12a) > SIGTERM stops the binary cleanly and removes the claim file
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1636 expect() calls
  Ran 386 tests across 48 files. [173.62s]
  == Build viewer: skipped (no packages/viewer changes) ==
  All repo gates passed.
  ```

## Stage: review
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > One remaining test gap blocks PR readiness: the direct suite never puts the same helper in both the workspace and packaged locations. Its mixed test has workspace `william-research-a-skill` and packaged `william-draft-skill-md`, so it proves per-slug fallback and layout precedence, but not the acceptance-critical guarantee that a workspace helper wins over an available packaged copy.
  > 
  > Add a distinguishable packaged `william-research-a-skill` fixture to the mixed test, then assert the installed bytes and `source: "workspace"` still come from the workspace. This is a test-only change; the implementation’s ordered resolver already appears correct.
  > 
  > Everything else is properly scoped: only CLI chat seeding and tests changed; no core, permission policy, viewer, project indexing, or `docs/library` changes. The explanatory comment cites Issue #190 and the dated D6 proposal. Focused chat, packaged-skill, and station tests passed locally; the recorded repository gate also passed (370 tests, with 16 explicitly gated skips).
  > 
  > ```json
  > {"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
  > ```

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Added the missing workspace-precedence fixture to [ChatSessions.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatSessions.test.ts:106): the mixed-source case now places `william-research-a-skill` in both workspace and packaged locations, and confirms the workspace `output/SKILL.md` still wins.
  > 
  > The underlying Issue #190 implementation already resolves helpers per slug in workspace-first, packaged-fallback order and reports provenance; this closes the review-identified coverage gap.
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: `bun test packages/cli/test/ChatSessions.test.ts` — 5 tests
  > - Passed: `bun test test/e2e --timeout 30000` — 370 passed; 16 environment-gated skips
  > - Passed: `git diff --check`
  > 
  > The required `bun test packages` remains blocked by a reproducible pre-existing failure in `packages/cli/test/JournalWatcher.test.ts` (“fires (debounced) on appends to an existing journal”). Both its test and implementation are byte-identical to `HEAD`, outside this issue’s scope, so I did not alter them.
  > 
  > Final diff: 1 file, 1 insertion.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1683 lines omitted)
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [3.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [343.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [684.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [36.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [54.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1843.99ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [773.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [771.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [1106.00ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [282.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [284.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [557.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [286.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [96.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [7.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [2.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [3.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [2.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [377.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [84.00ms]
  
  16 tests skipped:
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/health reports ok
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/bundles shows the bundle created via the binary
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET / serves the viewer HTML from the standalone viewer-dist/
  (skip) skillmaker distributed binary: golden path (Phase 12a) > claim file exists at the started port
  (skip) skillmaker distributed binary: golden path (Phase 12a) > SIGTERM stops the binary cleanly and removes the claim file
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1636 expect() calls
  Ran 386 tests across 48 files. [173.62s]
  == Build viewer: skipped (no packages/viewer changes) ==
  All repo gates passed.
  ```

## Current context
| Key | Value |
|-----|-------|
| review_ready | false |


# Review

Review the implementation as if preparing a pull request.

Check:

- The diff stays within the requested Skillmaker Studio scope and the
  plan's named package boundaries: domain logic and schemas in
  `packages/core`, deterministic CLI/server behavior in `packages/cli`,
  browser UI in `packages/viewer`.
- CLI changes have black-box tests for behavior, exit codes, and
  important output fields; server-surface changes have `test/e2e`
  coverage.
- Viewer changes build (`bun run build:viewer` ran in validation).
- Comments follow the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings (see
  `packages/core/src/Todo.ts` for the standard). Flag comments that
  merely restate the code, and new non-obvious decisions left
  uncommented or uncited.
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- Validation output from the gates node is understood and any failures
  are actionable.

Do not make implementation, prompt, config, or test edits in this stage.
If a change is required, route back to implementation with enough context
for the next implement stage to make the fix.

If the implementation is not ready, be concrete about the remaining
blocking work so the next implementation stage has actionable context.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```
