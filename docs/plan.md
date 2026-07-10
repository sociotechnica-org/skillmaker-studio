# Skillmaker Studio — Product Plan (draft)

> **Status:** discussion draft (2026-07-10). Companion to
> [`data-model.md`](data-model.md), which is the artifact under active
> discussion. This plan records the product shape and build approach.

## What it is

Skillmaker Studio is a standalone product (public repo under
`sociotechnica-org`) for designing, evaluating, and shipping **agent
skills** — SKILL.md files for Claude Code, Codex, and compatible agents —
where the skill's research, design thinking, eval fixtures, runs, and status
are the durable asset (**Skill Bundle**) and SKILL.md is an *output*.

It is the Playmaker's Studio rebuilt as real software: the governance ideas
(director judgment, proving before shipping, coverage-vs-validation honesty)
survive; the Fabro workflow machinery, derived-rendering cones, and
Alexandria org spine do not.

## Product shape

- **CLI-first, bun-native.** `skillmaker` CLI written in TypeScript with
  Effect (built per the `effect-ts` skill), `bin` → `src/cli/main.ts` (bun
  runs TS directly), distributed via `bun build --compile` single binary.
- **`skillmaker start`** serves the viewer: one `Bun.serve` on one origin
  serving the statically built Astro app (`dist/`) plus `/api/*` — SPA
  fallback, no CORS, claim-file single-instance ownership.
- **Viewer:** Astro 5 + React + Tailwind; one real Astro page, client-routed
  React; typed client boundary (fetch → schema decode → tagged errors →
  hooks), Effect confined to one runtime directory. SSE for live updates.
- **Eval engine:** drives claude-code and codex as **ACP subprocesses**
  (`@zed-industries/claude-code-acp`, `codex-acp` platform binaries —
  downloaded, pinned, and verified). A run = skill installed into a sandbox
  workspace +
  fixture task given to the agent + transcript captured + graded.
- **No Fabro in v1.** Skills are flat SKILL.md bundles; there is no workflow
  compilation, node prompts, or run projection.
- **Todo system baked in** (see data model §3.3) — the board's work-order
  cards generalized, surfaced in the viewer as the work queue.

## Viewer surfaces (v1)

1. **Board** — bundles by stage ladder, ready flags, drag-to-advance with
   gate confirm; todos panel.
2. **Bundle detail** — research / design / output tabs, drift hint,
   version history.
3. **Eval surface** — risk-map coverage × measured validation per provider,
   run launcher (case × k × provider), run read-outs with transcripts.
4. **Activity** — the journal rendered as a feed.

## Storage

Prose in files, state in SQLite, history in an append-only JSONL journal
(git-tracked, union-merge); SQLite is a rebuildable index. Full detail and
the canonical-store open question: data-model.md §2.

## Repo skeleton (proposed)

Monorepo, patterned on alexandria-internal (bun workspaces, package-local
guidance per package):

```
skillmaker-studio/          # sociotechnica-org/skillmaker-studio (public)
  packages/cli/             # skillmaker CLI (Effect, bun)
  packages/viewer/          # Astro + React + Tailwind product surface
  packages/core/            # shared domain: schemas, store, journal, eval engine
  packages/marketing-site/  # public landing site (Astro; later)
  docs/                     # product plans and design docs (data-model.md lives here)
  skills/                   # dogfood: the studio's own skills as bundles
```

## What migrates from `studio/`

- **Concepts:** production-ladder thinking, fixture kit (golden / refusal /
  empty / rerun / hard-case), risk families (IN/RE/OUT/ADV/CHN), two-axis
  honesty, measurement policy, provenance-on-everything, untrusted-input
  rule.
- **Content:** existing plays' research + briefs are candidate seed bundles
  (brief → design.md, prompts → SKILL.md drafts) — a later, manual pass.
- **Not migrating:** registry.js/board-state.json formats, Fabro packages,
  derive/lint/resync toolchain, PMS viewer components (rewrite, don't port).

## Build order (walking skeleton first)

1. **Skeleton:** CLI + `init` + one bundle on disk + SQLite index +
   `start` serving a viewer that lists bundles. Zero LLM calls.
2. **Todos + board:** state transitions, journal, board surface.
3. **Bundle authoring:** design.md → SKILL.md draft generation, versions,
   drift hint.
4. **Eval engine:** ACP run of one fixture against claude-code, transcript
   capture, human grading in viewer, measurements.
5. **Codex provider + grader agent + publish targets.**

Each brick lands with human QA before the next [per factory play-design
principles].

## Open decisions

Tracked in data-model.md §7 (canonical store, taxonomy, gates, per-target
outputs, grading, stage names). Product-level extras:

- **Name check:** "Skillmaker Studio" vs collision scan on npm/GitHub.
- **License / public-repo hygiene** for sociotechnica-org.
- **Marketplace packaging format** — track the emerging Claude skill
  marketplace conventions before hard-coding a publish target.
