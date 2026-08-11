# Chat Agent-Home Packaged Helper Fallback

*Implementation plan — 2026-08-06. GitHub issue #190. Run
`01KZBRE9Q06N5BWK2W5A71X25P`.*

## Status

Ready for implementation. This is a narrowly scoped CLI/server correction:
chat helper installation will use the product-packaged William bundles when
the workspace does not carry its own copies. The change does not alter station
resolution, permissions, workspace bundle discovery, the viewer, or packaging
layout.

## Outcome

Every invocation of `prepareAgentHome` will resolve each slug in the existing
`HELPER_SKILL_SLUGS` list independently:

| Priority | Candidate | Installed directory | Reported source |
|---|---|---|---|
| 1 | `<workspaceRoot>/<skillsDir>/<slug>/output/SKILL.md` | the workspace bundle's `output/` | `workspace` |
| 2 | `<workspaceRoot>/<skillsDir>/<slug>/SKILL.md` | the workspace bundle root | `workspace` |
| 3 | `<packagedSkillsDir>/<slug>/output/SKILL.md` | the packaged bundle's `output/` | `packaged` |
| 4 | `<packagedSkillsDir>/<slug>/SKILL.md` | the packaged bundle root | `packaged` |

The selected directory is copied to
`<agentHomeBase>/<provider>/skills/<slug>/`, so `SKILL.md` is always at the
destination root. A workspace copy wins for that slug even when a packaged
copy exists. If one helper exists in the workspace and the other only in the
product, both install from their respective sources.

`prepareAgentHome` will return source-aware entries:

```ts
interface InstalledHelper {
  readonly slug: string;
  readonly source: "workspace" | "packaged";
}

{
  readonly home: string;
  readonly installedHelpers: ReadonlyArray<InstalledHelper>;
}
```

The existing replacement boundary remains load-bearing:

- A resolved helper removes its destination before copying, replacing stale
  or manually seeded content instead of merging with it.
- An unresolved helper is skipped before removal, so an existing destination
  remains untouched.
- Repeated preparation produces the same destination shape and the same
  ordered result; it never nests `output/` under the slug.

The fallback is an agent-home injection source only. It does not copy packaged
bundles into the project, index them as workspace bundles, or expose them on
the Board.

## Verified current state

The issue's central defect is present at the current head:

- `packages/cli/src/server/ChatSessions.ts` defines exactly two helper slugs:
  `william-research-a-skill` and `william-draft-skill-md`.
- `prepareAgentHome(provider, workspaceRoot, skillsDir)` creates the
  per-provider home, seeds auth, and probes only the workspace bundle's
  `output/SKILL.md` and root `SKILL.md`. It silently continues when both are
  absent. It neither imports nor calls `locatePackagedSkillsDir`.
- Resolution and replacement are already per slug. A found source is copied
  after `rmSync(dest, { recursive: true, force: true })`; a missing source
  reaches no removal. The requested stale-replacement and unresolved-preserve
  semantics therefore need to be retained, not redesigned.
- The only two `prepareAgentHome` callers are the capability probe and the
  real session start in the same file. The probe consumes only `home`. Session
  start retains `installedHelpers` for the first-prompt preamble.
- `packages/cli/src/PackagedSkills.ts` already supplies the required
  product-location primitive. `locatePackagedSkillsDir()` first finds
  `packages/cli/skills` from a source checkout, then looks for an
  executable-adjacent `packaged-skills` directory, and returns `undefined`
  when neither exists.
- Both checked-in packaged William bundles have `bundle.json` and
  `output/SKILL.md`. `packages/cli/test/PackagedSkills.test.ts` verifies that
  every default station helper is present, byte-identical to the self-hosted
  workspace copy, locatable in source and simulated binary layouts, and
  non-fatal when absent.
- `packages/core/src/StationEngine.ts` already implements the source
  precedence to mirror: workspace `bundle.json` first, packaged `bundle.json`
  second, and `{ dir, source }` in the result. CLI and server station entry
  points both call `locatePackagedSkillsDir()` and pass the result into
  `runStation`.
- Core station tests cover workspace precedence, packaged fallback, neither,
  omission of the packaged root, and the precondition message naming both
  locations.
- Project bundle listings are rebuilt from the workspace index. Packaged
  station skills enter neither `IndexService` nor `WorkspaceService`; copying
  only into the agent home cannot create a Board row.

Two parts of the issue report need current-code refinements:

1. Issue #203, implemented after #190 was written, changed the chat preamble
   to name only helpers actually installed for the live session.
   `LiveChat.installedHelpers` and `PreambleContext.installedHelpers` are now
   slug arrays used by `buildChatPreamble`. The richer preparation result
   must therefore be projected to slugs at session start, or the prompt would
   render object values. The preamble contract itself should not change.
