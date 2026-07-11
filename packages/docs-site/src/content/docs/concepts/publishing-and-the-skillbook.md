---
title: Publishing and the skillbook
description: How a Skill Bundle leaves the studio with receipts attached.
---

Two different things happen when a skill is "done": it goes **out** to
wherever it's meant to be installed from (`publish`), and it gets
**documented** alongside every other skill in the workspace (`book build`).
Skillmaker Studio keeps these separate — one bundle, two outputs — rather
than folding "shipped" and "documented" into one step.

## Publish: one contract, two doors

`skillmaker publish <slug>` and the viewer's guided publish flow
(`POST /api/bundles/:slug/publish`) both call the same
`@skillmaker/core` `publishBundle` function. Same guards, same targets,
same results, whichever door you use.

### The guard

Publishing requires two things to already be true:

1. **The bundle is at stage `published`.** Reaching it requires an
   approved `bundle.gate_decided` event with gate `"publish"` — a
   dedicated publish gate on top of the approved review every other stage
   transition already requires. See
   [The production state machine](/concepts/state-machine/).
2. **Drift status is `in-sync`.** The last recorded version's hash must
   match the current `design.md` + `output/` hashes — no publishing a
   version that doesn't match what's on disk. See
   [Versions and drift](/concepts/versions-and-drift/).

If either isn't true, `publish` refuses with a message naming which guard
failed, rather than publishing a partial or stale result.

### Targets

Publish targets are configured once per workspace, in
`skillmaker.config.json`'s `publishTargets` array — not per bundle. Each
target has an `id`, a `kind`, and an optional `path`:

```jsonc
{
  "publishTargets": [
    { "id": "mirror", "kind": "git-dir", "path": "/path/to/mirror" },
    { "id": "claude-mp", "kind": "claude-marketplace" },
    { "id": "codex-mp", "kind": "codex-marketplace" }
  ]
}
```

| Kind | What it does |
|---|---|
| `git-dir` | Copies the bundle's `output/` to `<path>/<slug>/`. `path` is required — this target has no default location. |
| `claude-marketplace` | Writes/updates a Claude-format marketplace manifest, lossless round-tripped (unknown fields are preserved, not dropped). `path` defaults to the workspace root. |
| `codex-marketplace` | Writes/updates a Codex-format marketplace manifest. `path` defaults to the workspace root. |

`skillmaker publish <slug>` publishes to every configured target by
default; `--target <id>` narrows to one. Each target result is
**idempotent** — republishing an already-current version reports
`already published` for that target instead of writing again, and each
publish per target journals at most one `skill.published` event.

### The dual-marketplace honesty note

Both `claude-marketplace` and `codex-marketplace` exist and are exercised
in the test suite, but they are not equally solid ground. The
**Claude marketplace manifest shape is a known, documented format** the
target round-trips losslessly. The **Codex marketplace manifest shape is
best-effort**: there is no published spec for it to conform to, so the
target writes our current best guess at the shape Codex expects, flagged
in-code as a documented spec gap rather than a verified integration.
Treat `codex-marketplace` as "will probably work, unproven against a real
Codex marketplace consumer" — not the same confidence level as the Claude
target.

## The skillbook: one generator, rendered two ways

`skillmaker book build` renders the **Skillbook** — auto-generated
documentation for a workspace's entire skill set — to a self-contained
static site: one `index.html` plus one page per bundle, written to
`.skillmaker/skillbook/` by default (a build artifact, not git-tracked).
The same `loadSkillbook` aggregation function backs the server's
`GET /api/skillbook` endpoint and the viewer's `/skillbook` route, so the
CLI-built site and the live viewer page never disagree on facts.

A bundle's skillbook page pulls together:

- **Design prose** from `design.md` — the workflow thinking, not just the
  shipped `SKILL.md`.
- **Measurement receipts** — *n · pass rate · confidence interval* per
  fixture, always pinned to the version they were measured against, never
  pooled across versions, providers, or models. See
  [Grading and measurements](/evals/grading-and-measurements/).
- **The recorded version hash.**
- **A changelog**, replayed straight from the journal — no separate
  changelog file to keep in sync by hand.

`book build` works at any stage, not just `published` — a bundle still at
`idea` gets a page too, so the skillbook always reflects the whole
workspace, not just what's shipped.

## Why these are two commands, not one

Publishing is about *leaving* — moving `output/` (or a manifest pointing
at it) somewhere outside the studio. The skillbook is about *staying* —
documenting everything in the workspace, published or not, as one
browsable set. A bundle can appear in the skillbook long before it's ever
published, and publishing doesn't imply rebuilding the skillbook (or vice
versa) — they're two independent commands you run when each is true.

## See also

[`skillmaker publish`](/cli/publish/) and [`skillmaker book build`](/cli/book-build/)
for exact flags and real captured output.
