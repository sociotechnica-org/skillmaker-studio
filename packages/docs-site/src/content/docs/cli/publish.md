---
title: skillmaker publish
description: Install a recorded skill version for your agents, or publish to a legacy configured target.
---

```text
skillmaker publish <slug> --to user|project
skillmaker publish <slug> [--version <hash-prefix>]

# Legacy configured-target door:
skillmaker publish <slug> [--target <id>]
```

Use the install door to put a published Skill Bundle where Claude Code can
read it. Choose an audience the first time; Skillmaker remembers that choice
with the bundle, so later publishes are simply `skillmaker publish <slug>`.

The configured-target door below is the older, secondary path for workspace
mirrors and marketplaces. Its `publishTargets` configuration is separate from
the remembered install audiences.

## Install for an audience

Start by choosing who should receive the skill:

```sh
skillmaker publish my-first-skill --to user
skillmaker publish my-first-skill --to project
```

| Audience | Installed location |
|---|---|
| `user` | `$CLAUDE_CONFIG_DIR/skills/<slug>/` when `CLAUDE_CONFIG_DIR` is set; otherwise `~/.claude/skills/<slug>/`. |
| `project` | `<workspace>/.claude/skills/<slug>/`. |

The selected recorded version's whole `output/` payload is installed: its
`SKILL.md` and every sibling file, without the `output/` directory in the
destination path. A changed install replaces the destination payload,
including siblings that no longer belong to the version.

### Remembered audiences

A successful `--to` adds the audience word to that bundle's
`bundle.json.publishTargets`. These are portable symbolic choices (`user` and
`project`), not paths from the machine where the bundle was created. Choosing
the second audience adds it; a later bare publish addresses every remembered
audience and resolves each path on the current machine.

```sh
skillmaker publish my-first-skill --to user
# Later, after recording and approving an improved version:
skillmaker publish my-first-skill
```

With no remembered audience, the install door asks you to choose `--to user`
or `--to project`. A bare publish instead falls through to the legacy door
when the workspace has configured legacy targets. `--target` explicitly
selects that legacy door.

## Versions, gates, and revert

A normal install publish uses the latest recorded version. The bundle must
already be at stage `published`, must have a recorded version, and its live
`design.md` and `output/` must be in sync with that version. The normal
guarded move into `published` requires both the approved evaluating review
and approved publish gate; see [the production state machine](/concepts/state-machine/).
For why live changes need a new version, see
[Versions and drift](/concepts/versions-and-drift/).

To install an older recorded snapshot, use its full hash or a left-anchored
`sha256:` hash prefix:

```sh
skillmaker publish my-first-skill --version sha256:4f53cda18c2b
```

This is the CLI revert: it installs the snapshot's payload and does not
compare the live tree with that older version. The named version and its
snapshot must exist, and the bundle must still be at stage `published`.

## Receipts on installed skills

Each real Studio-born install or revert writes a provenance comment into the
installed `SKILL.md`. It sits immediately below YAML frontmatter when the
file has it, otherwise at the top; sibling files are not stamped.

```html
<!-- published by skillmaker-studio
bundle: my-first-skill
version: sha256:4f53cda18c2b... (v1)
date: 2026-08-04
evidence: 3 of 23 claims measured -->
```

The evidence line is derived from measurements recorded for that version. If
the evidence index cannot be read, the stamp says `evidence unavailable`
rather than inventing a number. A real install also appends one
`skill.published` journal event for each affected audience, with the bundle,
version, target, path, and evidence.

Publishing identical stamped content that has already been receipted is a
true no-op: it reports `already installed`, does not rewrite the destination,
and does not append another event. Reinstalling an older snapshot after a
different version occupied the destination is a new, receipted act.

Text output from an install looks like:

```text
skillmaker: my-first-skill sha256:4f53cda18c2b... (v1) published -- 3 of 23 claims measured
  user: installed -> /home/me/.claude/skills/my-first-skill
```

Use `--json` for an agent-facing result:

```json
{"status":"published","slug":"my-first-skill","versionHash":"sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","versionLabel":"v1","evidence":"3 of 23 claims measured","stamped":true,"remembered":["user"],"results":[{"target":"user","path":"/home/me/.claude/skills/my-first-skill","status":"published"}]}
```

Guard and target-choice failures with `--json` return
`{"status":"rejected","slug":"my-first-skill","reason":"..."}` and exit
non-zero.

### Adopted in-place bundles

An adopted bundle that resolves in place already lives at its install target.
Its live directory is published or restored directly; `--to` does not apply,
no audience is remembered, and its live `SKILL.md` is not stamped. This keeps
the bundle's live content from drifting merely because it was published.

## Legacy/secondary configured-target door

The workspace-level configured-target door remains available for distribution
repositories and marketplaces. Configure target objects in
`skillmaker.config.json` — distinct from the audience words in
`bundle.json.publishTargets`:

```jsonc
{
  "publishTargets": [
    { "id": "local-mirror", "kind": "git-dir", "path": "/path/to/mirror" }
  ]
}
```

With configured targets, `skillmaker publish <slug>` publishes to all of
them unless the bundle has remembered install audiences. Use `--target <id>`
to select one target explicitly.

| Kind | What it does |
|---|---|
| `git-dir` | Copies the bundle's `output/` to `<path>/<slug>/`. `path` is required. |
| `claude-marketplace` | Updates `.claude-plugin/marketplace.json` and the generated storefront `.claude-plugin/MARKETPLACE.md`. `path` defaults to the workspace root. |
| `codex-marketplace` | Updates `.codex-plugin/plugin.json` and, best-effort, `.agents/plugins/marketplace.json`. `path` defaults to the workspace root. The marketplace shape is a best-effort integration because Codex has no published marketplace specification. |

```sh
skillmaker publish my-first-skill --target local-mirror
```

Legacy text output:

```text
skillmaker: my-first-skill publish results for version sha256:4f53cda18c2b...
  local-mirror (git-dir): published -> /path/to/mirror/my-first-skill
```

Its `--json` result retains the legacy per-target shape:

```json
{"status":"published","slug":"my-first-skill","versionHash":"sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","results":[{"target":"local-mirror","kind":"git-dir","status":"published","url":"/path/to/mirror/my-first-skill"}]}
```

Legacy publishing has the same `published`, recorded-version, and in-sync
guard as a normal install publish. Its target results are idempotent:
republishing an already-current target reports `already published`.

## See also

[Your first skill's Publish section](/getting-started/first-bundle/#9-publish)
— the guided publishing workflow. [Publishing and the Skillbook](/concepts/publishing-and-the-skillbook/)
— why installing a skill and rendering workspace documentation are different
jobs. [`book build`](/cli/book-build/) renders the Skillbook.
