Goal: GitHub Issue #196: Chat preamble claims guidance skills are installed when seeding installed nothing

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/196

## Summary

The chat preamble tells every agent "Your guidance skills are installed in your
agent home -- read the relevant william-* skill before acting." When seeding
installed nothing, that sentence is false, and the agent does what a competent
agent should: it goes looking for the skills it was promised. `prepareAgentHome`
already returns exactly the fact needed to tell the truth — `installedHelpers` —
and the call site throws it away.

## Motivation / Problem

An instruction that names an artifact which isn't there is worse than no
instruction: it converts a missing dependency into a filesystem search. In the
live session that produced this ticket, the agent's first move was
`ls ~/.skillmaker/agent-home/claude-code/skills/`, and when that came back
empty it escalated to `find / -maxdepth 8 -type d -iname "william-*"` and a
sweep of the operator's other repos. Each of those is a path outside the
project, so each one raised a permission card.

This is a *distinct* defect from the seeding bug (#190). Fixing #190 makes the
helpers present in shipped builds — but a source checkout with no packaged
skills directory, or a future helper slug that fails to resolve, will still be
announced as installed. The preamble should assert only what is true at the
moment it is written.

## Observed behavior

Fresh project on v0.6.2, chat session started on a new bundle. The agent home
contains no `skills/` directory. The preamble nonetheless states the skills are
installed, and the session opens with a multi-command hunt across the machine
for `william-*` before any bundle work begins.

## Current shape

The claim, `packages/cli/src/server/ChatSessions.ts:324`:

```ts
    `- Your guidance skills are installed in your agent home -- read the relevant william-* skill before acting.`,
```

It is unconditional — a constant line in the preamble array, with no input from
whether seeding succeeded.

Meanwhile `prepareAgentHome` computes and returns precisely that
(`ChatSessions.ts:160`, `:179-181`):

```ts
): { readonly home: string; readonly installedHelpers: ReadonlyArray<string> } => {
```
```ts
    installed.push(slug);
  }
  return { home, installedHelpers: installed };
```

and both call sites discard it — `ChatSessions.ts:598` and `:793`:

```ts
    const { home } = prepareAgentHome(provider, this.root, this.config.skillsDir);
```

The trap worth naming: the information needed to be honest is already computed,
already returned, and already at the call site. This is not a missing capability;
it is a discarded return value.

## Proposed contract

The helper line is conditional on what actually installed:

| `installedHelpers` | Preamble line |
|---|---|
| non-empty | `- Your guidance skills (<slugs>) are installed in your agent home -- read the relevant one before acting.` |
| empty | line omitted entirely |

**Decisions:**

- When helpers installed, the line **names the slugs actually present**, so the
  agent reads what exists rather than guessing at a family name.
- When none installed, the line is **omitted**, not replaced with an apology.
  An agent told nothing about guidance skills proceeds on the bundle; an agent
  told they are "missing" may go hunting anyway.
- Partial installs name only the slugs that landed.
- `installedHelpers` is threaded to the preamble builder. `PreambleContext`
  gains a field; no other preamble line changes.
- The re-orientation preamble (`buildChatReorientation`, `ChatSessions.ts:349`)
  does not mention helpers today and does not gain a mention.
- No UI, no journal event, no warning surface. The scope is the preamble string.

## Acceptance criteria

- [ ] With helpers installed, the preamble states they are installed and names
      the installed slugs.
- [ ] With no helpers installed, the preamble contains no sentence asserting
      guidance skills are available anywhere.
- [ ] Partial install: only the slugs that actually landed are named.
- [ ] Negative: the preamble never names a slug absent from the agent home.
- [ ] Regression: every other preamble line — bundle layout, pipeline, CLI
      guidance, direct-in-project warning, and the derived-stage "current step"
      sentence — is byte-identical to today.
- [ ] Regression: `packages/cli/test/ChatPreamble.test.ts` passes, extended
      rather than rewritten.
- [ ] Regression: `PREAMBLE_SENTINEL` is unchanged — the viewer splits replayed
      first prompts on it (`chatModel.ts`).
- [ ] Tests cover: helpers-present, helpers-absent, and partial-install.

## Implementation notes

Both call sites already destructure the result; the change is to keep the second
field and pass it through. Prefer threading it into `PreambleContext` over
recomputing installation state inside the preamble builder — the builder is
deliberately synchronous and filesystem-light.

Scope fences:

- **Do not fix the seeding here.** That is #190. This issue is about the
  preamble telling the truth about whatever seeding did.
- **Do not add a user-facing warning.** A missing helper is not a condition the
  director needs a banner for.
- **Do not change `PREAMBLE_SENTINEL` or the separator** — the viewer parses on
  both.

Relevant current files, as orientation only:

- `packages/cli/src/server/ChatSessions.ts` — the claim (:324), the preamble
  builder (:320-329), `prepareAgentHome` (:156-182), call sites (:598, :793)
- `packages/cli/test/ChatPreamble.test.ts` — existing coverage

---

**Related:** #190 (packaged-skills fallback for the agent home). #190 makes the
helpers present; this makes the preamble honest when they aren't.


Implement exactly this issue. Verify every claim in the issue against the current code before acting on it; the issue is a report, not a spec — the code is the truth. Stay minimal: fix the reported defect with tests, nothing adjacent.

Run ID: 01KZ77BKMTF836C1KHDHAES1M2
Pipeline progress: 0 of 5 stages completed


# Scope

Write a durable technical implementation plan for the requested
Skillmaker Studio feature to
`docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md` (refine an
existing relevant plan instead of duplicating it). Do not edit
implementation files in this stage.

## The repository

Skillmaker Studio is a bun + Effect TypeScript monorepo (bun workspaces):

- `packages/core` — the domain engine: skills, evals, journal, todos,
  triage. Effect-first; schemas live here and everything else consumes
  them.
- `packages/cli` — the `skillmaker` CLI and the local server the Studio
  UI rides on. Command data on stdout, diagnostics on stderr, stable
  exit codes.
- `packages/viewer` — the Studio browser UI (Astro + React).
- `packages/desktop`, `packages/docs-site`, `packages/marketing-site`,
  `packages/skill` — touch these only when the goal names them.
- `test/e2e` — black-box end-to-end tests over the CLI and server
  surfaces.
- `docs/proposals/` — dated proposal/plan documents. Do not
  freehand-edit `docs/library` (the live product context library)
  unless the plan explicitly owns a library migration.

Repository gates (mirrors `.github/workflows/ci.yml`): typecheck core
and cli, `bun test packages`, `bun test test/e2e`, and
`bun run build:viewer` when the viewer changes. A script node runs these
after implementation; plan work that passes them.

House comment style — plan for it now so implementation inherits it:
comments are plain English prose that explains WHY the code is shaped
this way, not what it does, and cites sources — issue numbers, dated
proposals, rulings — the way `packages/core/src/Todo.ts` does.

## Plan expectations

- Keep work scoped to the packages and surfaces named by the goal, with
  domain logic in core, deterministic CLI/server behavior in cli,
  browser UI state in viewer.
- Include tests for changed behavior, and risks, acceptance criteria,
  and deferred follow-ups.

End your response with `Plan ready for implementation: <plan-path>` and
a brief summary; the implement stage reads the plan file from disk.
