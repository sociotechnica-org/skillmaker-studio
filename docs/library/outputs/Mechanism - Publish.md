---
type: Mechanism
prefLabel: Publish
context: outputs
status: migrated
links:
  contains:
    - "./Reference - Publish Target"
    - "./Mechanism - Provenance Stamp"
  related_to:
    - "./Entity - Skill Version"
    - "./Mechanism - Drift Hint"
    - "./Entity - Bundle Output"
    - "../production/Mechanism - Guarded Transition"
---

## WHAT

Publishing ships a bundle's `output/` to every configured publish target
(or a selected subset) and appends one `skill.published` journal event
per target. It is the rename target of the old model's **Capability -
Output Bank** (`runs/Capability/Capability - Output Bank.md`, read
directly since this card is its rename destination) — "banked" becomes
"published," `skill.published` replaces whatever event the old bank step
recorded, and "deliverable to library/state" becomes "deliverable to a
publish target."

## WHY

The old model's "banking" had exactly one implicit destination — the
plugin — via `bank.sh`. The new model has no single implicit
destination at all: a bundle can ship to zero, one, or several
configured `publishTargets` (see `Reference - Publish Target`), and
publishing is a first-class gated action rather than an end-of-ladder
side effect.

This card also resolves the other half of the old "bank polysemy" hot
spot (prep doc §3.6): the old model had two "bank" concepts — Output
Bank (deliver the finished play) and **Capability - Package Bank**
(`bank.sh`'s studio→plugin *code-deploy* step, `runs/Capability/Capability
- Package Bank.md`). Package Bank has **no successor** in the new model
— there is no separate code-deploy step distinct from publishing itself;
publish targets (including the `claude-marketplace`/`codex-marketplace`
kinds, which write plugin manifests directly) are the whole deploy
story. Reporting this RETIRE is adjacent to the `runs/` worker's own
assignment (Package Bank's source card lives in their directory and they
will not write a card for it), but it belongs here because this Publish
card is the artifact that actually absorbs and closes out that half of
the polysemy.

## HOW

Two doors behind one command (`packages/cli/src/commands/Publish.ts`,
`runPublish`):

**The install door** (`packages/core/src/InstallPublish.ts`,
`publishToInstallTargets` — the primary door): `skillmaker publish
<slug> --to user|project [--version <hash>]` writes the selected
version's `output/` to an install target an agent actually reads —
`user` → `~/.claude/skills/<slug>/` ("all my agents", honoring
`$CLAUDE_CONFIG_DIR`), `project` → `<workspace-root>/.claude/skills/
<slug>/` ("this project's agents"). Exactly two audiences, no picker
beyond them. The chosen audience is REMEMBERED per-bundle in
`bundle.json`'s `publishTargets` field, so a later bare `skillmaker
publish <slug>` re-publishes to the remembered target(s); `--version
<hash>` is a revert-shaped publish from the version snapshot store
(`.skillmaker/versions/<hash>/`), which deliberately skips the
live-drift check. A plain publish keeps the full `checkPublishable`
guard (stage `"published"`, latest version recorded, live content
in-sync). Each real write appends `skill.published` carrying version
hash, target, and the bundle's `evidence` state, and stamps a
provenance comment atop the installed `SKILL.md` (below YAML
frontmatter — [[Mechanism - Provenance Stamp]]); a same-content
re-publish writes nothing and journals nothing.

D4c carve-out: ADOPTED in-place bundles publish to their own live
directory (target kind `"in-place"`; `--to` is rejected for them) and
get NO provenance stamp — their `SKILL.md` is simultaneously the
bundle's own recorded content, and stamping it would register as output
drift against the very version just published. Their `bundle.json`
memory is also left alone (the layout itself is the memory).

One core function, three doors: the CLI, the server's
`POST /api/bundles/:slug/publish`, and the viewer's Publish tab's live
Publish/Revert buttons.

**The legacy targets door** (`publishBundle` in
`packages/core/src/Publish.ts`): `skillmaker publish <slug> --target
<id>` (or a bare publish in a workspace with configured
`publishTargets` and no remembered install audience) runs the
workspace-level targets from `skillmaker.config.json`, unchanged —
copies/writes per `target.kind` (see `Reference - Publish Target`),
then appends `skill.published` with `idempotencyKey:
"skill.published:<bundle>:<versionHash>:<target.id>"`. Three target
kinds ship (`git-dir`/`claude-marketplace`/`codex-marketplace`),
materially more than data-model.md §2.2's single `git-dir` example.

Verified: `packages/core/src/InstallPublish.ts`
(`publishToInstallTargets`, `resolveInstallDir`,
`rememberInstallTargets`/`readRememberedInstallTargets`, the in-place
branch with `stamped: false`), `packages/core/src/Publish.ts`
(`checkPublishable`, `publishBundle`), and
`packages/cli/src/commands/Publish.ts` (`runPublish` door selection: an
explicit `--target` means the legacy door; `--to`/`--version`/a
remembered audience mean the install door).

## SHIPPED (PRs #185/#193): THE PUBLISH DOOR

The E2E walk flagged "Publish step has no UI" as a blocker
(`docs/friction/e2e-readiness.md`); the director ruled the fix
2026-08-03 and PRs #185/#193 shipped it — the two-audience install door
described in HOW above, including the viewer Publish tab's now-live
Publish/Revert buttons, the `evidence` field on `skill.published`, and
snapshot-store revert. The Publish tab buttons are no longer disabled.
