# Review

Review the implementation as if preparing a pull request.

Check:

- The diff stays within the requested Skillmaker Studio scope and the
  plan's named package boundaries: domain logic and schemas in
  `packages/core`, deterministic CLI/server behavior in `packages/cli`,
  browser UI in `packages/viewer`.
- CLI changes have black-box tests for behavior, exit codes, and
  important output fields; server-surface changes have `test/e2e`
  coverage.
- Viewer changes build (`bun run build:viewer` ran in validation).
- Comments follow the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings (see
  `packages/core/src/Todo.ts` for the standard). Flag comments that
  merely restate the code, and new non-obvious decisions left
  uncommented or uncited.
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- Validation output from the gates node is understood and any failures
  are actionable.

Do not make implementation, prompt, config, or test edits in this stage.
If a change is required, route back to implementation with enough context
for the next implement stage to make the fix.

If the implementation is not ready, be concrete about the remaining
blocking work so the next implementation stage has actionable context.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```
