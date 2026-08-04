Plan ready for implementation: docs/proposals/2026-08-04-chat-agent-home-packaged-william-fallback.md

--- BEGIN PLAN DOC ---
# Chat Agent-Home Packaged William Fallback

*Implementation plan — 2026-08-04. GitHub issue #190; run
`01KZ6YKBW883Y184M1BA028WDJ`.*

## Status

Ready for implementation. The defect and the proposed source precedence are
confirmed against the current code. The change is confined to chat helper
seeding in `packages/cli`, with direct unit coverage and one existing chat
server E2E updated so a fresh workspace no longer masks the packaged fallback.

## Outcome

Before a capability probe or chat session starts an ACP provider,
`prepareAgentHome` will install each of Skillmaker's two existing William
helpers from the workspace when that workspace carries a usable copy, and
otherwise from the product-packaged skills directory located by
`locatePackagedSkillsDir()`.

Resolution remains independent per helper slug. A self-hosting workspace can
override one or both packaged helpers, while a fresh user project receives both
packaged copies without gaining William bundles in its own `skills/` directory,
bundle listing, index, or Board data.

The destination remains:

```text
<agent-home-base>/<provider>/skills/<helper-slug>/SKILL.md
```

The return value will report provenance:

```ts
{
  home: string;
  installedHelpers: ReadonlyArray<{
    slug: string;
    source: "workspace" | "packaged";
  }>;
}
```

No provenance is added to a server response or viewer surface. The two current
callers continue to consume only `home`; the richer result exists so the
seeding contract is observable in focused tests and available to future
diagnostics without changing chat behavior now.

## Verified current state

The issue is a report rather than the source of truth. The following claims
were checked against the current branch before planning the change.

### Chat seeding is workspace-only

`packages/cli/src/server/ChatSessions.ts` currently defines exactly these
helper slugs:

```text
william-research-a-skill
william-draft-skill-md
```

For each slug, `prepareAgentHome` checks only:

1. `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md`, then copies the
   contents of `output/`;
2. `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md`, then copies the contents of
   the bundle directory.

If neither file exists, the slug is silently skipped. The function does not
import or call `locatePackagedSkillsDir`, and returns helper slugs without
source metadata. Both production callers—provider capability probing and real
session start—discard `installedHelpers` and use only `home`.

The current `rmSync` is deliberately after successful source resolution.
Therefore, the strongest accurate statement is that a fresh workspace plus a
fresh agent home receives no helpers. If an unresolved helper already exists
in the agent home, current behavior leaves it untouched; this preservation is
part of the required contract.

The first-prompt preamble tells the agent to use installed William guidance,
so the empty fresh-project home contradicts the instructions handed to the
agent. The reported filesystem hunt is consistent with that contradiction.
The exact transcript counts and provider decisions are runtime observations,
not facts reproducible from static repository inspection.

### The packaged source already exists

`packages/cli/src/PackagedSkills.ts` provides
`locatePackagedSkillsDir()`. It first locates `packages/cli/skills` from a
source checkout, then looks for `packaged-skills` relative to the executable
for compiled distribution layouts, and returns `undefined` without throwing
when neither location exists.

The checked-in packaged directory contains both William bundles with
`output/SKILL.md`. `scripts/build-dist.sh`, npm package staging, and desktop
sidecar staging already carry that directory with the product. Existing
`packages/cli/test/PackagedSkills.test.ts` coverage checks source-copy drift,
source-checkout location, compiled-layout location, and the missing-directory
case.

### Station behavior is already correct and is not the implementation seam

`packages/core/src/StationEngine.ts` resolves each station skill by workspace
`bundle.json`, then packaged `bundle.json`, returning source provenance. The
CLI station command and server-triggered station route locate and pass the
packaged directory. The station precondition error names both locations when
resolution fails.

Chat must mirror station's workspace-wins/product-fallback policy, but it must
not call the core station resolver: station validity is based on
`bundle.json`, while the established chat contract installs either an
`output/SKILL.md` payload or a root `SKILL.md` payload.

### Existing test coverage masks the chat defect

