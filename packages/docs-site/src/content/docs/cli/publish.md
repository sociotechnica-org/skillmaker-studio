---
title: skillmaker publish
description: Publish a Skill Bundle to its configured publish targets.
---

```text
skillmaker publish <slug> [--target <id>]
```

Publishes a Skill Bundle to the targets configured for it in
`skillmaker.config.json`'s `publishTargets` — the same `publishBundle`
function the server's `POST /api/bundles/:slug/publish` route runs (one
contract, two doors: the CLI and the viewer's guided publish flow produce
identical results). Requires a workspace and at least one configured
target; fails with a clear message if either is missing.

## Publish targets

Configured once per workspace, in `skillmaker.config.json`:

```jsonc
{
  "publishTargets": [
    { "id": "local-mirror", "kind": "git-dir", "path": "/path/to/mirror" }
  ]
}
```

| Kind | What it does |
|---|---|
| `git-dir` | Copies the bundle's `output/` to `<path>/<slug>/`. `path` is required. |
| `claude-marketplace` | Writes/updates a Claude-format marketplace manifest **and** a storefront `README.md` at the target root. `path` defaults to the workspace root. Each published bundle gets its own plugin entry carrying the bundle's `oneLiner`, `tags`, and recorded version label (falling back to a short hash) — not a bare, anonymous accumulator. The README is regenerated in full on every publish: one section per skill with its oneLiner, version, and per-provider measurement receipts (n · pass rate · CI) — the numbers that make the marketplace repo an actual storefront, not just an install target. |
| `codex-marketplace` | Writes/updates a Codex-format marketplace manifest. `path` defaults to the workspace root. **The Codex marketplace manifest shape is best-effort** — there is no published spec to conform to yet, so this target is documented honestly as "our best guess," not a verified integration. |

## Options

| Flag | Meaning |
|---|---|
| `--target <id>` | Publish to one configured target instead of all of them |
| `--json` | Emit `{status, slug, versionHash, results}` instead of text |

## Guards

`publish` refuses unless the bundle is at stage `published` **and** its
drift status is `in-sync` (the recorded version matches the current
`design.md` + `output/` hashes) — see
[Versions and drift](/concepts/versions-and-drift/). Reaching `published`
itself requires an approved `bundle.gate_decided` publish gate, on top of
the approved review every stage transition already requires; see
[The production state machine](/concepts/state-machine/).

Publishing is **idempotent per target**: republishing an already-current
version reports `already published` rather than writing again.

## Output

Real output from a `git-dir` target, first publish:

```text
skillmaker: my-first-skill publish results for version sha256:4f53cda18c2b...
  local-mirror (git-dir): published -> /path/to/mirror/my-first-skill
```

Republishing the same version:

```text
skillmaker: my-first-skill publish results for version sha256:4f53cda18c2b...
  local-mirror (git-dir): already published -> /path/to/mirror/my-first-skill
```

`--json`:

```json
{"status":"published","slug":"my-first-skill","versionHash":"sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","results":[{"target":"local-mirror","kind":"git-dir","status":"already_published","url":"/path/to/mirror/my-first-skill"}]}
```

No configured targets:

```text
skillmaker publish: no publishTargets configured in skillmaker.config.json -- nothing to publish to
```

## See also

[Publishing and the skillbook](/concepts/publishing-and-the-skillbook/) —
targets, guards, and dual marketplaces explained. [`book build`](/cli/book-build/)
renders the skillbook — the other half of "leaving the studio with receipts."
