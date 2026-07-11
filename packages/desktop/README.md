# @skillmaker/desktop

Skillmaker Studio's desktop shell -- a [Tauri v2](https://v2.tauri.app) app
that wraps the Phase-12a compiled `skillmaker` binary
([`docs/dist.md`](../../docs/dist.md)) as a sidecar, so the same
viewer-plus-server product ships as a double-clickable `.app` with no CLI,
no terminal, and no Node/Bun runtime required on the target machine.

See `docs/plans/2026-07-10-playmaker-to-skillmaker-migration/plan.md`
Phase 15 for the ruled scope this implements, and
`docs/sources/2026-07-11-desktop-app-thesis.md` for the product thinking
behind it (this phase is the "technical-but-app-preferring" persona only
-- the "genuinely non-technical" persona is a separate, unruled thesis).

macOS only for now (plan.md: "macOS first; Windows/Linux deferred until
asked for"). The Rust side has a couple of `#[cfg(unix)]`/`#[cfg(windows)]`
seams already in place, but nothing here has been built or tested on
Windows or Linux.

## How it works

1. On launch, the app loads a small static loading page
   (`ui/index.html`) into a window immediately, so there's never a blank
   window while the sidecar boots.
2. Once the event loop is live (`RunEvent::Ready` -- NOT in `setup`: a
   native dialog opened before the NSApp run loop is pumping renders but
   never receives clicks on macOS), it reads a remembered workspace path
   from `<appDataDir>/settings.json` (a hand-rolled JSON file, not
   `tauri-plugin-store` -- see `src-tauri/src/settings.rs` for why). If
   there isn't one (first launch, or the remembered folder no longer
   exists), it shows a native folder-picker dialog, parented to the main
   window as a sheet. Cancelling the picker never quits or hangs the
   app: the page flips to a message state and the Workspace menu can
   re-open the picker at any time.
3. For the chosen workspace, it checks
   `<workspace>/.skillmaker/claims/server.json` -- the same claim file
   `skillmaker start` itself reads/writes
   (`packages/cli/src/server/ClaimFile.ts`) -- to see whether a server is
   already running for that workspace (e.g. left running in a terminal).
   - If so: it points the window at that server's port and does **not**
     spawn anything. Quitting the app will not touch that server.
   - If not: it spawns the `skillmaker` sidecar as
     `skillmaker start --port 0 --no-open` with the workspace as its
     working directory. `--port 0` asks the OS for a free port (not the
     config-default 4323), so the desktop shell's own server never
     collides with a CLI-started instance for a *different* workspace.
     It watches the sidecar's stdout for the
     `http://localhost:<port>` line `skillmaker start` prints once
     bound, then navigates the window there. If the sidecar exits first
     (e.g. "no skillmaker workspace found") or doesn't print its URL
     within 15s (it is then killed), the loading page flips to an error
     state showing the sidecar's stderr excerpt, and a native dialog
     offers "Choose Another Folder…" to retry -- never an infinite
     spinner. A folder is only persisted as the remembered workspace
     after it launches successfully.
4. **File > Workspace > Switch Workspace…** (`Cmd+Shift+O`) stops the
   sidecar this process owns (if any) and re-runs step 2/3 for a newly
   picked folder.
5. On quit, if this process owns a sidecar, it sends `SIGTERM` (matching
   the signal `Start.ts`'s shutdown handler listens for, which removes
   the claim file before exiting) and polls briefly for the claim file to
   disappear, falling back to a hard kill only if the sidecar doesn't
   shut down within ~3s.

The window never grants the loaded content any Tauri IPC surface
(`tauri.conf.json`'s `app.security.capabilities` is `[]`, and no
`capabilities/` directory is defined) -- the loading page and the
sidecar-served viewer are both treated as plain web content with zero
access to Tauri APIs from JS. The error/loading states on the local page
are driven one-way from Rust via `WebviewWindow::eval` (the `__sm*` hooks
in `ui/index.html`); anything interactive (retry, workspace choice) is a
native dialog or menu item, never page JS. This is deliberate
defense-in-depth: the
viewer can render skill content (markdown/HTML) that this phase hasn't
audited as trusted, so the desktop shell doesn't hand it anything beyond
what a normal browser tab would have.

## Building the sidecar

Tauri's `externalBin` sidecar mechanism expects a binary at
`src-tauri/binaries/skillmaker-<target-triple>`, plus (for this app
specifically) a `src-tauri/binaries/viewer-dist/` directory --
`packages/cli/src/server/ViewerDist.ts`'s execPath-relative discovery
needs a directory literally named `viewer-dist` to exist as a sibling (or
ancestor) of wherever the running sidecar binary actually is. From the
repo root:

```sh
bun run build:dist                      # produces dist/skillmaker + dist/viewer-dist/
./scripts/prepare-desktop-sidecar.sh    # stages them into src-tauri/binaries/
```

`bun run build:desktop` (root `package.json`) chains both of those and
then `tauri build`.

Placement differs by mode, both handled automatically once the two
commands above have run:

- **`tauri dev`**: sidecars run from the same directory as the app's own
  dev binary (`target/debug/`, per `tauri-plugin-shell`'s
  `relative_command_path`). `src-tauri/build.rs` copies
  `binaries/viewer-dist/` there on every build, right next to where
  `tauri_build::build()` (called from the same `build.rs`) copies the
  sidecar binary itself.
- **`tauri build`** (the `.app` bundle): the bundled sidecar binary lands
  at `Contents/MacOS/skillmaker` inside the `.app`. `tauri.conf.json`'s
  `bundle.macOS.files` maps `binaries/viewer-dist/` to
  `MacOS/viewer-dist` -- i.e. also a sibling of the sidecar binary inside
  the bundle (this is *not* the same as `bundle.resources`, which lands
  in `Contents/Resources/` -- a directory the `ViewerDist.ts` ancestor
  walk never reaches from `Contents/MacOS/`).

`src-tauri/binaries/` is gitignored (machine- and target-triple-specific,
regenerated from `dist/` by the prepare script every time).

## Running

```sh
bun install                             # once, from the repo root
bun run build:dist
./scripts/prepare-desktop-sidecar.sh
cd packages/desktop
bun run dev      # cargo tauri dev -- live app window, hot-reloads Rust changes
# or
bun run build    # cargo tauri build -- produces the .app (+ .dmg) bundle
```

Re-run `bun run build:dist && ./scripts/prepare-desktop-sidecar.sh` from
the repo root whenever CLI/core/viewer source changes -- the sidecar is a
snapshot, not a live link to the checkout.

## Known limitations (Phase 15)

- macOS only; no Windows/Linux bundling or testing.
- Closing the window (red traffic-light button) follows normal macOS
  behavior (app stays running with no window, since no `ExitRequested` is
  triggered) -- there is currently no menu affordance to reopen a window
  in that state short of quitting (which does clean up the sidecar) and
  relaunching.
- The window's `backgroundColor` (used only for the brief flash before
  `ui/index.html`'s CSS paints) is a fixed dark value; it isn't
  theme-reactive the way the loading page's own CSS is
  (`prefers-color-scheme`). Tauri v2's window config doesn't currently
  support a light/dark pair for this.
