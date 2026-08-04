---
type: Reference
prefLabel: Publish Target
context: outputs
status: new
links:
  related_to:
    - "./Mechanism - Publish"
    - "./Mechanism - Provenance Stamp"
    - "./Entity - Bundle Output"
---

## WHAT

A publish target is one entry in `skillmaker.config.json`'s
`publishTargets` array — a configured destination a bundle's `output/`
can ship to: `{ id, kind, path? }`. There is no fixed, single
destination; the array is a pluggable list, and `skillmaker publish`
ships to all of them by default or to a specific `--target <id>`.

## WHY

The old model's "banking" had one implicit destination (the plugin) with
no configuration surface at all. The new model needed a real answer for
"where does a finished skill go" once there could be more than one
answer — a local git checkout for personal use, a Claude Code
marketplace listing, a Codex marketplace listing, all at once if wanted.
Making it a config array rather than a hardcoded path is what lets
`skillmaker publish` be the same command regardless of how many places a
given workspace ships to.

## HOW

Schema (`PublishTarget` class, `packages/core/src/Workspace.ts`):
`{ id: string, kind: string, path?: string }`. `path` is required for
`git-dir` (the destination directory `output/` is copied into, as
`<path>/<slug>/`) and optional for the marketplace kinds (defaults to
the workspace root, since their manifests live at fixed well-known
paths).

Three kinds are actually implemented in `packages/core/src/Publish.ts`
(`publishToTarget`'s switch) — more than data-model.md §2.2's single
`git-dir` example shows:

- `git-dir` — `cp -r`-style copy of `output/` to `<path>/<bundle>/`
  (`publishGitDir`).
- `claude-marketplace` — emits/updates
  `<path or root>/.claude-plugin/marketplace.json`: one skills-only
  plugin entry accumulating every published bundle's output path,
  preserving any unknown existing fields on disk (`publishClaudeMarketplace`).
- `codex-marketplace` — emits/updates
  `<path or root>/.codex-plugin/plugin.json` plus
  `<path or root>/.agents/plugins/marketplace.json`, same
  accumulate-and-preserve approach, explicitly flagged in the source
  comment as "a best-effort, lossless-round-trip guess" since Codex's
  registration schema isn't fully documented upstream
  (`publishCodexMarketplace`).

Example shape from data-model.md §2.2 (illustrative — see verification
note below):

```jsonc
{
  "publishTargets": [
    { "id": "dist", "kind": "git-dir", "path": "dist/skills" }
  ]
}
```

Verified against the real file (re-checked 2026-08-03): this repo's own
`skillmaker.config.json` now carries two live targets —
`{ "id": "dist-skills", "kind": "git-dir", "path": "dist/skills" }` and
`{ "id": "claude-marketplace", "kind": "claude-marketplace" }` — an
earlier revision of this card honestly noted the array was empty; it no
longer is. Also verified `PublishTarget`'s
schema class directly in `packages/core/src/Workspace.ts`
(`id: Schema.String, kind: Schema.String, path: Schema.optionalKey(Schema.String)`)
— `kind` is an open string, not a closed enum, consistent with the code
supporting more kinds than the doc enumerates.

## IN FLIGHT (PR #185): TWO-AUDIENCE INSTALL TARGETS

The publish-door build (director rulings 2026-08-03, from the E2E walk's
"Publish step has no UI" blocker — `docs/friction/e2e-readiness.md`) adds
a second, per-bundle notion of target alongside this workspace-level
array: exactly two symbolic **audiences**, `"user"` (that machine's
`~/.claude/skills/<slug>/`) and `"project"` (the workspace's
`.claude/skills/<slug>/`), remembered per-bundle in `bundle.json`'s own
`publishTargets` field so the choice travels with the bundle and resolves
locally on whatever machine it lands on. The workspace-level array
described above is untouched and stays reachable via `--target` — the
legacy door. See [[Mechanism - Provenance Stamp]] for the stamp the new
door writes. Not merged as of this writing — treat as in flight, not
shipped.