There is no direct unit test for `prepareAgentHome`. The existing
`test/e2e/chat-sessions.e2e.test.ts` creates a workspace-local
`william-draft-skill-md` before starting the server, then checks only that this
one helper reaches the agent home and that `.claude/skills` is not created in
the project. Maintainers therefore exercise the workspace override path, not
the fresh-project packaged fallback.

The issue's reference to `test/e2e/dist.e2e.test.ts` needs one qualification:
that suite currently guards and copies only the compiled binary and
`viewer-dist`; it does not assert or copy `packaged-skills`. The distribution
scripts and `PackagedSkills.test.ts` establish the current packaged layout.
Strengthening the general dist E2E is useful follow-up work, but is not needed
to change chat seeding and would exceed this defect's minimal scope.

## Resolution contract

For every slug in the unchanged `HELPER_SKILL_SLUGS`, use the first matching
probe:

| Priority | Probe | Copied directory | Reported source |
|---|---|---|---|
| 1 | `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md` | workspace bundle's `output/` | `workspace` |
| 2 | `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md` | workspace bundle directory | `workspace` |
| 3 | `<packagedSkillsDir>/<slug>/output/SKILL.md` | packaged bundle's `output/` | `packaged` |
| 4 | `<packagedSkillsDir>/<slug>/SKILL.md` | packaged bundle directory | `packaged` |
| — | no matching `SKILL.md` | do not copy or delete | omit the slug |

Resolve the packaged directory once per `prepareAgentHome` call, then resolve
each slug independently. The packaged source is optional: an unavailable
directory or a directory missing one helper is an ordinary unresolved probe,
not an exception.

After a source resolves, remove `<home>/skills/<slug>/` recursively before
copying the source directory's contents into it. This preserves upgrade
behavior: stale files and edited workarounds cannot survive when Skillmaker has
a source it can install. Keep removal after all probes fail so an unresolved
slug cannot destroy a pre-existing destination.

The copy destination and flattening behavior do not change. In particular,
copy the contents of `output/`, never the `output/` directory itself; repeated
calls must not create `skills/<slug>/output/` nesting.

## Scope and files

### Implementation

- Update `packages/cli/src/server/ChatSessions.ts`.
  - Import `locatePackagedSkillsDir`.
  - Revise the stale helper comment that says an absent workspace helper is
    acceptable and silently leaves chat without guidance.
  - Add the packaged fallback to helper resolution with the exact precedence
    above.
  - Change `installedHelpers` from slug strings to `{ slug, source }` records.
  - Keep auth seeding, provider-home selection, helper slugs, destination
    paths, recursive replacement, and both call sites otherwise unchanged.
  - Any new explanatory comment should cite issue #190 and D6 in
    `docs/proposals/2026-07-21-simplification.md`, and explain why workspace
    overrides and packaged fallback coexist.

Use a narrow test seam rather than changing manager or server plumbing. The
preferred shape is an optional packaged-skills locator function parameter on
`prepareAgentHome`, defaulting to `locatePackagedSkillsDir`. Production still
calls the locator inside `prepareAgentHome`; direct tests can supply a locator
that returns a scratch packaged directory or `undefined`. This avoids
environment-dependent source-tree discovery and does not require either
production call site to pass a new option.

### Tests

- Add `packages/cli/test/ChatSessions.test.ts` for direct
  `prepareAgentHome` coverage.
- Update `test/e2e/chat-sessions.e2e.test.ts` so its project does not
  hand-carry a William helper and its real server/session-start assertion
  verifies the packaged fallback.

### Explicitly unchanged

- `packages/cli/src/PackagedSkills.ts` and its existing tests.
- `packages/core`, including `StationEngine`, `AcpClient`, permission policy,
  provider profiles, schemas, and exports.
- Helper membership: do not widen `HELPER_SKILL_SLUGS`.
- Workspace discovery, indexing, bundle APIs, catalog/Board behavior, and the
  user's project files.
- Viewer, desktop, docs-site, public UI, config files, API response shapes, and
  journal events.
- Distribution/staging scripts and `test/e2e/dist.e2e.test.ts`.
- `docs/library`; it is read-only context for this work.

