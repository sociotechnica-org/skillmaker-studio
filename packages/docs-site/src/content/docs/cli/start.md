---
title: skillmaker start
description: Serve the viewer + API for every registered project, on one origin.
---

```text
skillmaker start [--port <n>] [--no-open]
```

Serves the viewer and its API from a single `Bun.serve` process on one
origin: the statically built viewer (`packages/viewer/dist/` in a repo
checkout, or `viewer-dist/` beside the compiled binary — see
[Install](/getting-started/install/)) plus `/api/*`, with SPA fallback for
client-side routes and no CORS (there's nothing to be CORS about — it's
all one origin).

`start` serves the **machine-level project registry** and ignores the
current directory entirely: it reads the project list from
`~/.skillmaker-studio/config.json` (`SKILLMAKER_STUDIO_HOME` overrides the
home) and serves every registered project at
`/api/projects/:project/...`. Run it from anywhere; add projects with
[`skillmaker project add <path>`](/cli/project/) or from the viewer's
sidebar (**New project**). An empty registry starts fine:

```text
skillmaker: serving 0 registered projects at http://localhost:4323
skillmaker: registry is empty -- add one with `skillmaker project add <dir>` or from the UI
```

## Options

| Flag | Meaning |
|---|---|
| `--port <n>` | Port to serve on (default `4323`) |
| `--no-open` | Do not open a browser on startup |

## Live updates

The viewer holds one machine-level Server-Sent Events (SSE) connection;
each registered project's `.skillmaker/events.jsonl` is watched behind it,
with journal messages tagged by project slug. Any journal-appending command
run elsewhere (another terminal's `skillmaker new`, `advance`, `todo add`,
…) is reflected on the open viewer without a reload. Registry changes are
picked up live too — adding or removing a project (via CLI or UI) needs no
server restart.

## Single-instance discipline

`skillmaker start` writes a claim file at
`~/.skillmaker-studio/claims/server.json` — one per machine, since one
server serves every registered project — so two `start` processes can't
silently fight. A stale claim (dead PID) is detected and replaced, and the
claim is removed cleanly on shutdown; if a server is already running,
`start` just reports its URL.

## Requirements

The viewer must be built once before `start` will find anything to serve
(from-source installs only — prebuilt installs ship it):

```sh
bun run build:viewer   # from the repo root, once (or after viewer changes)
```

## See also

[`skillmaker project`](/cli/project/) manages the registry `start` serves.
[Your first skill](/getting-started/first-bundle/) is the guided tour
that begins at `skillmaker start`.
