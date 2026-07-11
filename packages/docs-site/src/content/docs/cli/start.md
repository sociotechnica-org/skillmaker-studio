---
title: skillmaker start
description: Serve the viewer + API on one origin.
---

```text
skillmaker start [--port <n>] [--no-open]
```

Serves the board and its API from a single `Bun.serve` process on one
origin: the statically built viewer (`packages/viewer/dist/` in a repo
checkout, or `viewer-dist/` beside the compiled binary — see
[Install from source](/getting-started/install/)) plus `/api/*`, with SPA
fallback for client-side routes and no CORS (there's nothing to be CORS
about — it's all one origin).

## Options

| Flag | Meaning |
|---|---|
| `--port <n>` | Port to serve on; overrides `skillmaker.config.json`'s `viewer.port` (default `4323`) |
| `--no-open` | Do not open a browser on startup |

## Live updates

The board holds a Server-Sent Events (SSE) connection watching
`.skillmaker/events.jsonl`; any journal-appending command run elsewhere
(another terminal's `skillmaker new`, `advance`, `todo add`, …) is reflected
on the open board without a reload.

## Single-instance discipline

`skillmaker start` writes a claim file under `.skillmaker/claims/` so two
`start` processes can't silently fight over the same workspace; a stale
claim (dead PID) is detected and replaced, and the claim is removed
cleanly on `SIGTERM`.

## Requirements

The viewer must be built once before `start` will find anything to serve:

```sh
bun run build:viewer   # from the repo root, once (or after viewer changes)
```

## See also

[Your first Skill Bundle](/getting-started/first-bundle/) walks through
opening the board and confirming the API is live with `curl`.