## Implementation steps

1. **Introduce source-aware helper resolution.** In `ChatSessions.ts`, define
   the small local source/result types needed by `prepareAgentHome`. Resolve
   workspace output, workspace root, packaged output, and packaged root in
   order. Keep this logic in the CLI server module because it is deterministic
   chat-home behavior, not a core domain schema.

2. **Locate packaged skills at the preparation boundary.** Call the defaulted
   packaged-skills locator once after preparing the provider home and before
   iterating helper slugs. A test-supplied locator must be able to return
   either an isolated directory or `undefined`; no manager or server call site
   changes are needed.

3. **Preserve replacement and unresolved semantics.** For a resolved result,
   retain the existing remove-then-copy operation and append one
   `{ slug, source }` record. For an unresolved result, continue without
   removing the destination and without appending a record.

4. **Add a focused fixture matrix.** In the new CLI unit test, create isolated
   workspace, packaged, auth-source, and agent-home directories. Point
   `SKILLMAKER_AGENT_HOME_DIR` and the provider auth source at scratch
   locations, and restore environment variables and remove temp directories
   after each test so no operator state is read or written.

5. **Exercise all source combinations and layouts.** Use distinguishable
   `SKILL.md` bytes and sibling files to prove which source won. Include at
   least one root-layout fixture as well as output-layout fixtures, and assert
   exact ordered provenance records.

6. **Turn the chat E2E into the fresh-project regression.** Remove its
   workspace William fixture. After the existing explicit session start,
   assert both packaged helpers have root `SKILL.md` files in the scratch
   Claude agent home. Assert neither helper directory exists under the
   project's configured `skills/`, and assert both `/api/bundles` and
   `/api/catalog` continue to return only the user-created bundles. This tests
   the default locator and real session-start wiring without a real LLM.

7. **Run focused and repository-wide validation.** Start with the new direct
   suite and the changed chat E2E, then run packaged-skill and station
   regressions, typechecks, all package tests, the viewer build prerequisite,
   and all E2E tests. Build the host distribution once to inspect that the
   existing packaged layout remains present beside the binary.

## Test cases

The new direct suite must cover these behaviors:

1. **Packaged only.** With neither helper in the workspace and both in the
   packaged directory, both land under the provider home and both report
   `source: "packaged"`.
2. **Workspace only.** With packaged lookup unavailable and workspace
   helpers present, both install from the workspace and report
   `source: "workspace"`.
3. **Mixed per slug.** Put one helper in the workspace and both or the other
   helper in the packaged fixture. Assert the workspace helper wins while the
   missing workspace helper falls back to packaged, with one provenance record
   for each in `HELPER_SKILL_SLUGS` order.
4. **Layout precedence.** Exercise output and root `SKILL.md` layouts, and
   prove `output/SKILL.md` wins when both layouts are present for one source.
5. **Neither source.** Return `undefined` from packaged lookup and leave the
   workspace empty. Assert no throw, no installed record, and a pre-existing
   destination tree retains the same relative paths and file bytes.
6. **Repeat-call idempotency.** Call preparation twice against the same
   source. Assert the same records and destination tree, with no nested
   `output/`, duplicate record, or accumulated file.
7. **Stale destination replacement.** Seed an old `SKILL.md` plus an obsolete
   sibling in the destination. Assert a resolved source replaces the skill
   and removes the obsolete file rather than merging.
8. **No project write.** Snapshot the fresh project tree around packaged-only
   preparation. Assert neither helper is created in the configured project
   `skills/` directory and existing user bundles are unchanged.

The updated chat E2E must additionally prove that an actual fresh-project
session start uses the default packaged locator and that packaged helpers stay
absent from bundle-list and Board/catalog data.

## Validation

Run from the repository root, in this order:

