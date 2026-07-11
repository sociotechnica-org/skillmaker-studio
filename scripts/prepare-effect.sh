#!/usr/bin/env sh

set -eu

# CI and other automated environments don't need the local research clone.
if [ "${SKIP_EFFECT_CLONE:-0}" = "1" ]; then
  exit 0
fi

repo_dir=".repos/effect"
repo_url="https://github.com/Effect-TS/effect-smol"

if [ -d "$repo_dir/.git" ]; then
  exit 0
fi

mkdir -p ".repos"
git clone "$repo_url" "$repo_dir"
