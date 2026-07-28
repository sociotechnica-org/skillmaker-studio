#!/usr/bin/env sh
# Builds the distributable `skillmaker` artifact: a single compiled binary
# (`bun build --compile`) plus the viewer's static assets, laid out so the
# two can be copied anywhere together and just work (plan.md Phase 12
# "distribution"; packages/cli/src/server/ViewerDist.ts's execPath-relative
# discovery is what makes the `viewer-dist` name and sibling placement
# load-bearing -- don't rename or move it without updating that file too).
#
# Modes (bun cross-compiles via `--target`, so any host can build any
# platform -- release.yml runs `--all` on a single linux runner):
#
#   build-dist.sh                     host platform only, legacy flat layout
#   build-dist.sh --platform <key>    one platform, into dist/targets/<key>/
#   build-dist.sh --all               all platforms, into dist/targets/<key>/
#
# Platform keys (repo vocabulary, matching npm/cli-<key>/ and process
# .platform-process.arch): darwin-arm64, darwin-x64, linux-x64, win32-x64.
#
# Output layout (repo-root-relative, gitignored -- `dist/` is already in
# .gitignore):
#
#   default (host) mode -- unchanged, other tooling depends on it
#   (prepare-desktop-sidecar.sh, install.sh's tarball layout):
#     dist/skillmaker      compiled binary
#     dist/viewer-dist/    viewer's built static assets (astro build's dist/)
#     dist/VERSION         "<package.json version>+<git short sha>[-dirty]"
#
#   --platform / --all mode, per platform key:
#     dist/targets/<key>/skillmaker        (skillmaker.exe for win32-x64)
#     dist/targets/<key>/viewer-dist/
#     dist/targets/<key>/VERSION
#   plus dist/VERSION at the top level (same content, one per run).
#
# The win32 layout is deliberately identical apart from the .exe suffix:
# ViewerDist.ts walks ancestors of dirname(process.execPath) looking for a
# `viewer-dist` sibling, using path.join throughout, so the same
# binary-plus-sibling shape works on Windows unchanged.
#
# Safe to rerun: each step overwrites its own output only, nothing is
# appended to or accumulated across runs.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

ALL_PLATFORMS="darwin-arm64 darwin-x64 linux-x64 win32-x64"

usage() {
  echo "usage: $0 [--platform <key> | --all]" >&2
  echo "       keys: ${ALL_PLATFORMS}" >&2
  exit 2
}

# Map a platform key to bun's --target vocabulary. Exits non-zero on an
# unknown key rather than silently producing a binary nothing can install.
bun_target_for() {
  case "$1" in
    darwin-arm64) echo "bun-darwin-arm64" ;;
    darwin-x64) echo "bun-darwin-x64" ;;
    linux-x64) echo "bun-linux-x64" ;;
    win32-x64) echo "bun-windows-x64" ;;
    *)
      echo "error: unknown platform key '$1' (supported: ${ALL_PLATFORMS})" >&2
      exit 1
      ;;
  esac
}

# Binary filename for a platform key (bun appends .exe for windows targets;
# we name it explicitly so the layout is deterministic).
binary_name_for() {
  case "$1" in
    win32-x64) echo "skillmaker.exe" ;;
    *) echo "skillmaker" ;;
  esac
}

host_platform_key() {
  case "$(uname -s)" in
    Darwin) p="darwin" ;;
    Linux) p="linux" ;;
    *)
      echo "error: unsupported host OS '$(uname -s)' (supported: Darwin, Linux; use --platform to cross-build)" >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) a="arm64" ;;
    x86_64 | amd64) a="x64" ;;
    *)
      echo "error: unsupported host arch '$(uname -m)' (supported: arm64, x64)" >&2
      exit 1
      ;;
  esac
  echo "${p}-${a}"
}

mode="host"
platform_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --all)
      mode="all"
      ;;
    --platform)
      [ $# -ge 2 ] || usage
      mode="platform"
      platform_arg="$2"
      shift
      ;;
    *)
      usage
      ;;
  esac
  shift
done

echo "==> build-dist: installing dependencies (if needed)"
if [ ! -d node_modules ] || [ ! -d packages/cli/node_modules ]; then
  bun install
fi

echo "==> build-dist: building the viewer (shared across all platforms)"
bun run build:viewer

version_string() {
  package_version="$(bun -e "console.log(require('./package.json').version)")"
  git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
    git_sha="${git_sha}-dirty"
  fi
  echo "${package_version}+${git_sha}"
}

# Compile the CLI for one platform key into one output directory, then
# stage viewer-dist/ and VERSION beside the binary.
build_target() {
  key="$1"
  outdir="$2"
  target="$(bun_target_for "$key")"
  binary="$(binary_name_for "$key")"

  echo "==> build-dist: compiling the CLI binary for ${key} (--target=${target})"
  mkdir -p "$outdir"
  # No extra flags needed: bun:sqlite (via @skillmaker/core's IndexService)
  # and the effect/@effect/platform-bun beta packages compile and run
  # correctly under a plain `bun build --compile` as of bun 1.3.11 -- see
  # docs/dist.md "Known risks" for what was checked and why nothing extra
  # was required.
  bun build --compile --target="$target" packages/cli/src/main.ts \
    --outfile "${outdir}/${binary}"

  echo "==> build-dist: copying viewer assets next to the ${key} binary"
  rm -rf "${outdir}/viewer-dist"
  cp -r packages/viewer/dist "${outdir}/viewer-dist"

  echo "$dist_version" >"${outdir}/VERSION"
}

mkdir -p dist
dist_version="$(version_string)"
echo "$dist_version" >dist/VERSION

case "$mode" in
  host)
    build_target "$(host_platform_key)" dist
    ;;
  platform)
    # Validate the key up front (bun_target_for exits on unknown keys).
    bun_target_for "$platform_arg" >/dev/null
    build_target "$platform_arg" "dist/targets/${platform_arg}"
    ;;
  all)
    for key in $ALL_PLATFORMS; do
      build_target "$key" "dist/targets/${key}"
    done
    ;;
esac

echo "==> build-dist: done (version ${dist_version})"
case "$mode" in
  host)
    echo "    dist/skillmaker"
    echo "    dist/viewer-dist/"
    echo "    dist/VERSION"
    ;;
  platform)
    echo "    dist/targets/${platform_arg}/"
    ;;
  all)
    for key in $ALL_PLATFORMS; do
      echo "    dist/targets/${key}/"
    done
    ;;
esac
