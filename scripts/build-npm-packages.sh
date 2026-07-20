#!/usr/bin/env sh
# Assembles the npm-publishable packages (docs/proposals/2026-07-20-install-simplification.md
# Phase A.2/A.3) from an already-built `dist/` (run `./scripts/build-dist.sh`
# first -- this script does NOT compile anything itself, it only packages
# what build-dist.sh produced).
#
#   1. `@skillmaker/cli-<platform>-<arch>` -- one platform package for the
#      HOST this script runs on (esbuild/biome-style optionalDependencies
#      layout: `os`/`cpu` fields, no postinstall). The template package.json
#      lives at npm/cli-<platform>-<arch>/package.json (tracked in git,
#      version "0.0.0"); this script copies the compiled binary + viewer
#      assets in next to it and stamps the real version.
#   2. `skillmaker-studio` -- the wrapper package (bin name stays
#      `skillmaker`). Its launcher (npm/skillmaker-studio/bin/skillmaker.js)
#      is static, tracked source; this script only stamps its version and
#      its optionalDependencies' version pins.
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

if [ ! -f dist/skillmaker ] || [ ! -d dist/viewer-dist ] || [ ! -f dist/VERSION ]; then
  echo "error: dist/skillmaker, dist/viewer-dist/, and dist/VERSION must exist first." >&2
  echo "       run ./scripts/build-dist.sh (builds for the current host only)." >&2
  exit 1
fi

# The version to publish under. Prefer an explicit override (release.yml
# passes the git tag, stripped of its leading "v", so a tag build's npm
# version matches its GitHub Release exactly); otherwise fall back to
# dist/VERSION's package-version part (it's "<version>+<sha>[-dirty]" --
# npm allows build metadata in a version, but a local/dev build shouldn't
# imply it's the tagged release, so we drop the metadata and use the bare
# version for `npm pack` smoke-testing).
version="${1:-$(cut -d+ -f1 dist/VERSION)}"

# Host platform/arch, mapped to this repo's package-name vocabulary. Only
# the two combinations release.yml's matrix actually builds are supported;
# anything else is a hard error rather than silently producing a package
# nothing can install.
host_os="$(uname -s)"
host_arch="$(uname -m)"
case "$host_os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *)
    echo "error: unsupported host OS '$host_os' (supported: Darwin, Linux)" >&2
    exit 1
    ;;
esac
case "$host_arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    echo "error: unsupported host arch '$host_arch' (supported: arm64, x64)" >&2
    exit 1
    ;;
esac

platform_dir="cli-${platform}-${arch}"
if [ ! -d "npm/${platform_dir}" ]; then
  echo "error: no npm/${platform_dir} template (supported: cli-darwin-arm64, cli-linux-x64)" >&2
  exit 1
fi

echo "==> build-npm-packages: version ${version}, platform package ${platform_dir}"

out="dist/npm"
rm -rf "$out"
mkdir -p "$out"

echo "==> build-npm-packages: assembling @skillmaker/${platform_dir}"
pkg_out="${out}/${platform_dir}"
mkdir -p "${pkg_out}/bin"
cp "npm/${platform_dir}/package.json" "${pkg_out}/package.json"
cp dist/skillmaker "${pkg_out}/bin/skillmaker"
chmod +x "${pkg_out}/bin/skillmaker"
cp -r dist/viewer-dist "${pkg_out}/viewer-dist"
bun -e "
  const fs = require('node:fs');
  const path = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = process.argv[2];
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
" "${pkg_out}/package.json" "$version"

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
echo "    ${pkg_out}/"
echo "    ${wrapper_out}/"
echo "    (npm pack each dir, or npm publish from each dir, to actually publish)"
