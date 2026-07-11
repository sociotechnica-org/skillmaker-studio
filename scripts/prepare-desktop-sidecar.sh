#!/usr/bin/env sh
# Stages the Phase-12a distributable (dist/skillmaker + dist/viewer-dist/,
# see docs/dist.md) into packages/desktop/src-tauri/binaries/ with the
# file naming Tauri's `externalBin` sidecar mechanism expects:
# `binaries/<name>-<target-triple>` for the executable itself (Tauri
# strips the triple back off when it copies the binary into the cargo
# target dir / app bundle -- see tauri-build's `copy_binaries`), plus a
# plain `binaries/viewer-dist/` directory that build.rs (dev) and
# tauri.conf.json's `bundle.macOS.files` (release bundle) place next to
# wherever that sidecar binary ends up, so
# `packages/cli/src/server/ViewerDist.ts`'s execPath-relative ancestor
# walk can find it.
#
# Must be run (after `bun run build:dist`) before `bun run --filter
# @skillmaker/desktop dev` or `build`. Safe to rerun: overwrites its own
# output only.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if [ ! -x dist/skillmaker ] || [ ! -d dist/viewer-dist ]; then
	echo "==> prepare-desktop-sidecar: dist/skillmaker or dist/viewer-dist/ missing" >&2
	echo "    Run 'bun run build:dist' first (see docs/dist.md)." >&2
	exit 1
fi

if ! command -v rustc >/dev/null 2>&1; then
	echo "==> prepare-desktop-sidecar: rustc not found; install the Rust toolchain" >&2
	echo "    (e.g. via https://rustup.rs) before building packages/desktop." >&2
	exit 1
fi

target_triple="$(rustc -vV | awk '/^host:/ { print $2 }')"
if [ -z "$target_triple" ]; then
	echo "==> prepare-desktop-sidecar: could not determine host target triple from 'rustc -vV'" >&2
	exit 1
fi

binaries_dir="packages/desktop/src-tauri/binaries"
mkdir -p "$binaries_dir"

echo "==> prepare-desktop-sidecar: staging skillmaker-${target_triple}"
cp dist/skillmaker "$binaries_dir/skillmaker-${target_triple}"
chmod +x "$binaries_dir/skillmaker-${target_triple}"

echo "==> prepare-desktop-sidecar: staging viewer-dist/"
rm -rf "$binaries_dir/viewer-dist"
cp -r dist/viewer-dist "$binaries_dir/viewer-dist"

echo "==> prepare-desktop-sidecar: done"
echo "    $binaries_dir/skillmaker-${target_triple}"
echo "    $binaries_dir/viewer-dist/"
