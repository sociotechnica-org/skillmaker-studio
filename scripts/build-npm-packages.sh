#!/usr/bin/env sh
# Assembles the npm-publishable packages (docs/proposals/2026-07-20-install-simplification.md
# Phase A.2/A.3) from an already-built `dist/` (run `./scripts/build-dist.sh`
# first -- this script does NOT compile anything itself, it only packages
# what build-dist.sh produced).
#
#   1. `@skillmaker/cli-<platform>-<arch>` -- one platform package per
#      requested platform (esbuild/biome-style optionalDependencies layout:
#      `os`/`cpu` fields, no postinstall). The template package.json lives
#      at npm/cli-<platform>-<arch>/package.json (tracked in git, version
#      "0.0.0"); this script copies the compiled binary + viewer assets in
#      next to it and stamps the real version.
#   2. `skillmaker-studio` -- the wrapper package (bin name stays
#      `skillmaker`). Its launcher (npm/skillmaker-studio/bin/skillmaker.js)
#      is static, tracked source; this script only stamps its version and
#      its optionalDependencies' version pins.
#
# Modes (mirroring build-dist.sh):
#
#   build-npm-packages.sh [version]                    host platform only,
#       reads the legacy flat dist/ layout (dist/skillmaker + dist/viewer-dist)
#   build-npm-packages.sh --platform <key> [version]   one platform, reads
#       dist/targets/<key>/ (from `build-dist.sh --platform <key>`)
#   build-npm-packages.sh --all [version]              all four platforms,
#       reads dist/targets/<key>/ for each (from `build-dist.sh --all`)
#
# Platform keys: darwin-arm64, darwin-x64, linux-x64, win32-x64. The win32
# binary is `skillmaker.exe` (matching npm/cli-win32-x64/package.json's
# `files` list and the wrapper launcher's win32 lookup).
#
# Output (gitignored, safe to rerun -- each run replaces dist/npm/ wholesale):
#   dist/npm/cli-<platform>-<arch>/   ready to `npm publish` or `npm pack`
#   dist/npm/skillmaker-studio/       ready to `npm publish` or `npm pack`
#
# Does NOT publish or pack anything itself -- that's the caller's job (see
# .github/workflows/release.yml's publish-npm job, or run `npm pack
# dist/npm/<name>` locally to verify without publishing).

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

ALL_PLATFORMS="darwin-arm64 darwin-x64 linux-x64 win32-x64"

usage() {
  echo "usage: $0 [--platform <key> | --all] [version]" >&2
  echo "       keys: ${ALL_PLATFORMS}" >&2
  exit 2
}

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
      echo "error: unsupported host OS '$(uname -s)' (supported: Darwin, Linux; use --platform)" >&2
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
version_arg=""
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
    -*)
      usage
      ;;
    *)
      [ -z "$version_arg" ] || usage
      version_arg="$1"
      ;;
  esac
  shift
done

if [ ! -f dist/VERSION ]; then
  echo "error: dist/VERSION must exist first -- run ./scripts/build-dist.sh." >&2
  exit 1
fi

# The version to publish under. Prefer an explicit override (release.yml
# passes the git tag, stripped of its leading "v", so a tag build's npm
# version matches its GitHub Release exactly); otherwise fall back to
# dist/VERSION's package-version part (it's "<version>+<sha>[-dirty]" --
# npm allows build metadata in a version, but a local/dev build shouldn't
# imply it's the tagged release, so we drop the metadata and use the bare
# version for `npm pack` smoke-testing).
version="${version_arg:-$(cut -d+ -f1 dist/VERSION)}"

case "$mode" in
  host) platforms="$(host_platform_key)" ;;
  platform) platforms="$platform_arg" ;;
  all) platforms="$ALL_PLATFORMS" ;;
esac

out="dist/npm"
rm -rf "$out"
mkdir -p "$out"

echo "==> build-npm-packages: version ${version}, platforms: ${platforms}"

for key in $platforms; do
  platform_dir="cli-${key}"
  if [ ! -d "npm/${platform_dir}" ]; then
    echo "error: no npm/${platform_dir} template (supported: ${ALL_PLATFORMS})" >&2
    exit 1
  fi

  # Where build-dist.sh put this platform's artifacts: dist/targets/<key>/
  # in --platform/--all mode; the legacy flat dist/ layout as a host-mode
  # fallback (only valid for the host's own platform key).
  binary="$(binary_name_for "$key")"
  if [ -d "dist/targets/${key}" ]; then
    src="dist/targets/${key}"
  elif [ "$mode" = "host" ] && [ -f "dist/skillmaker" ]; then
    src="dist"
  else
    echo "error: dist/targets/${key}/ not found -- run ./scripts/build-dist.sh --platform ${key} (or --all) first." >&2
    exit 1
  fi
  if [ ! -f "${src}/${binary}" ] || [ ! -d "${src}/viewer-dist" ]; then
    echo "error: ${src}/${binary} and ${src}/viewer-dist/ must exist first -- rerun ./scripts/build-dist.sh." >&2
    exit 1
  fi

  echo "==> build-npm-packages: assembling @skillmaker/${platform_dir} (from ${src}/)"
  pkg_out="${out}/${platform_dir}"
  mkdir -p "${pkg_out}/bin"
  cp "npm/${platform_dir}/package.json" "${pkg_out}/package.json"
  cp "${src}/${binary}" "${pkg_out}/bin/${binary}"
  chmod +x "${pkg_out}/bin/${binary}"
  cp -r "${src}/viewer-dist" "${pkg_out}/viewer-dist"
  bun -e "
    const fs = require('node:fs');
    const path = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = process.argv[2];
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  " "${pkg_out}/package.json" "$version"
done

echo "==> build-npm-packages: assembling skillmaker-studio"
wrapper_out="${out}/skillmaker-studio"
mkdir -p "${wrapper_out}/bin"
cp npm/skillmaker-studio/package.json "${wrapper_out}/package.json"
cp npm/skillmaker-studio/bin/skillmaker.js "${wrapper_out}/bin/skillmaker.js"
chmod +x "${wrapper_out}/bin/skillmaker.js"
bun -e "
  const fs = require('node:fs');
  const path = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = process.argv[2];
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    pkg.optionalDependencies[dep] = process.argv[2];
  }
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
" "${wrapper_out}/package.json" "$version"

echo "==> build-npm-packages: done"
for key in $platforms; do
  echo "    ${out}/cli-${key}/"
done
echo "    ${wrapper_out}/"
echo "    (npm pack each dir, or npm publish from each dir, to actually publish)"
