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
- npm publishing uses **trusted publishing (OIDC)** as of v0.5.0: each
  package (`skillmaker-studio`, `@skillmaker/cli-darwin-arm64`,
  `@skillmaker/cli-darwin-x64`, `@skillmaker/cli-linux-x64`,
  `@skillmaker/cli-win32-x64`) has this repo + `release.yml` registered as
  a trusted publisher on npmjs.com, and `publish-npm` carries
  `id-token: write`. No `NPM_TOKEN` secret exists or is needed. A NEW
  package needs its trusted publisher registered before its first tag run
  (registration: npmjs.com > @skillmaker org > package > Settings >
  Publishing access > Trusted publisher > GitHub Actions, with repo
  `sociotechnica-org/skillmaker-studio`, workflow `release.yml`, no
  environment). `@skillmaker/cli-win32-x64` and `@skillmaker/cli-darwin-x64`
  were added after v0.5.0 -- their first successful publish requires this
  one-time registration; until then the workflow's final "Publish NEW
  platform packages" step fails 404/403 while the established three still
  publish fine. If npm won't let you register a trusted publisher for a
  package that doesn't exist yet, do the first publish manually from the
  run's `npm-packages` artifact (`cd` into each package dir, `npm publish
  --access public`), then register.

## Version touchpoints

There is exactly **one tracked file to bump**: the root `package.json`
`"version"` field. Everything else derives:

- `dist/VERSION` — written by `scripts/build-dist.sh` as
  `<root package.json version>+<git sha>`; names the release tarballs
  (`skillmaker-<version>-<os>-<arch>.tar.gz`).
- `npm/skillmaker-studio/package.json` and the four
  `npm/cli-<platform>-<arch>/package.json` templates (darwin-arm64,
  darwin-x64, linux-x64, win32-x64) — tracked **templates that stay
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
   npm view @skillmaker/cli-darwin-x64 version
   npm view @skillmaker/cli-linux-x64 version
   npm view @skillmaker/cli-win32-x64 version
   npx -y skillmaker-studio@X.Y.Z --help      # smoke: wrapper resolves + spawns the binary
   ```

## What the workflow does (in order)

1. `build` (ubuntu-latest, single job): `./scripts/build-dist.sh --all`
   cross-compiles the binary for all four platforms (bun
   `build --compile --target=bun-<platform>` — no per-platform runners),
   archives each platform's `skillmaker[.exe]` + `viewer-dist/` + `VERSION`
   (`.tar.gz` for the unix targets, `.zip` for win32-x64), then
   `./scripts/build-npm-packages.sh --all "${GITHUB_REF_NAME#v}"` assembles
   all four `@skillmaker/cli-<platform>-<arch>` packages plus the
   `skillmaker-studio` wrapper. npm packages ride as one tarball
   (`npm-packages.tar.gz`) to preserve the executable bit through
   upload-artifact's zip hop.
2. `publish-release`: downloads the release archives and creates the
   GitHub Release with generated notes.
3. `publish-npm` (OIDC): extracts the npm tarball and publishes in two
   steps — first the established `@skillmaker/cli-darwin-arm64`,
   `@skillmaker/cli-linux-x64`, `skillmaker-studio`; then, in a separate
   final step, the newer `@skillmaker/cli-darwin-x64` and
   `@skillmaker/cli-win32-x64` (so a missing trusted-publisher
   registration fails loudly without blocking the established three) —
   each via `(cd "$dir" && npm publish --access public)`.

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
- **v0.4.0 — `npm publish` E404 on PUT means the token can't write the
  scope, not that the package is missing.** The v0.4.0 run's `publish-npm`
  failed with `404 Not Found - PUT
  https://registry.npmjs.org/@skillmaker%2fcli-darwin-arm64` even though
  that package exists at 0.3.0. npm answers 404 (not 403) when the auth
  token lacks access to a scoped package, to avoid leaking existence.
  Root cause context: v0.3.0's npm packages were published *manually* (the
  tag run died on #125 before reaching npm), so `NPM_TOKEN` had never
  actually been proven against the `@skillmaker` org — its first real use
  was this failure. Fix is outside the repo: grant the token publish access
  to the `@skillmaker` scope (or rotate to an automation token that has
  it), then recover via manual publish from the run's `npm-*` artifacts or
  a tag re-push. Until a tag run has published cleanly end-to-end, treat
  the token as unverified — consider an `npm whoami`/dry-run check before
  tagging.
- **Release-tarball names carry build metadata.** `dist/VERSION` is
  `<version>+<sha>`, and the tarball step uses it wholesale, so GitHub
  Release assets are named like `skillmaker-0.4.0+cf95e0b-darwin-arm64.tar.gz`.
  Cosmetic, but expect it when scripting downloads.
- **npm `view` lag.** Freshly published versions can take a minute or two
  to appear; retry before concluding the publish failed.

- **v0.5.0 attempt 1 — `EOTP` means the package demands interactive 2FA
  for publishes.** With a valid, correctly-scoped token, `npm publish`
  still failed `EOTP` because the packages' publishing access required
  two-factor with no automation-token exception. The token era ended here:
  rather than flipping the per-package setting, v0.5.0 moved to trusted
  publishing (OIDC) — npm's own direction, since granular tokens lose
  direct publish ~Jan 2027 (npm changelog 2026-07-08).
- **Workflow fixes require a re-tag, and re-tagging is safe when npm is
  clean.** Exercised at v0.5.0: the tag pointed at a pre-OIDC commit, so
  the release + tag were deleted (`gh release delete --cleanup-tag`), the
  tag re-pushed onto the commit carrying the workflow fix, and the fresh
  run went green end-to-end. Safe because nothing had published to npm at
  that version; with a partial publish, expect EPUBLISHCONFLICT instead.

## Verified vs. inferred

Verified by execution or direct observation: the tag-only trigger, the
single version touchpoint, the bump-PR → merge → tag-the-merge-commit flow
(v0.4.0, run 29927633785), the #125 failure and its fix (the cd'd publish
loop ran and reached npm at v0.4.0), the E404 scope-access failure, the
failed-attempt-2 behavior and manual-publish recovery of v0.3.0 (run
29789655443), the `+sha` asset naming, npm state before/after.

Verified at v0.5.0 (run 30152656666, 2026-07-25): the first fully green
`publish-npm` end-to-end — via OIDC trusted publishing, no secret — plus
the npx smoke test against the CI-published version, and the
delete-release/re-tag recovery path.

Still inferred, not exercised: EPUBLISHCONFLICT on partial-publish
recovery, and the `install.sh` fallback path (frozen by design; not part
of this workflow).