2. `test/e2e/dist.e2e.test.ts` does not currently verify packaged skills. Its
   isolated installation copies only `dist/skillmaker` and
   `dist/viewer-dist`; it neither requires nor copies
   `dist/packaged-skills`. The build and npm/desktop staging scripts do ship
   that directory, and the locator unit test simulates the compiled layout,
   but the named E2E is not evidence for that claim today. This plan closes
   that test gap without changing distribution implementation.

There is no existing proposal dedicated to issue #190. The related
`2026-08-04-honest-chat-helper-preamble.md` explicitly defers helper source
resolution to #190 and instructs a later implementation to retain richer
entries while rendering their `slug`, so this plan complements rather than
duplicates it.

## Design and data flow

Keep product location in the CLI package and keep chat installation
synchronous, matching the current function:

```text
prepareAgentHome
  -> locatePackagedSkillsDir once
  -> for each existing helper slug, in fixed order
     -> resolve workspace output/root
     -> otherwise resolve packaged output/root
     -> if resolved: remove destination, copy source tree, record slug+source
     -> if unresolved: leave destination untouched and record nothing
  -> return home + source-aware installedHelpers

real session start
  -> retain installedHelpers.map(({ slug }) => slug) on LiveChat
  -> existing preamble paths render the installed slug list
```

Do not reuse `resolveStationSkillDir` directly. It lives in core, is
Effect-based, qualifies a bundle by `bundle.json`, and returns a bundle
directory. Chat is synchronous CLI/server code, qualifies the installable
payload by `SKILL.md`, and supports both output-directory and in-place
layouts. The behavior to share is precedence, not the implementation.

Resolve the packaged root once per preparation call, not once per helper. A
small local helper may encapsulate the existing output-first/root-second
`SKILL.md` probe so workspace and packaged sources cannot drift into
different layout rules.

### Deterministic test seam

Production calls should locate the packaged root inside `prepareAgentHome`;
no new value needs to be threaded through `ChatSessionManager`,
`ProjectRegistry`, or server routes.

Add one optional final options argument solely at the exported unit seam. When
the options object is absent, call `locatePackagedSkillsDir()` normally. When
it is present, use its required `packagedSkillsDir: string | undefined`
verbatim. This lets tests supply a synthetic packaged tree or explicitly
simulate a source/build with no packaged directory:

```ts
prepareAgentHome(provider, workspaceRoot, skillsDir, {
  packagedSkillsDir: syntheticPackagedRoot,
});

prepareAgentHome(provider, workspaceRoot, skillsDir, {
  packagedSkillsDir: undefined,
});
```

Distinguishing an absent options object from an explicitly undefined test
value is important; a defaulted `string | undefined` parameter would invoke
the real locator in the negative test and accidentally find this checkout's
`packages/cli/skills`.

## Implementation plan

### 1. Add packaged fallback to chat preparation

In `packages/cli/src/server/ChatSessions.ts`:

1. Import `locatePackagedSkillsDir` from the existing sibling CLI module.
2. Define a source-aware `InstalledHelper` result type and update
   `prepareAgentHome`'s return type.
3. Add the optional packaged-root test seam described above, while leaving
   both production call sites unchanged.
4. Resolve the packaged root once before iterating the fixed helper list.
5. For each slug, retain the workspace output/root probe first; only if it
   fails, probe the packaged slug with the same output/root order.
6. Keep removal and copy after successful resolution only. Push
   `{ slug, source }` after the copy, preserving `HELPER_SKILL_SLUGS` order.
7. Revise the stale tunable and function comments that currently say a user
   project without William “still chats fine.” Explain why workspace
   overrides product content and cite issue #190 and this dated proposal in
   the repository's plain-English comment style.

Do not change `copyDirRecursive`, auth seeding, helper membership, destination
paths, error behavior for ordinary copy failures, or the capability probe's
`{ home }` destructuring.

### 2. Preserve the issue #203 preamble contract

At the real session-start call in `ChatSessions.ts`, map the source-aware
preparation result to its slug fields before assigning
`chat.installedHelpers`.

Keep `LiveChat.installedHelpers`, `PreambleContext.installedHelpers`,
`readPreambleContext`, `buildChatPreamble`, and `buildChatReorientation`
typed and behaved as they are now. The preamble should continue to name all
installed slugs in helper-list order, without exposing source labels or
rendering a guidance line when none resolved.

The capability probe still has no preamble consumer and may continue to
discard the installation metadata.

An empty source-aware result maps to the existing empty slug list. Do not add
a session-start precondition for helpers: the negative preparation test plus
the existing empty-helper preamble coverage should preserve the current
ability to start and chat when no helper resolves.

