---
type: Mechanism
prefLabel: Publish
context: outputs
status: migrated
links:
  contains:
    - "./Reference - Publish Target"
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

Guard (`checkPublishable` in `packages/core/src/Publish.ts`): a bundle
must be at journal-folded stage `"published"` (reached only via an
approved publish-gate decision, `bundle.gate_decided`), *and* must have
at least one recorded `skill.version_recorded` version whose drift
(`computeDrift`, see `Mechanism - Drift Hint`) against the live
`design.md`/`output/` content is exactly `"in-sync"` — otherwise
`PublishGuardError` fails the publish with a reason string ("has never
had a version recorded" / "content has drifted... record a new version
before publishing").

`publishBundle` then, for each selected target (`skillmaker publish
<slug> [--target <id>]`, default: every configured target):
copies/writes per `target.kind` (see `Reference - Publish Target`), then
appends `skill.published` with
`idempotencyKey: "skill.published:<bundle>:<versionHash>:<target.id>"` —
re-publishing the same version to the same target is a journal no-op
(status `already_published`), though the underlying file writes still
run because git-dir copies and manifest merges are themselves
idempotent.

Verified: `packages/core/src/Publish.ts` (`checkPublishable`,
`publishBundle`, `publishToTarget`) and
`packages/cli/src/commands/Publish.ts` (`runPublish` — CLI entry,
rejects if `publishTargets` is empty before even attempting the guard).
The shipped code implements three target kinds
(`git-dir`/`claude-marketplace`/`codex-marketplace`), materially more
than data-model.md §2.2's single `git-dir` example — a real extension
beyond the doc, described in `Reference - Publish Target` rather than
silently treated as the doc's ground truth.
