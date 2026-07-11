---
title: skillmaker book build
description: Render the Skillbook to a self-contained static site.
---

```text
skillmaker book build [--out <dir>]
```

Renders the **Skillbook** — generated documentation for a workspace's whole
skill set — to a self-contained static site: one `index.html` plus one page
per bundle. Uses the same `loadSkillbook` data aggregation the server's
`GET /api/skillbook` endpoint uses (one generator over existing facts,
rendered two ways), so the CLI build and the viewer's `/skillbook` route
never disagree. Requires an existing workspace; works at any stage — a
bundle still at `idea` gets a page too.

## What a bundle's page contains

- Design prose from `design.md`.
- Measurement receipts — *n · pass rate · confidence interval* per fixture,
  pinned to the version they were measured against (never pooled across
  versions or providers; see
  [Grading and measurements](/evals/grading-and-measurements/)).
- The recorded version hash.
- A changelog replayed from the journal.

## Options

| Flag | Meaning |
|---|---|
| `--out <dir>` | Output directory. Defaults to `.skillmaker/skillbook/` — a build artifact, not git-tracked. |
| `--json` | Emit `{status, outDir, pages}` instead of text |

## Output

```text
skillmaker: built skillbook (1 skill(s), 2 page(s)) at /path/to/workspace/.skillmaker/skillbook
```

`--json`:

```json
{"status":"built","outDir":"/path/to/workspace/.skillmaker/skillbook","pages":2}
```

Page count is bundles + 1 (the index page).

## See also

[Publishing and the skillbook](/concepts/publishing-and-the-skillbook/) —
what the skillbook is for and how it relates to `publish`.
[`publish`](/cli/publish/) sends a bundle's `output/` to the outside world;
`book build` documents the whole set from the inside.
