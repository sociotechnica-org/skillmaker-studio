---
name: skillmaker-dev-release
description: Cut a skillmaker-studio release — version bump PR, v-tag push, release.yml build + npm publish, verification. Use when a maintainer asks to release a new version of skillmaker-studio to GitHub Releases and npm.
---

# Releasing skillmaker-studio

The release is tag-driven: pushing a `v*` tag runs
`.github/workflows/release.yml`, which builds platform binaries, attaches
tarballs to a GitHub Release, and publishes the npm packages. Your job is
to (1) land a version-bump PR on main, (2) tag the merged commit, (3) watch
the run, (4) verify npm.

## Preconditions

- Clean `main`, CI green on the tip you intend to release.
- The six-or-so PRs you mean to ship are already merged to main.
- You can push tags to the repo and `gh` is authenticated.
- `NPM_TOKEN` repo secret is configured (if absent, `publish-npm` is
  skipped gracefully — the GitHub Release still happens, npm does not).

## Version touchpoints

There is exactly **one tracked file to bump**: the root `package.json`
`"version"` field. Everything else derives:

- `dist/VERSION` — written by `scripts/build-dist.sh` as
  `<root package.json version>+<git sha>`; names the release tarballs
  (`skillmaker-<version>-<os>-<arch>.tar.gz`).
- `npm/skillmaker-studio/package.json`, `npm/cli-darwin-arm64/package.json`,
  `npm/cli-linux-x64/package.json` — tracked **templates that stay
  `"0.0.0"`**. Do NOT bump them. `scripts/build-npm-packages.sh` stamps the
  real version (and the wrapper's `optionalDependencies` pins) at build
  time from the tag (`${GITHUB_REF_NAME#v}`).
- `packages/*/package.json` — workspace-internal, all `"0.0.0"`, never
  bumped.

**Invariant:** the root `package.json` version must equal the tag's bare
version. The tarball names come from package.json; the npm versions come
from the tag. If they disagree, the GitHub Release and npm disagree.

## Steps

1. **Bump + PR.** On a branch (e.g. `release/vX.Y.Z`), set root
   `package.json` `"version"` to `X.Y.Z`. Open a PR, wait for CI
   (`gh pr checks --watch`), squash-merge.
2. **Tag the merged commit.** Fetch main and tag exactly the merge commit:

   ```sh
   git fetch origin main
   git tag vX.Y.Z <merged-sha>   # or FETCH_HEAD after verifying it's the merge
   git push origin vX.Y.Z
   ```

   The workflow triggers on `push: tags: ["v*"]` only. There is no
   `workflow_dispatch` — a tag push is the only door.
3. **Watch.** `gh run list --workflow release.yml` for the run on the tag,
   then `gh run watch <run-id> --exit-status`.
4. **Verify** (npm propagation can lag a minute or two — retry, don't
   panic):

   ```sh
   npm view skillmaker-studio version         # expect X.Y.Z
   npm view @skillmaker/cli-darwin-arm64 version
   npm view @skillmaker/cli-linux-x64 version
   npx -y skillmaker-studio@X.Y.Z --help      # smoke: wrapper resolves + spawns the binary
   ```

## What the workflow does (in order)

1. `build-macos-arm64` (macos-14) and `build-linux-x64` (ubuntu-latest), in
   parallel; no cross-compile — each host builds its own binary via
   `./scripts/build-dist.sh`, tars `skillmaker` + `viewer-dist/` + `VERSION`,
   then runs `./scripts/build-npm-packages.sh "${GITHUB_REF_NAME#v}"` to
   assemble its `@skillmaker/cli-<platform>-<arch>` package. The macOS job
   also assembles + uploads the `skillmaker-studio` wrapper (built
   identically on either host; uploaded once to avoid an artifact-name
   collision). npm packages ride as tarballs to preserve the executable bit
   through upload-artifact's zip hop.
2. `publish-release`: downloads the `skillmaker-*` tarball artifacts and
   creates the GitHub Release with generated notes.
3. `check-npm-token` → `publish-npm` (skipped, not failed, without the
   secret): extracts the npm tarballs and publishes, in this order:
   `@skillmaker/cli-darwin-arm64`, `@skillmaker/cli-linux-x64`,
   `skillmaker-studio` — each via `(cd "$dir" && npm publish --access
   public)`.

Not published by the workflow: `@skillmaker/cli` (claimed 2026-07-20 as a
v0.0.1 placeholder per the install-simplification proposal; it stays a
placeholder unless the launcher moves there).

## Failure modes (learned the hard way)

- **#124 — the version bump is a separate, mandatory first step.** v0.3.0
  needed a dedicated bump commit because nothing else moves the root
  version. Tagging without it ships tarballs named for the old version.
- **#125 — `npm publish pkgs/name` does not publish a directory.** A bare
  `pkgs/skillmaker-studio` argument matches npm's GitHub `owner/repo`
  shorthand and is resolved as a git spec. v0.3.0's `publish-npm` failed
  exactly this way. The workflow now `cd`s into each package dir; keep it
  that way.
- **Re-running a failed tag run cannot pick up a workflow fix.** The run
  executes the workflow file at the tag's commit. v0.3.0's attempt 2 failed
  identically even after #125 merged to main, because the tag still pointed
  at the pre-fix commit. Recovery options: publish manually from the run's
  npm artifacts (what actually shipped 0.3.0 to npm, ~01:52 that night), or
  delete and re-push the tag onto a commit that contains the fix (npm
  versions are immutable — a partial publish means the re-run's `npm
  publish` of an already-published package will 403/EPUBLISHCONFLICT).
- **npm `view` lag.** Freshly published versions can take a minute or two
  to appear; retry before concluding the publish failed.

## Verified vs. inferred

Verified by execution or direct observation: the tag-only trigger, the
single version touchpoint, the #125 failure and its fix, the
failed-attempt-2 behavior and manual-publish recovery of v0.3.0 (run
29789655443), npm state before/after.

Inferred from reading, not yet exercised: the EPUBLISHCONFLICT behavior on
partial-publish recovery, and the `install.sh` fallback path (frozen by
design; not part of this workflow).