### 3. Add focused agent-home unit coverage

Create `packages/cli/test/ChatAgentHome.test.ts`. Keep these filesystem tests
separate from `ChatPreamble.test.ts` (prompt behavior) and
`PackagedSkills.test.ts` (packaged-copy drift and location).

Each test should use isolated temporary workspace, packaged, auth, and
agent-home directories. Set `SKILLMAKER_AGENT_HOME_DIR` to the scratch agent
home and `CODEX_HOME` to an empty scratch auth directory, call with provider
`codex`, and restore both environment variables in cleanup. That exercises
the real best-effort auth call without reading or writing operator state.

Use distinctive source contents and cover this matrix:

| Case | Arrangement | Assertions |
|---|---|---|
| Packaged only | Neither helper in workspace; both in synthetic packaged root, exercising output and root layouts | Both destination-root `SKILL.md` files exist with packaged bytes; result has two `packaged` entries in fixed order; the workspace tree is unchanged and gains no William directory. |
| Workspace wins | Both sources contain conflicting copies | Workspace bytes land for each helper and both entries report `workspace`; packaged content never overrides. |
| Mixed | One helper only in workspace, the other only packaged | Both land once and each entry reports its own source. |
| Neither | No workspace helper and the injected packaged root is `undefined` | No throw; result is empty; pre-existing destination files and nested structure remain byte-for-byte unchanged. |
| Repeat call | Run preparation twice against the same sources | The second tree and result equal the first; there is no nested `output/` and no duplicate result entry. |
| Upgrade | Seed a destination with edited `SKILL.md` and obsolete extra files | The resolved source replaces it completely; new bytes arrive and obsolete files disappear. |

The first two cases should distribute output-directory and in-place source
layouts across the two slugs so all four resolution candidates are exercised
without adding layout-only tests.

### 4. Turn the existing chat E2E into the fresh-project regression

Update `test/e2e/chat-sessions.e2e.test.ts`:

1. Remove the hand-carried workspace William fixture. The scratch project
   should contain only its two user-created test bundles.
2. Change both first-prompt paths to expect both William slugs. Running the
   source CLI from this checkout should locate the checked-in packaged
   copies.
3. Assert both helpers exist under the scratch provider agent home with
   `SKILL.md` at each slug root.
4. Assert neither helper directory appeared under the scratch project's
   `skills/`, and query the project bundle endpoint after session start to
   confirm its slugs remain only the two user-created bundles. This endpoint
   is the data source for the Board, so no viewer change or browser-specific
   test is needed.
5. Retain the existing assertion that no project-level `.claude/skills`
   directory was created.
6. Point `CLAUDE_CONFIG_DIR` at a scratch directory containing a harmless
   fake `.credentials.json` in the spawned server environment. The E2E does
   not need real auth, and providing the file prevents best-effort auth
   seeding from reading either ambient Claude files or the macOS Keychain.

This E2E proves the production default path calls the real locator. Source
provenance and mixed-source precedence remain deterministic unit concerns;
they should not be inferred from prompt text.

### 5. Make the compiled-layout regression test truthful

Update `test/e2e/dist.e2e.test.ts` without changing build or packaging code:

1. Name `dist/packaged-skills` as the third distributable source.
2. Continue using binary + viewer presence to decide whether a fresh checkout
   skips the suite, but require `dist/packaged-skills` in `beforeAll` once
   built artifacts are present. A stale/incomplete build must fail, not turn
   into a misleading skip.
3. Copy `packaged-skills` beside the isolated installed binary, matching the
   layout documented by `build-dist.sh` and consumed by the executable walk.
4. Assert the installed tree contains both William
   `output/SKILL.md` payloads.
5. Update the suite comments and missing-artifact diagnostic from “two
   distributable pieces” to the actual three-piece layout.

The existing `PackagedSkills.test.ts` compiled-layout test remains the
behavioral check for executable-relative location; this E2E supplies the
missing assertion that the built distribution actually contains and installs
that directory.

### 6. Leave station and distribution implementation untouched

Do not edit:

- `packages/core/src/StationEngine.ts`
- `packages/cli/src/PackagedSkills.ts`
- `packages/cli/src/commands/StationRun.ts`
- `packages/cli/src/server/Server.ts`
- packaging scripts or package manifests
- existing packaged skill payloads

Their existing tests are regression gates. In particular,
`packages/cli/test/PackagedSkills.test.ts` should pass unmodified.

## Validation

Run focused checks first:

```sh
bun test packages/cli/test/ChatAgentHome.test.ts
bun test packages/cli/test/ChatPreamble.test.ts
bun test packages/cli/test/PackagedSkills.test.ts
bun test packages/core/test/StationEngine.test.ts
bun run build:viewer
bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000
```

