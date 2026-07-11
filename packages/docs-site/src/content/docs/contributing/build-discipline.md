---
title: Build discipline
description: XP build principles and the standing verification harness.
---

Skillmaker Studio itself is built XP-style, phase by phase: always working
software, one small testable unit of value per phase, and every phase
verified against the **real thing** — real CLI commands, a real browser
against the real viewer, real runs in a dedicated test workspace — never
mocked end-to-end.

## Principles

- **Always working software.** Each phase ships as its own PR(s), with
  build → review → test → ship completing before the next phase begins.
- **One small, testable unit of value per phase.** See the build plan
  (linked from the [Roadmap](/roadmap/)) for the phase list — each phase's
  scope and verify recipe is written down before it starts.
- **Verify against the real thing.** Not just unit tests: a scripted e2e
  suite drives the *compiled* CLI against a temp workspace
  (`bun test:e2e`), and every phase's PR description carries a real-thing
  verification section with actual command output — not a description of
  what should happen.
- **Fresh-install discipline.** Every phase's QA starts from `skillmaker
  init` in a brand-new directory at least once, so first-run experience and
  migration debt surface immediately instead of accumulating silently in a
  long-lived test workspace. This docs site's own
  [getting-started walkthrough](/getting-started/first-bundle/) was
  produced exactly that way — run verbatim in a fresh directory while
  writing the page, with real output pasted in.

## Test workspace pattern

QA for CLI/viewer changes runs in a **separate scratch git repo** with a
studio installed via `skillmaker init` — never inside the product repo
itself. This keeps the product repo's own self-hosted workspace
(`skills/`, `.skillmaker/`) as real dogfooded history, not a dumping ground
for throwaway QA bundles.

## Local development

```sh
bun install               # also clones the Effect research repo (skip: SKIP_EFFECT_CLONE=1)
bun test packages         # unit tests
bun run build:viewer      # build the viewer (required before start / e2e)
bun run test:e2e          # e2e against the real CLI
bun packages/cli/src/main.ts --help
```

For the docs site specifically:

```sh
bun run build:docs        # from the repo root -- astro build for packages/docs-site
bun run --filter @skillmaker/docs-site dev       # live-reload dev server
bun run --filter @skillmaker/docs-site check      # astro check (typecheck)
```

CI runs typecheck, unit tests, viewer build, and e2e on every PR.

## Standing conventions

- Effect idioms: services via `Context.Service` + `Layer` factories,
  `Effect.fn` for logic, the runtime edge confined to `main.ts`.
- No `any`, no `as` casts anywhere (`JSON.parse(...) as unknown` is the one
  allowed exception).
- Every phase PR includes a real-thing verification section with actual
  outputs, not a description of expected behavior.
- From Phase 8 on, all builder work happens in git worktrees, keeping the
  main checkout clean for QA, merges, and the build log.
