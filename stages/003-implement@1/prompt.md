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
Pipeline progress: 1 of 7 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Plan ready for implementation: docs/proposals/2026-08-04-current-publish-door-docs.md
  > 
  > --- BEGIN PLAN DOC ---
  > # Current Publish Door CLI Documentation
  > 
  > *Implementation plan — 2026-08-04. Run
  > `01KZ6RVCTHSGWQDJGKYPJEG922`; documents the publish door shipped in PR
  > #185 and v0.6.2.*
  > 
  > ## Status
  > 
  > Ready for implementation. This is a documentation correction for shipped
  > behavior, not a CLI, core, server, viewer, schema, or state-machine change.
  > 
  > ## Outcome
  > 
  > Rewrite the `skillmaker publish` reference page so the first workflow a
  > reader sees is the current install door:
  > 
  > ```sh
  > skillmaker publish <slug> --to user
  > skillmaker publish <slug> --to project
  > ```
  > 
  > The page will explain where each audience installs the selected version,
  > how the per-bundle audience memory makes later publishes a bare
  > `skillmaker publish <slug>`, how `--version` re-installs a recorded
  > snapshot, and what `--json` returns to agents. It will also make the
  > publish guard, provenance stamp, journal receipt, idempotent no-op, and
  > adopted in-place exception explicit.
  > 
  > The existing workspace-level `skillmaker.config.json.publishTargets`
  > workflow remains on the same page, below the install workflow and clearly
  > identified as the legacy/secondary configured-target door.
  > 
  > ## Source-of-truth contract
  > 
  > Implementation must derive prose and examples from the shipped code and
  > tests, chiefly:
  > 
  > - `packages/cli/src/commands/Publish.ts` for option handling, door
  >   selection, failures, and text/JSON result shapes.
  > - `packages/cli/src/Cli.ts` for the public option vocabulary.
  > - `packages/core/src/InstallPublish.ts` for audience resolution, snapshot
  >   selection, remembered audiences, installed content, evidence, stamps,
  >   journaling, and adopted in-place behavior.
  > - `packages/core/src/Publish.ts`, `packages/core/src/Machine.ts`, and
  >   `packages/core/src/Versions.ts` for publishability, transition guards,
  >   and hash-prefix behavior.
  > - `test/e2e/publish-door.e2e.test.ts`,
  >   `packages/core/test/InstallPublish.test.ts`, and
  >   `test/e2e/phase11.e2e.test.ts` for observable examples and both doors'
  >   idempotency contracts.
  > 
  > The documentation must preserve these distinctions:
  > 
  > | Concern | Shipped behavior to document |
  > |---|---|
  > | User audience | Installs the selected snapshot's `output/` contents at `$CLAUDE_CONFIG_DIR/skills/<slug>/` when that variable is set, otherwise `~/.claude/skills/<slug>/`. |
  > | Project audience | Installs at `<workspace>/.claude/skills/<slug>/`; there is no cross-project picker. |
  > | Installed payload | `output/SKILL.md` and all sibling files beneath `output/` are installed without the `output/` path segment. A changed Studio-born install replaces the destination tree, including stale siblings. |
  > | Audience memory | A successful explicit `--to` adds the symbolic audience to `bundle.json.publishTargets`. Audiences accumulate without duplicates, so a later bare publish goes to every remembered audience and each machine resolves the paths locally. |
  > | Door selection | `--to` or `--version` selects the install door. A remembered audience makes a bare publish select it too. With no memory and configured workspace targets, a bare publish falls back to the legacy door. Explicit `--target` selects the legacy door. |
  > | Latest publish guard | A plain install publish requires stage `published`, at least one recorded version, and live design/output content in sync with the latest version. Publish itself checks the resulting stage; the ordinary guarded transition into `published` requires the approved evaluating review and approved publish gate. |
  > | Recorded-version publish | `--version <hash-prefix>` selects a recorded snapshot and still requires stage `published`, but deliberately does not require the live tree to match that version. The snapshot must exist. Examples should use a full hash or a left-anchored prefix beginning with `sha256:` because matching is against the stored full hash. |
  > | Provenance stamp | A real Studio-born install puts an HTML comment in installed `SKILL.md`, immediately below YAML frontmatter when present and otherwise at the top. It names `skillmaker-studio`, the bundle, short version hash plus optional label, UTC date, and evidence such as `3 of 23 claims measured`; an index failure is reported honestly as `evidence unavailable`. Sibling files are not stamped. |
  > | Journal and no-op | A real install/revert appends one `skill.published` event per affected audience with bundle, version, target, path, and evidence. If identical stamped bytes are already installed and already receipted, the command reports `already_published`/`already installed` and does not write or append a duplicate event. Re-landing older bytes after another version occupied the target is a new, journaled act. |
  > | Adopted in place | For a bundle resolved as in-place, the live directory is the target, `--to` does not apply, no audience is remembered, and no provenance stamp is added because changing the live `SKILL.md` would manufacture output drift. `--version` restores snapshot payload files into that live directory. |
  > | Agent output | Install-door success JSON contains `status`, `slug`, `versionHash`, optional `versionLabel`, `evidence`, `stamped`, `remembered`, and `results` entries with `target`, `path`, and `status`. Install-door guard failures under `--json` use `{status:"rejected", slug, reason}` and exit 1. |
  > | Legacy door | `--target <id>` selects one workspace-configured target; without it, the legacy door publishes to all configured targets. `git-dir` copies `output/` to `<path>/<slug>/`; `claude-marketplace` maintains `.claude-plugin/marketplace.json` plus `.claude-plugin/MARKETPLACE.md`; `codex-marketplace` maintains `.codex-plugin/plugin.json` plus the best-effort `.agents/plugins/marketplace.json`. Their legacy JSON/text result shapes and per-target idempotency remain distinct from the install door. |
  > 
  > Do not repeat the goal text's absolute wording that every invocation writes
  > a stamp and event: the implementation intentionally makes same-content
  > re-publishes true no-ops. Likewise, do not say `--version` requires the
  > live tree to be in sync; it reads the recorded snapshot precisely so a
  > revert can work after the live output has moved on.
  > 
  > ## Scope and files
  > 
  > ### Authored source
  > 
  > - Rewrite
  >   `packages/docs-site/src/content/docs/cli/publish.md`.
  > 
  > Keep the change concentrated in this command reference. The linked
  > `packages/docs-site/src/content/docs/getting-started/first-bundle.md`
  > publish section is already the user-facing guided workflow and is a
  > read-only alignment reference for this task. The linked
  > `packages/docs-site/src/content/docs/concepts/publishing-and-the-skillbook.md`
  > remains the conceptual destination for the distinction between publishing
  > and building the Skillbook; this page must not defer current CLI syntax
  > back to that older conceptual treatment.
  > 
  > ### Generated output
  > 
  > `bun run build:docs` regenerates tracked files under
  > `packages/docs-site/dist/`, including the rendered publish page and
  > Pagefind index. Accept only the generated build diff; do not hand-edit
  > those files.
  > 
  > ### Explicitly out of scope
  > 
  > - No edits to `packages/core`, `packages/cli`, `packages/viewer`, server
  >   routes, schemas, tests, or fixtures.
  > - No change to publish behavior, option precedence, target formats,
  >   state-machine rules, snapshot storage, or journal semantics.
  > - No broad freshness sweep of the roadmap, CLI index, conceptual pages,
  >   or adoption guide.
  > - No edits under `docs/library`.
  > 
  > ## Page structure and implementation steps
  > 
  > 1. **Replace the legacy-only front door.** Update the description and
  >    opening synopsis to lead with the install forms:
  >    `--to user|project`, remembered bare publish, and
  >    `--version <hash-prefix>`. Show `--target <id>` separately as the
  >    configured-target form so readers do not combine the two doors.
  > 
  > 2. **Explain the two install audiences.** Add a compact table mapping
  >    `user` to the Claude config directory and `project` to the workspace's
  >    `.claude/skills/<slug>/`. State that the selected version's entire
  >    `output/` payload is installed and that the user location honors
  >    `CLAUDE_CONFIG_DIR`.
  > 
  > 3. **Make memory concrete.** Show a first explicit publish followed by a
  >    bare re-publish. Say that `bundle.json.publishTargets` stores symbolic
  >    per-bundle audiences, not machine-specific paths, and that selecting a
  >    second audience adds it; subsequent bare publishes address all
  >    remembered audiences. Include the no-memory refusal while noting the
  >    legacy fallback when workspace targets are configured.
  > 
  > 4. **Separate latest publish from revert.** Keep the guard section
  >    scannable but exact: plain publish uses the latest in-sync recorded
  >    version; `--version` reads a named recorded snapshot, skips the
  >    live-drift comparison, and is the CLI revert mechanism. Both require
  >    the bundle's folded stage to be `published`. Link the normal route into
  >    that stage to the state-machine page and link version/drift details to
  >    the existing version reference.
  > 
  > 5. **Show receipts without overstating them.** Include a short example of
  >    the provenance comment with its placement and fields. Explain the
  >    `N of M claims measured` derivation, honest unavailable fallback,
  >    per-real-act `skill.published` event, and same-content no-op. A concise
  >    text result and a verified install-door JSON result should expose the
  >    current field names, including `remembered`, `stamped`, and per-target
  >    `path`/`status`.
  > 
  > 6. **Call out the adopted exception.** Add a brief note that an in-place
  >    bundle's live payload is already the install target. `--to` is refused,
  >    plain publish/revert operates there, and the live `SKILL.md` is not
  >    stamped.
  > 
  > 7. **Retain the configured-target door as secondary.** Move the current
  >    workspace `publishTargets` configuration, target-kind table,
  >    `--target`, representative output, and legacy JSON shape under a
  >    heading that says this is the legacy/secondary distribution path.
  >    Re-verify and correct the existing target descriptions as they move:
  >    the Claude storefront is `.claude-plugin/MARKETPLACE.md`, never a root
  >    `README.md`, and the Codex target writes both currently implemented
  >    manifests while retaining its best-effort warning. Remove claims that
  >    this is the only or primary publish door. Correct the server route
  >    reference if it remains in the page: the current route is
  >    `POST /api/bundles/:slug/publish`.
  > 
  > 8. **Finish with coherent navigation.** In “See also,” link
  >    [Your first skill's Publish section](/getting-started/first-bundle/#9-publish)
  >    as the guided UI workflow and
  >    [Publishing and the Skillbook](/concepts/publishing-and-the-skillbook/)
  >    for the distinction between installing a skill and rendering workspace
  >    documentation. Keep the `book build`, state-machine, and
  >    versions/drift links near the claims they explain rather than collecting
  >    every link at the end.
  > 
  > 9. **Regenerate and inspect the site.** Build the docs, inspect the
  >    rendered publish page for the expected headings, examples, and links,
  >    and review the source and generated diff for accidental unrelated
  >    churn.
  > 
  > ## Voice and presentation
  > 
  > - Match the existing docs site's direct, plain-language voice: explain
  >   what the reader is trying to do before naming internal storage.
  > - Prefer two small syntax blocks, short tables, and compact examples over
  >   a long narrative or a single oversized options table.
  > - Use “install door” for the current audience workflow and
  >   “configured-target” or “legacy/secondary door” for the workspace config
  >   workflow. Always qualify which `publishTargets` is meant:
  >   `bundle.json.publishTargets` contains audience words, while
  >   `skillmaker.config.json.publishTargets` contains target objects.
  > - Describe externally visible behavior rather than implementation
  >   function names or PR history on the public page.
  > - Keep examples internally consistent around one slug and version, and
  >   derive JSON/text examples from the current renderers or tests rather
  >   than inventing fields.
  > 
  > ## Validation
  > 
  > Run from the repository root:
  > 
  > ```sh
  > bun run --filter @skillmaker/docs-site check
  > bun run build:docs
  > bun test packages
  > ```
  > 
  > Then:
  > 
  > - Confirm the docs check and static build complete without broken-content
  >   or rendering errors.
  > - Inspect `packages/docs-site/dist/cli/publish/index.html` to confirm the
  >   install door leads, both cross-links render, and the legacy section
  >   remains present.
  > - Confirm the rendered page includes `--to user|project`, remembered
  >   audiences, `--version`, `--json`, the provenance/evidence stamp,
  >   `skill.published`, stage `published`, and the in-place no-stamp rule.
  > - Confirm the source and generated page still document all three legacy
  >   configured target kinds and `--target`.
  > - Confirm `bun test packages` is green without any test-source changes.
  > - Review `git diff --check` and `git status --short`; expected authored
  >   changes are the proposal, `publish.md`, and build-generated docs output
  >   only.
  > 
  > Full CLI/e2e suites are not required for this prose-only change because no
  > runtime surface changes. Existing install-door and legacy publish tests
  > are the evidence used to write the page.
  > 
  > ## Risks and mitigations
  > 
  > ### The two `publishTargets` fields are easy to conflate
  > 
  > The per-bundle field is an array of `user`/`project` audience words; the
  > workspace field is an array of configured target objects. Always name the
  > owning file and put the workflows in separate sections.
  > 
  > ### A simplified guard description can make revert sound impossible
  > 
  > The latest-version path enforces live drift, while `--version` does not.
  > Give them separate paragraphs and tie the latter explicitly to snapshot
  > content.
  > 
  > ### “Every publish” can contradict idempotency
  > 
  > The stamp and journal describe real install acts, not a same-content
  > no-op. Use “real install or revert” where writes/events are discussed and
  > show `already_published` as the no-op result.
  > 
  > ### Adopted bundles have a CLI discovery limitation
  > 
  > The core and server honor the in-place contract when given the bundle's
  > actual directory, but the CLI command currently constructs
  > `<workspace>/<skillsDir>/<slug>` and therefore does not reliably discover
  > adopted bundles elsewhere. Document the resolved in-place behavior
  > without claiming broader CLI location discovery, and leave resolver
  > parity to a separate runtime fix.
  > 
  > ### The linked publishing concept page predates PR #185
  > 
  > Keep `publish.md` self-contained as the command authority and describe the
  > concept link narrowly as the publish-versus-Skillbook explanation. A
  > broader concept-page freshness pass is deferred rather than silently
  > expanding this focused correction.
  > 
  > ### Generated docs can create broad search-index churn
  > 
  > Use the pinned Bun workspace command, do not edit `dist` manually, and
  > separate expected Pagefind regeneration from unrelated source changes
  > during diff review.
  > 
  > ## Acceptance criteria
  > 
  > 1. `packages/docs-site/src/content/docs/cli/publish.md` leads with
  >    `skillmaker publish <slug> --to user|project` and accurately maps both
  >    audiences to their resolved install directories.
  > 2. The page explains per-bundle remembered audiences, their additive
  >    behavior, and the subsequent bare publish workflow without confusing
  >    them with workspace configuration.
  > 3. `--version <hash-prefix>` is documented as a recorded-snapshot
  >    publish/revert, including its stage requirement, snapshot requirement,
  >    and deliberate exemption from the plain publish live-drift check.
  > 4. `--json` documents the current install success fields and rejected
  >    guard shape for the agent layer.
  > 5. The page documents the provenance stamp's placement and fields,
  >    evidence line, real-act `skill.published` receipt, and no-op
  >    idempotency semantics exactly.
  > 6. The page states that normal publish requires stage `published` and
  >    links that stage to the guarded final review/publish-gate transition
  >    without implying that the publish command replays the transition
  >    guard.
  > 7. Adopted in-place behavior is explicit: live target, no `--to`, no
  >    remembered audience, and no stamp.
  > 8. Workspace-level `skillmaker.config.json.publishTargets`, all three
  >    existing target kinds, `--target`, and representative legacy output
  >    remain documented under a clearly secondary/legacy heading.
  > 9. Links to
  >    `/getting-started/first-bundle/#9-publish` and
  >    `/concepts/publishing-and-the-skillbook/` render and have descriptions
  >    consistent with their roles.
  > 10. `bun run --filter @skillmaker/docs-site check`,
  >     `bun run build:docs`, and `bun test packages` pass; package test files
  >     remain untouched.
  > 
  > ## Deferred follow-ups
  > 
  > - Resolve actual-directory discovery for adopted bundles in the CLI before
  >   making an unqualified claim that every externally located adopted bundle
  >   is publishable from the terminal.
  > - Refresh the publishing concept page and other older docs-site summaries
  >   that still present configured workspace targets as the sole door.
  > - Consider rejecting mixed `--target` with `--to`/`--version` as a usage
  >   error instead of relying on precedence; that is a CLI contract change,
  >   not documentation work.
  > - Consider normalizing bare hexadecimal version prefixes for `publish` to
  >   the behavior already offered by `version show`; until then examples
  >   should use the accepted `sha256:`-prefixed form.
  > --- END PLAN DOC ---


# Implement

Implement the Skillmaker Studio feature plan.

Before editing files:

- Read the plan under `docs/proposals/` named by the scope stage.
- Read package-local README and guidance files for every package or
  surface touched by the plan; treat that guidance as owning
  implementation workflow, tests, and validation for the touched package.

Work rules:

- Stay scoped to the plan, its named package boundaries, and directly
  necessary shared configuration.
- Do not freehand-edit `docs/library`; it is the live product context
  library. Only touch that path when the approved plan explicitly owns a
  library migration.
- Do not broaden the plan during implementation. If the planned slice
  cannot be implemented coherently without expanding scope, implement the
  smallest coherent planned slice if possible; otherwise leave a clear
  blocking note in the final response for review/human intervention. Do
  not turn the stage into plan-only work.
- Keep domain logic and schemas in `packages/core` (Effect-first, schema
  changes ripple from here). When changing `packages/cli`, keep command
  data on stdout and diagnostics on stderr, preserve stable exit codes,
  and add or update black-box tests for CLI behavior. When changing
  `packages/viewer`, keep browser UI state in viewer-owned
  components/helpers.
- Write comments in the house style: plain English prose that explains
  WHY the code is shaped this way (not what it does) and cites its
  sources — issue numbers, dated proposals, rulings — the way
  `packages/core/src/Todo.ts` does. New non-obvious decisions get a
  comment that names the plan or ruling that made them.
- If this stage is reached after a validation failure, inspect the
  validation output from the prior stage and fix the smallest relevant
  issue.

Full gates. Before finishing, run and pass ALL of:

```bash
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

AND, whenever the diff touches `packages/viewer`:

```bash
bun run build:viewer
```

Do not hand off with any gate failing or skipped; a script node reruns
the same gates right after this stage and a failure routes straight back
here.

Before finishing, inspect `git diff --stat` and summarize the implemented
changes.