The viewer build is a prerequisite for the server-backed chat E2E, not a
viewer source-change requirement.

Then run the repository gates:

```sh
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun run build:viewer
bun test test/e2e --timeout 30000
```

Finally, verify the unchanged compiled distribution layout:

```sh
bun run build:dist
bun test test/e2e/dist.e2e.test.ts
```

Inspect `dist/packaged-skills/william-research-a-skill/output/SKILL.md` and
`dist/packaged-skills/william-draft-skill-md/output/SKILL.md` beside
`dist/skillmaker`; the amended distribution E2E should make the same
assertions in its isolated install.

Finish with `git diff --check` and `git status --short`. Expected authored
implementation changes are limited to:

- `packages/cli/src/server/ChatSessions.ts`
- new `packages/cli/test/ChatAgentHome.test.ts`
- `test/e2e/chat-sessions.e2e.test.ts`
- `test/e2e/dist.e2e.test.ts`
- this proposal

Generated/ignored viewer and distribution output may be present locally after
validation but should not be committed.

## Acceptance criteria

- A workspace with neither William bundle receives both packaged helpers at
  `<agentHome>/<provider>/skills/<slug>/SKILL.md` when the product ships them.
- A workspace helper wins over a conflicting packaged helper for the same
  slug and is reported as `source: "workspace"`.
- Resolution is independent per slug, so mixed workspace and packaged sources
  both install and report their actual provenance.
- Both output-directory and in-place helper layouts resolve in both source
  families.
- If neither source resolves, preparation does not throw for absence, omits
  the slug, leaves any existing destination unchanged, and does not prevent
  session startup.
- A resolved helper fully replaces stale destination content.
- Repeated preparation is idempotent in destination shape and result order.
- Preparation never writes packaged helpers into the project. After a fresh
  chat starts, project bundle listing/Board data still contains only user
  bundles.
- The first-message and agent-speaks-first preambles name the packaged helpers
  that actually landed, preserving issue #203's slug-only presentation.
- Missing packaged directories remain non-fatal in source/build arrangements
  that do not ship them.
- Station workspace precedence, packaged fallback, and precondition messages
  remain unchanged.
- Packaged-skill drift/location tests pass without modification, and the
  compiled build still places `packaged-skills` beside the executable.
- No permission-policy, viewer, package payload, packaging-script, workspace
  index, or station implementation changes are present.

## Risks and mitigations

- **The richer result leaks into the prompt as object strings.** Project once
  at real session start and retain the established slug-array boundary on
  `LiveChat`; keep preamble tests green.
- **Tests accidentally use this checkout's real packaged bundles.** Use the
  explicit packaged-root options seam for every unit case, including an
  explicit `undefined` negative case. Reserve the real locator for the chat
  E2E.
- **A fallback erases hand-seeded material when no replacement exists.**
  Preserve the current resolve-before-remove ordering and assert the
  unresolved destination's complete file tree and bytes.
- **A workspace override is selected all-or-nothing.** Resolve inside the slug
  loop and assert a mixed-source result.
- **Copying the bundle root creates an extra nesting level.** Continue copying
  the selected installable directory directly to the slug destination and
  assert root-level `SKILL.md` after first and repeated calls.
- **An auth seed touches developer credentials in unit tests.** Point
  `CODEX_HOME` and `SKILLMAKER_AGENT_HOME_DIR` at temporary directories and
  restore process environment in cleanup; isolate `CLAUDE_CONFIG_DIR` behind
  a scratch fake credential file in the chat E2E as well.
- **The issue's distribution-test claim gives false confidence.** Run the
  unchanged packaged location/drift tests, make the distribution E2E copy
  and inspect the third distributable, and inspect a fresh `build:dist`
  artifact explicitly.

## Explicitly out of scope and deferred

- No changes to `makeChatPermissionPolicy`, `AcpClient.ts`, path scoping,
  allowlists, auto-approval, or permission UI.
- No change to `HELPER_SKILL_SLUGS` membership or order.
- No UI, config knob, warning card, journal event, telemetry, or persisted
  session field for helper source.
- No writes to the workspace, personal provider config directories, bundle
  index, or Board data.
- No changes to packaged William content, station resolution, station
  entry-point plumbing, or station error text.
- No fix for `permissionPathsOutside` and its `~`-anchored project-path
  classification; that adjacent defect remains a separate issue.
- No edits under `docs/library`.
- The distribution E2E will verify the three-piece installed layout, but a
  compiled-binary chat session against a fake ACP adapter remains deferred;
  source chat E2E plus the executable-relative locator test cover those two
  behaviors independently.
