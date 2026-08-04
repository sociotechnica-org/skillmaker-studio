# Implement

Implement the plan under `docs/proposals/` named by the scope stage.
Package-local README/guidance files own workflow and testing for the
packages you touch.

Rules:

- Stay scoped to the plan and its package boundaries: domain logic and
  schemas in `packages/core`, deterministic CLI/server behavior in
  `packages/cli` (data on stdout, diagnostics on stderr, stable exit
  codes, black-box tests for behavior), browser UI state in
  `packages/viewer`. If the plan cannot be implemented coherently
  without expanding scope, implement the smallest coherent slice and
  leave a clear blocking note in your final response.
- Do not freehand-edit `docs/library` (the live product context
  library) unless the plan explicitly owns a library migration.
- Comments in the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings, the way
  `packages/core/src/Todo.ts` does.
- If you are here after a gate failure or a ReviewJudge fix verdict,
  read that stage's output from context and fix exactly what it names.
  Retries are capped in the graph, so make the fix count.

Gates. Before finishing, run and pass ALL of:

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

A script node reruns the same gates right after this stage; a failure
routes straight back here. Summarize the implemented changes at the end.
