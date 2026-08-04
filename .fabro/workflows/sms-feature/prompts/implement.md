# Implement

Implement the Skillmaker Studio feature plan.

Before editing files:

- Read the plan under `docs/proposals/` named by the scope stage.
- Read package-local README and guidance files for every package or
  surface touched by the plan; treat that guidance as owning
  implementation workflow, tests, and validation for the touched package.

Work rules:

- Stay scoped to the plan, its named package boundaries, and directly
  necessary shared configuration.
- Do not freehand-edit `docs/library`; it is the live product context
  library. Only touch that path when the approved plan explicitly owns a
  library migration.
- Do not broaden the plan during implementation. If the planned slice
  cannot be implemented coherently without expanding scope, implement the
  smallest coherent planned slice if possible; otherwise leave a clear
  blocking note in the final response for review/human intervention. Do
  not turn the stage into plan-only work.
- Keep domain logic and schemas in `packages/core` (Effect-first, schema
  changes ripple from here). When changing `packages/cli`, keep command
  data on stdout and diagnostics on stderr, preserve stable exit codes,
  and add or update black-box tests for CLI behavior. When changing
  `packages/viewer`, keep browser UI state in viewer-owned
  components/helpers.
- Write comments in the house style: plain English prose that explains
  WHY the code is shaped this way (not what it does) and cites its
  sources — issue numbers, dated proposals, rulings — the way
  `packages/core/src/Todo.ts` does. New non-obvious decisions get a
  comment that names the plan or ruling that made them.
- If this stage is reached after a validation failure, inspect the
  validation output from the prior stage and fix the smallest relevant
  issue.

Full gates. Before finishing, run and pass ALL of:

```bash
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun test test/e2e --timeout 30000
```

AND, whenever the diff touches `packages/viewer`:

```bash
bun run build:viewer
```

Do not hand off with any gate failing or skipped; a script node reruns
the same gates right after this stage and a failure routes straight back
here.

Before finishing, inspect `git diff --stat` and summarize the implemented
changes.
