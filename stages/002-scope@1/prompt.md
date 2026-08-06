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
Pipeline progress: 0 of 5 stages completed


# Scope

Write a durable technical implementation plan for the requested
Skillmaker Studio feature to
`docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md` (refine an
existing relevant plan instead of duplicating it). Do not edit
implementation files in this stage.

## The repository

Skillmaker Studio is a bun + Effect TypeScript monorepo (bun workspaces):

- `packages/core` — the domain engine: skills, evals, journal, todos,
  triage. Effect-first; schemas live here and everything else consumes
  them.
- `packages/cli` — the `skillmaker` CLI and the local server the Studio
  UI rides on. Command data on stdout, diagnostics on stderr, stable
  exit codes.
- `packages/viewer` — the Studio browser UI (Astro + React).
- `packages/desktop`, `packages/docs-site`, `packages/marketing-site`,
  `packages/skill` — touch these only when the goal names them.
- `test/e2e` — black-box end-to-end tests over the CLI and server
  surfaces.
- `docs/proposals/` — dated proposal/plan documents. Do not
  freehand-edit `docs/library` (the live product context library)
  unless the plan explicitly owns a library migration.

Repository gates (mirrors `.github/workflows/ci.yml`): typecheck core
and cli, `bun test packages`, `bun test test/e2e`, and
`bun run build:viewer` when the viewer changes. A script node runs these
after implementation; plan work that passes them.

House comment style — plan for it now so implementation inherits it:
comments are plain English prose that explains WHY the code is shaped
this way, not what it does, and cites sources — issue numbers, dated
proposals, rulings — the way `packages/core/src/Todo.ts` does.

## Plan expectations

- Keep work scoped to the packages and surfaces named by the goal, with
  domain logic in core, deterministic CLI/server behavior in cli,
  browser UI state in viewer.
- Include tests for changed behavior, and risks, acceptance criteria,
  and deferred follow-ups.

End your response with `Plan ready for implementation: <plan-path>` and
a brief summary; the implement stage reads the plan file from disk.