```sh
bun test packages/cli/test/ChatSessions.test.ts
bun test packages/cli/test/PackagedSkills.test.ts packages/cli/test/ChatPreamble.test.ts
bun test packages/core/test/StationEngine.test.ts
bun run build:viewer
bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000

bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

For the existing compiled distribution contract:

```sh
bun run build:dist
test -x dist/skillmaker
test -f dist/packaged-skills/william-research-a-skill/output/SKILL.md
test -f dist/packaged-skills/william-draft-skill-md/output/SKILL.md
bun test test/e2e/dist.e2e.test.ts
```

Then inspect:

- `git diff --check`;
- `git status --short`;
- the implementation diff contains no project-write, index, Board, permission,
  station, distribution, or viewer changes;
- the existing packaged-skills drift/location tests pass without edits;
- the existing station workspace-wins, packaged-fallback, and missing-source
  precondition tests pass without edits.

The expected authored implementation-stage diff is limited to
`ChatSessions.ts`, the new direct test, the chat-session E2E, and this proposal.
`dist/` is a gitignored build artifact.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Workspace overrides regress because packaged lookup is performed first or applied all-or-nothing. | Encode the four-step order once, resolve independently per slug, and assert distinguishable mixed-source bytes plus provenance. |
| Tests accidentally discover the repository's real packaged directory, making missing/mixed cases dishonest. | Inject a locator function into `prepareAgentHome`; every direct case explicitly returns its scratch directory or `undefined`. |
| Direct tests read or write operator auth/home state. | Point agent-home and provider auth environment variables at temp directories, save and restore prior values, and clean up in test hooks. |
| A missing source deletes a manually seeded workaround. | Do not move destination removal ahead of successful resolution; test an unresolved destination tree byte-for-byte. |
| An upgrade merges new files with stale helper files. | Preserve remove-then-copy for every resolved source and test removal of an obsolete sibling. |
| Packaged helpers leak into project discovery or Board data. | Keep all copies under the provider home; assert project paths, `/api/bundles`, and `/api/catalog` in the real-server E2E. |
| A source-checkout or partial package has no packaged directory. | Treat locator `undefined` and per-slug misses as ordinary fallthrough, retaining workspace-only and no-source behavior. |
| Station resolution changes while making chat “match station.” | Do not reuse or edit core station resolution; run its existing focused tests and full suites unchanged. |

## Acceptance criteria

- [ ] A real chat session started for a fresh project installs
      `william-research-a-skill/SKILL.md` and
      `william-draft-skill-md/SKILL.md` under the provider's agent-home
      `skills/`, using packaged copies.
- [ ] A workspace helper overrides the packaged helper for the same slug, and
      `installedHelpers` reports `source: "workspace"`.
- [ ] Resolution is per slug: a mixed workspace/packaged setup installs both
      helpers and reports the correct source for each.
- [ ] Workspace and packaged probes both support output and root layouts, with
      `output/SKILL.md` preferred within each source.
- [ ] A helper found nowhere is omitted without throwing, leaves a
      pre-existing destination tree unchanged, and does not stop session
      startup.
- [ ] Resolved helpers replace stale destinations rather than merging.
- [ ] Repeated preparation yields the same tree and one result per resolved
      slug, with no nested `output/` directory or accumulated files.
- [ ] Packaged helpers are written only to agent home: no helper appears in
      the user's project, `/api/bundles`, or `/api/catalog`.
- [ ] The permission policy, helper slug set, UI, API, index, journal, and
      project configuration remain unchanged.
- [ ] Existing packaged-skill drift/location tests and station-resolution
      tests pass unmodified, including the station missing-source error.
- [ ] The host distribution still places both packaged William bundles beside
      the executable under `dist/packaged-skills`.
- [ ] Core and CLI typechecks, all package tests, viewer build, and all E2E
      tests pass.

## Deferred follow-ups

- Fix `permissionPathsOutside` home-anchored path classification separately;
  issue #190 must not change permission policy.
- Decide separately whether missing helper seeding deserves a server log,
  metric, or user-visible diagnostic.
- Decide separately whether the general compiled-binary E2E should copy and
  assert every sidecar payload, including `packaged-skills`; its current gap
  predates this chat defect.
- Any change to the William helper set, delivery mechanism, or public
  configuration is a product ruling outside this fix.

## Open questions

None. The current code and issue #190 establish the precedence, replacement,
missing-source, visibility, and scope decisions needed for implementation.
--- END PLAN DOC ---