---
bundle: skillmaker-dev-release
---
# Design — Skillmaker Dev Release

## Intent

Skillmaker Studio releases itself through `.github/workflows/release.yml`
(tag-triggered) plus `scripts/build-dist.sh` and
`scripts/build-npm-packages.sh`. The process has already bitten us twice
(v0.3.0: #124 missing version bump, #125 `npm publish pkgs/name` parsed as
GitHub shorthand), so the workflow deserves to be a skill the maintainer —
human or agent — can follow without re-deriving it from the YAML each time.

This is the repo's first process-skill: the product's own release process
managed as a Skill Bundle, dogfooding the bundle → published-skill model.

## Sources of truth

Every claim in `output/SKILL.md` was read directly from:

- `.github/workflows/release.yml` (trigger, jobs, publish order, the #125
  cd fix and its comment)
- `scripts/build-dist.sh` (dist/VERSION derivation from root package.json)
- `scripts/build-npm-packages.sh` (version stamping from the tag; templates
  stay `0.0.0`)
- `npm/*/package.json` (wrapper + platform package templates)
- `docs/proposals/2026-07-20-install-simplification.md` (the ruled design)
- git history / `gh` for the v0.3.0 release: commits #123–#125, the failed
  tag run 29789655443 (both attempts), and npm publish timestamps.

The SKILL.md marks which steps were verified by executing a real release
(v0.4.0) versus inferred from reading the machinery.

## When to use

A maintainer (or agent acting as one) is asked to cut a new release of
skillmaker-studio to GitHub Releases and npm.

## Published location

`.claude/skills/skillmaker-dev-release/SKILL.md` (project-scoped skill,
copied from this bundle's `output/SKILL.md`; the bundle is source of truth).
