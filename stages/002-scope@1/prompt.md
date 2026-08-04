Goal: Update the docs-site page `packages/docs-site/src/content/docs/cli/publish.md` to document the CURRENT publish door, which shipped in PR #185 (v0.6.2).

Context: the page still documents only the legacy workspace-level `publishTargets` config door. The current primary door (see `packages/cli/src/commands/` publish command and `packages/core/src/InstallPublish.ts`) is:

- `skillmaker publish <slug> --to user|project` — installs output/SKILL.md (+ output/ siblings) to `~/.claude/skills/<slug>/` (user) or `<project>/.claude/skills/<slug>/` (project)
- The chosen audience is REMEMBERED per-bundle in bundle.json (`publishTargets`), so subsequent publishes are just `skillmaker publish <slug>`
- `--version <hash>` publishes a recorded version's snapshot (this is how revert works)
- `--json` for the agent layer
- Every publish writes a provenance comment into the installed SKILL.md (bundle, version short-hash, date, evidence line "N of M claims measured") and appends a `skill.published` journal event
- Publishing requires the bundle to have passed its final human gate (stage `published` reachable via the guarded transitions)
- Adopted in-place bundles keep their existing behavior (live file is the target; no stamp)

Acceptance criteria:
1. The page leads with the `--to user|project` door, documents the remembered audience, `--version`, `--json`, the stamp, and the stage-gate requirement — matching the implementation exactly (verify claims against the code, do not copy this goal text blindly).
2. The legacy workspace `publishTargets` config door remains documented, clearly marked as the legacy/secondary path.
3. Cross-links to `/concepts/publishing-and-the-skillbook/` and the getting-started first-bundle page's publish section stay coherent.
4. `bun run build:docs` passes; `bun test packages` untouched-green.
5. Match the docs site's existing voice; keep the page scannable.

Run ID: 01KZ6RVCTHSGWQDJGKYPJEG922
Pipeline progress: 0 of 7 stages completed


# Scope

Create or refine a durable technical implementation plan for the requested
Skillmaker Studio feature. Do not edit implementation files in this stage.

## The repository

Skillmaker Studio is a bun + Effect TypeScript monorepo (bun workspaces,
`packageManager: bun@…` pinned in the root `package.json`):

- `packages/core` — the domain engine: skills, evals, journal, todos,
  triage. Effect-first; schemas live here and everything else consumes
  them.
- `packages/cli` — the `skillmaker` CLI and the local server the Studio
  UI rides on. Command execution is modeled as Effect programs; command
  data goes on stdout, diagnostics on stderr, exit codes are stable.
- `packages/viewer` — the Studio browser UI (Astro + React).
- `packages/desktop`, `packages/docs-site`, `packages/marketing-site`,
  `packages/skill` — desktop shell, sites, and the packaged
  `/skillmaker` agent skill. Touch these only when the goal names them.
- `test/e2e` — black-box end-to-end tests over the CLI and server
  surfaces (`bun test test/e2e`).
- `docs/` — plans and design docs; `docs/proposals/` holds dated
  proposal/plan documents.

Repository gates (mirrors `.github/workflows/ci.yml`): typecheck core and
cli, `bun test packages`, `bun test test/e2e`, and `bun run build:viewer`.
A later script node runs all of these; plan work that can pass them.

House comment style — plan for it now so implementation inherits it:
comments are plain English prose that explains WHY the code is shaped the
way it is, not what it does, and cites its sources — issue numbers,
dated proposals, and rulings (e.g. "ruling R2, 2026-07-17 data-model
reconciliation") — the way `packages/core/src/Todo.ts` does.

## Planning rules

- Read and obey the root `README.md`, `docs/README.md`, and any
  package-local README or guidance files for packages named by the goal.
- Write the plan to `docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md`
  (the house pattern for dated proposals). If a relevant plan already
  exists there, refine it instead of creating a duplicate.
- Keep work scoped to the packages and surfaces named by the goal.
- Keep domain logic and schemas in `packages/core`; keep deterministic
  CLI/server behavior in `packages/cli`; keep browser UI state in
  `packages/viewer`.
- Do not freehand-edit `docs/library`; it is the live product context
  library. Only touch that path when the approved plan explicitly owns a
  library migration.
- Use Effect patterns already present in the touched packages.
- Include black-box tests for CLI behavior, exit codes, and important
  output fields when the CLI changes (unit tests in the package,
  end-to-end coverage in `test/e2e` when the server surface changes).
- Include viewer build validation (`bun run build:viewer`) when viewer
  behavior changes.
- Include risks, mitigations, acceptance criteria, and deferred
  follow-ups.

## Implementation handoff output

- After writing or refining the plan, read the plan file back from disk.
- Your final response is what the implementation stage receives. It must
  show the real plan document, not a summary.
- Start with `Plan ready for implementation: <plan-path>`.
- Then paste the complete Markdown contents of the plan file between these
  exact markers:

```text
--- BEGIN PLAN DOC ---
<complete contents of docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md>
--- END PLAN DOC ---
```

- Do not summarize, paraphrase, omit sections, or replace the plan with a
  status report.
- If the plan has risks or open questions that need attention before
  implementation, they must be present in the plan document itself.
