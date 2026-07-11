# Distributing `skillmaker` (Phase 12a)

`skillmaker` ships as a single compiled binary plus the viewer's static
assets — installable on a machine that has never seen this repo, with no
`bun`, no `node_modules`, and no monorepo checkout required at runtime.

## Building the artifact

From the repo root:

```sh
bun run build:dist
# or directly:
./scripts/build-dist.sh
```

This is safe to rerun (idempotent-ish — each step overwrites its own
output, nothing accumulates across runs). It:

1. Runs `bun install` if `node_modules/` looks missing.
2. Builds the viewer (`bun run build:viewer` → `packages/viewer/dist/`).
3. Compiles the CLI: `bun build --compile packages/cli/src/main.ts --outfile dist/skillmaker`.
4. Copies `packages/viewer/dist/` to `dist/viewer-dist/`.
5. Writes `dist/VERSION` as `<package.json version>+<git short sha>[-dirty]`.

Output (all gitignored — `dist/` is already in `.gitignore`):

```text
dist/
  skillmaker       # compiled binary (~60MB; bun embeds its runtime)
  viewer-dist/      # viewer's built static assets (astro build's dist/)
  VERSION           # e.g. "0.0.0+e687394" or "0.0.0+e687394-dirty"
```

## Artifact layout is load-bearing

`dist/skillmaker` and `dist/viewer-dist/` must stay **siblings** — copied
to the same directory together. `packages/cli/src/server/ViewerDist.ts`'s
binary-relative discovery walks up from `dirname(process.execPath)`
looking for a directory literally named `viewer-dist`. Renaming that
directory, or separating it from the binary, breaks `skillmaker start`
under the compiled binary (it still works fine when run from the repo
checkout via `bun packages/cli/src/main.ts`, which resolves
`packages/viewer/dist` instead — see "How discovery works" below).

## Installing from a published release

`packages/marketing-site/public/install.sh` (served as
`https://skillmaker.studio/install.sh`) detects your OS/arch, downloads the
matching tarball from the latest GitHub Release
(`sociotechnica-org/skillmaker-studio`), and installs `skillmaker` +
`viewer-dist/` as siblings under `~/.skillmaker/bin/`:

```sh
curl -fsSL https://skillmaker.studio/install.sh | sh
```

It's re-run-safe — running it again re-downloads the latest release and
overwrites the previous install in place, so re-running it is how you
upgrade. Supported platforms today: macOS arm64 (`darwin-arm64`) and Linux
x64 (`linux-x64`) — see `.github/workflows/release.yml`. macOS x64 (Intel)
and Linux arm64 are fast-follows.

## Installing from source (building locally)

Copy the two artifacts anywhere on the target machine, keeping them
siblings, and put the binary on `PATH`:

```sh
mkdir -p ~/.local/skillmaker
cp dist/skillmaker ~/.local/skillmaker/
cp -r dist/viewer-dist ~/.local/skillmaker/
ln -s ~/.local/skillmaker/skillmaker /usr/local/bin/skillmaker   # or add to PATH
```

Then, in any git repo:

```sh
skillmaker init
skillmaker new my-skill
skillmaker start
```

No `bun`, no repo checkout, no `node_modules` needed on the target
machine — the binary is fully self-contained (it embeds the bun runtime).

## How discovery works

`locateViewerDist` (`packages/cli/src/server/ViewerDist.ts`) tries two
strategies, in order, so both the monorepo checkout and the installed
binary work without any env var or flag:

1. **Module-relative walk** (`import.meta.url` of the CLI entry, i.e.
   `packages/cli/src/main.ts`): walks ancestor directories looking for
   `packages/viewer/dist` or `viewer/dist`. This is what resolves things
   when running from the repo checkout (`bun packages/cli/src/main.ts
   start`) or a non-compiled standalone install with the viewer vendored
   next to the CLI source.
2. **execPath-relative walk** (`process.execPath`): walks ancestor
   directories of the *running executable's* directory looking for
   `viewer-dist`. This is the one that matters for the compiled binary.

If neither strategy finds a match, `skillmaker start` fails with a clear
error listing every path it checked across both walks.

## Known risks investigated for Phase 12a

- **`bun:sqlite` under `bun build --compile`.** `@skillmaker/core`'s
  `IndexService` uses `bun:sqlite` directly (no native npm addon).
  Verified working with zero extra compile flags: `list`, `new`,
  `version record`, and `start` (which rebuilds the index) all exercise
  it in the golden-path e2e and pass against the compiled binary.
- **effect (beta) + `@effect/platform-bun` ESM under compile.** Both are
  plain ESM TypeScript/JS with no native bindings; `bun build --compile`
  bundles and compiles them with no special flags. Verified by running
  every CLI command (which all build the full `WorkspaceLayer` +
  `BunServices` layer stack) against the compiled binary.
- **`import.meta.url` inside a compiled binary.** This was the one real
  risk, and it does bite: inside `bun build --compile`'s output,
  `import.meta.url` resolves to a virtual path under `/$bunfs/...` with
  no relationship to the real filesystem, so the pre-existing
  module-relative ancestor walk in `ViewerDist.ts` can never find a real
  `viewer-dist` directory from inside a compiled binary — confirmed by
  running the binary from a directory with `viewer-dist` copied
  next to it and watching it fail with "viewer dist/ not found" listing
  only virtual `/$bunfs/...` paths. `process.execPath`, in contrast, is
  always a real on-disk path (the `bun` binary in dev, the compiled
  `skillmaker` binary once compiled), so it's the anchor the
  execPath-relative walk uses. No other `import.meta.url` usage in
  `packages/cli` needed changes — `Start.ts`'s `readCliVersion` also uses
  it (to read `package.json`'s version for the `/api/health` payload),
  but its failure mode is already graceful: `readFileSync` throws inside
  a compiled binary (no real `package.json` on disk relative to the
  virtual path), the existing `catch` swallows it, and it falls back to
  `"0.0.0"` — acceptable for now; not touched, since `main.ts`/`Start.ts`
  changes were explicitly scoped to "only if strictly needed" and the
  compiled binary's `/api/health` response is still well-formed (see
  `docs/dist.md` follow-up note below if this needs a real version
  someday, e.g. by having `build-dist.sh` inject the version at compile
  time via `--define`).

## Testing the real install story

`test/e2e/dist.e2e.test.ts` is the golden-path suite against the actual
distributed artifact — not `bun packages/cli/src/main.ts` like the other
e2e suites, but a copy of `dist/skillmaker` + `dist/viewer-dist/` in an
install directory unrelated to the repo checkout, driven against a fresh
workspace also unrelated to the repo checkout: `init`, `new`, `list`,
write `output/SKILL.md` by hand, `version record`, `start --port <random>
--no-open` (spawned as a real subprocess, not in-process), `/api/health`,
`/api/bundles`, `/` serving real HTML, clean `SIGTERM` shutdown.

It's guarded: if `dist/skillmaker` or `dist/viewer-dist/` doesn't exist
(a fresh checkout that hasn't run `build:dist` yet), it reports as
skipped with a message telling you how to run it for real, rather than
failing:

```sh
bun run build:dist && bun test test/e2e/dist.e2e.test.ts
```
