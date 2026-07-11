#!/usr/bin/env sh
# Builds the distributable `skillmaker` artifact: a single compiled binary
# (`bun build --compile`) plus the viewer's static assets, laid out so the
# two can be copied anywhere together and just work (plan.md Phase 12
# "distribution"; packages/cli/src/server/ViewerDist.ts's execPath-relative
# discovery is what makes the `viewer-dist` name and sibling placement
# load-bearing -- don't rename or move it without updating that file too).
#
# Output layout (repo-root-relative, gitignored -- `dist/` is already in
# .gitignore):
#   dist/skillmaker      compiled binary
#   dist/viewer-dist/    viewer's built static assets (astro build's dist/)
#   dist/VERSION         "<package.json version>+<git short sha>[-dirty]"
#
# Safe to rerun: each step overwrites its own output only, nothing is
# appended to or accumulated across runs.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

echo "==> build-dist: installing dependencies (if needed)"
if [ ! -d node_modules ] || [ ! -d packages/cli/node_modules ]; then
  bun install
fi

echo "==> build-dist: building the viewer"
bun run build:viewer

echo "==> build-dist: compiling the CLI binary"
mkdir -p dist
# No extra flags needed: bun:sqlite (via @skillmaker/core's IndexService)
# and the effect/@effect/platform-bun beta packages compile and run
# correctly under a plain `bun build --compile` as of bun 1.3.11 -- see
# docs/dist.md "Known risks" for what was checked and why nothing extra
# was required.
bun build --compile packages/cli/src/main.ts --outfile dist/skillmaker

echo "==> build-dist: copying viewer assets next to the binary"
rm -rf dist/viewer-dist
cp -r packages/viewer/dist dist/viewer-dist

echo "==> build-dist: writing dist/VERSION"
package_version="$(bun -e "console.log(require('./package.json').version)")"
git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  git_sha="${git_sha}-dirty"
fi
echo "${package_version}+${git_sha}" >dist/VERSION

echo "==> build-dist: done"
echo "    dist/skillmaker"
echo "    dist/viewer-dist/"
echo "    dist/VERSION ($(cat dist/VERSION))"
