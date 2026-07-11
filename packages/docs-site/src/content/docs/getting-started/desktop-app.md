---
title: Desktop app
description: A double-clickable macOS shell around the compiled skillmaker binary.
---

Skillmaker Studio also ships as a desktop app — a [Tauri
v2](https://v2.tauri.app) shell that wraps the compiled `skillmaker` binary
as a sidecar, so the same viewer-plus-server product runs as a `.app` with
no terminal, no `bun`/Node runtime, and no CLI knowledge required on the
target machine. It's the same board and the same journal underneath; the
app is a launcher and a window, nothing more.

:::caution[Built from source, macOS only]
There's no downloadable installer yet — build it yourself from a checkout
(below). Only macOS is supported today; the Rust side has some
`#[cfg(unix)]`/`#[cfg(windows)]` seams in place, but nothing has been built
or tested on Windows or Linux.
:::

## Building it

In addition to the [prerequisites for installing from source](/getting-started/install/),
you'll need the [Rust toolchain](https://rustup.rs) (for `cargo tauri
build`). From a repo checkout:

```sh
bun install
bun run build:desktop
```

`build:desktop` chains three steps: `bun run build:dist` (compiles the
`skillmaker` binary + the static viewer), a script that stages both into
Tauri's sidecar layout, and finally `cargo tauri build`, which produces the
`.app` (and `.dmg`) bundle under `packages/desktop/src-tauri/target/`.

## What the shell does

1. On launch, it shows a small loading page immediately, then picks (or
   asks you to pick, via a native folder dialog) a workspace directory —
   any directory `skillmaker init` has set up.
2. It checks whether a `skillmaker start` server is **already running**
   for that workspace (the same claim file the CLI itself reads/writes). If
   so, it just points the window at that server's existing port and spawns
   nothing of its own. If not, it spawns the bundled `skillmaker` binary
   itself (`skillmaker start --port 0 --no-open`) and navigates the window
   to it once it's bound.
3. **File → Workspace → Switch Workspace…** re-runs that picking/checking
   step for a different folder.
4. On quit, if the app spawned its own server, it stops it; if it merely
   attached to a server someone else started, quitting the app leaves that
   server running untouched.

## Known limitation: a dead attached server leaves a stale board

When the app attaches to a server it didn't spawn (step 2 above — e.g. one
left running in a terminal via `skillmaker start`), it doesn't monitor that
process. If the external server dies while the app's window is open, the
window is left pointing at a port nothing is listening on anymore: the
board goes stale (no more SSE updates, no more API responses), with no
in-app signal that the underlying server is gone. Recovering means
quitting and relaunching, or using Switch Workspace to force the app to
spawn its own server for that workspace.

The macOS-only scope and the closed-window behavior (the app stays running
with no window when you close it, same as normal macOS apps) are the other
two known gaps for this phase — see `packages/desktop/README.md` in the
repo for the full list.

## See also

[Install from source](/getting-started/install/) for the CLI/bun
prerequisites this builds on, and the
[Roadmap](/roadmap/) for what's planned beyond this first pass (Windows/Linux,
a signed/downloadable build, an in-app reconnect for the limitation above).
