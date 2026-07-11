#!/bin/sh
# Skillmaker Studio installer.
#
# Usage:
#   curl -fsSL https://skillmaker.studio/install.sh | sh
#
# Downloads the latest `skillmaker` release tarball for this machine's
# OS/arch from GitHub Releases (sociotechnica-org/skillmaker-studio),
# extracts it, and lays the binary + viewer assets out as siblings under
# ~/.skillmaker/bin/ — the layout `packages/cli/src/server/ViewerDist.ts`'s
# execPath-relative discovery expects (walks up from the running binary's
# own directory looking for a `viewer-dist/` next to it; see docs/dist.md
# "How discovery works"). Safe to re-run: each run overwrites the install
# in place, so re-running this script is how you upgrade.
#
# This script is served as static content from packages/marketing-site/
# public/install.sh — once that site deploys, it is reachable at
# https://skillmaker.studio/install.sh with no separate step.
#
# Testing hooks (not needed for normal use):
#   SKILLMAKER_INSTALL_DIR   override the install root (default: ~/.skillmaker)
#   SKILLMAKER_TARBALL_URL   fetch this URL directly instead of asking the
#                            GitHub API for the latest release (used to
#                            prove this script against a local build before
#                            any real release has been tagged)

set -eu

repo="sociotechnica-org/skillmaker-studio"
install_dir="${SKILLMAKER_INSTALL_DIR:-$HOME/.skillmaker}"
bin_dir="${install_dir}/bin"

log() {
  echo "==> $*"
}

fail() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not found on PATH"
}

detect_platform() {
  os_raw="$(uname -s)"
  arch_raw="$(uname -m)"

  case "$os_raw" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) fail "unsupported OS '$os_raw' (only Darwin and Linux are built today)" ;;
  esac

  case "$arch_raw" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) fail "unsupported CPU architecture '$arch_raw'" ;;
  esac

  platform="${os}-${arch}"

  # Match what .github/workflows/release.yml actually publishes today.
  case "$platform" in
    darwin-arm64 | linux-x64) ;;
    *)
      fail "no published skillmaker build for '$platform' yet (only darwin-arm64 and linux-x64 are published so far)"
      ;;
  esac
}

resolve_tarball_url() {
  if [ -n "${SKILLMAKER_TARBALL_URL:-}" ]; then
    tarball_url="$SKILLMAKER_TARBALL_URL"
    return
  fi

  need_cmd curl
  api_url="https://api.github.com/repos/${repo}/releases/latest"
  log "looking up the latest release ($api_url)"
  release_json="$(curl -fsSL "$api_url")" ||
    fail "could not reach the GitHub API to find the latest release"

  tarball_url="$(
    printf '%s' "$release_json" |
      grep -o "\"browser_download_url\": *\"[^\"]*${platform}\\.tar\\.gz\"" |
      head -n1 |
      sed 's/.*"\(https:[^"]*\)"/\1/'
  )"

  [ -n "$tarball_url" ] || fail "the latest release has no ${platform} tarball (yet)"
}

install_tarball() {
  need_cmd tar
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT

  archive="${work_dir}/skillmaker.tar.gz"
  log "downloading ${tarball_url}"
  case "$tarball_url" in
    file://*)
      cp "${tarball_url#file://}" "$archive"
      ;;
    *)
      need_cmd curl
      curl -fsSL "$tarball_url" -o "$archive" || fail "download failed"
      ;;
  esac

  extract_dir="${work_dir}/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$archive" -C "$extract_dir"

  [ -f "${extract_dir}/skillmaker" ] || fail "downloaded archive did not contain a 'skillmaker' binary"
  [ -d "${extract_dir}/viewer-dist" ] || fail "downloaded archive did not contain 'viewer-dist/'"

  log "installing to ${bin_dir}"
  mkdir -p "$bin_dir"
  rm -rf "${bin_dir}/viewer-dist"
  cp "${extract_dir}/skillmaker" "${bin_dir}/skillmaker"
  chmod +x "${bin_dir}/skillmaker"
  cp -r "${extract_dir}/viewer-dist" "${bin_dir}/viewer-dist"
  if [ -f "${extract_dir}/VERSION" ]; then
    cp "${extract_dir}/VERSION" "${bin_dir}/VERSION"
  fi
}

print_path_hint() {
  case ":$PATH:" in
    *":${bin_dir}:"*)
      log "installed. ${bin_dir} is already on PATH — try: skillmaker --help"
      ;;
    *)
      log "installed. Add this to your shell profile to put skillmaker on PATH:"
      echo ""
      echo "    export PATH=\"${bin_dir}:\$PATH\""
      echo ""
      log "then open a new shell and run: skillmaker --help"
      ;;
  esac
}

main() {
  detect_platform
  resolve_tarball_url
  install_tarball
  installed_version="unknown"
  if [ -f "${bin_dir}/VERSION" ]; then
    installed_version="$(cat "${bin_dir}/VERSION")"
  fi
  log "installed skillmaker ${installed_version} (${platform}) to ${bin_dir}"
  print_path_hint
}

main "$@"
