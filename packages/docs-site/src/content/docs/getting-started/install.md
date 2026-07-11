---
title: Install
description: One-line install for macOS arm64 and Linux x64, or build from source.
---

## One-command install

```sh
curl -fsSL https://skillmaker.studio/install.sh | sh
```

This detects your OS/arch, downloads the matching release tarball from the
latest GitHub Release (`sociotechnica-org/skillmaker-studio`), and installs
`skillmaker` (plus the viewer assets it needs) to `~/.skillmaker/bin`.
Re-run the same command to upgrade. Supported platforms today: macOS arm64
and Linux x64. macOS x64 (Intel) and Linux arm64 are fast-follows.

## Installing from source

Building from a checkout works on any platform bun supports, and is the
right path if you want to hack on Skillmaker Studio itself.

### Prerequisites

- [bun](https://bun.sh) — the CLI runs directly under bun, no build step
  required for local use.
- [git](https://git-scm.com/) — Skillmaker Studio's journal is git-tracked,
  and every workspace it manages must be a git repo.
- If you use [asdf](https://asdf-vm.com/) to manage `bun`, note that asdf
  refuses a bare `bun` invocation in a directory without a `.tool-versions`
  file. If `bun --version` fails with an asdf resolution error, set:

  ```sh
  export ASDF_BUN_VERSION=1.3.11
  ```

  (The Skillmaker Studio repo itself carries a `.tool-versions` file, so
  this only matters when you run the CLI from *outside* the repo checkout —
  which is exactly what the next page does.)

### Clone and build

```sh
git clone https://github.com/sociotechnica-org/skillmaker-studio.git
cd skillmaker-studio
bun install
bun run build:viewer   # required once before `skillmaker start` works
```

`bun install` also clones a research copy of the Effect source
(`.repos/effect`) used for reference; skip it with `SKIP_EFFECT_CLONE=1` if
you don't need it.

### Running the CLI from the checkout

The CLI's entry point is `packages/cli/src/main.ts`, and bun runs TypeScript
directly — no compile step:

```sh
bun packages/cli/src/main.ts --help
```

That's the exact invocation this guide uses everywhere below. In a real
shell it's worth a short alias so the rest of this guide (and the CLI
Reference) reads naturally as `skillmaker <command>`:

```sh
alias skillmaker="bun /path/to/skillmaker-studio/packages/cli/src/main.ts"
```

### Optional: compile a single binary

Skillmaker Studio can also compile to one self-contained executable (no
`bun`, no repo checkout, no `node_modules` needed on the target machine —
`bun build --compile` embeds the runtime):

```sh
bun run build:dist
# produces dist/skillmaker (the binary) and dist/viewer-dist/ (must stay
# siblings — see docs/dist.md in the repo for the full artifact story)
```

Copy both to somewhere on `PATH` and `skillmaker` works exactly like the
`bun packages/cli/src/main.ts` invocation above, from any directory.

## Next: create your first Skill Bundle

Continue to [Your first Skill Bundle](/getting-started/first-bundle/) —
it walks `init` → `new` → `start` in a brand-new directory with real CLI
output.
