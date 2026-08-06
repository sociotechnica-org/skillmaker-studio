I’ll prepare concise PR-ready title and reviewer context, including the validation history and the review notes verbatim.`/tmp/fabro-pr-title.txt`
```text
fix(chat): seed packaged William helpers into agent home
```

`/tmp/fabro-pr-body.md`
```md
## Summary

Implements Issue #190 following [`docs/proposals/2026-08-06-chat-agent-home-packaged-helper-fallback.md`](docs/proposals/2026-08-06-chat-agent-home-packaged-helper-fallback.md).

`prepareAgentHome` now resolves each William helper independently:

1. workspace `output/SKILL.md`
2. workspace root `SKILL.md`
3. packaged `output/SKILL.md`
4. packaged root `SKILL.md`

Workspace copies retain precedence. Packaged copies are seeded only into the provider agent home and are not written into the workspace, Board, bundle listing, or index. Installed helper results now include the resolved source (`workspace` or `packaged`), while session preambles continue to receive helper slugs only.

Added coverage for packaged-only, workspace-only precedence, mixed sources, unresolved preservation, repeat-call idempotency, stale-destination replacement, fresh-workspace chat behavior, and compiled-distribution packaged-skills layout.

## Validation

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: `bun test packages/cli/test/ChatAgentHome.test.ts`
- Passed: `bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000`
- Passed: `bun test test/e2e --timeout 30000`
- Passed: `bun run build:dist && bun test test/e2e/dist.e2e.test.ts --timeout 30000`
- Passed: `./.fabro/scripts/fabro-validate` — all repository gates passed; E2E reported 376 passing, 9 expected real-provider skips, and 0 failures.
- Passed: `git diff --check`
- `bun run build:viewer` was not run because no viewer files changed.

An earlier direct `bun test packages` run had 1068 passing tests and one failure in the untouched `JournalWatcher.test.ts`, where an existing-file append watch callback did not fire in this environment. The final repository validation completed successfully.

## Review notes / known gaps

- Workspace resolution without any packaged directory is not tested separately; the stronger conflicting-copy test verifies workspace precedence.
- The unresolved-source test covers `prepareAgentHome` preservation and non-throw behavior, but does not start a full chat session with both sources unavailable. Existing empty-helper preamble coverage and the unchanged session path make this low risk.

Real ACP-provider E2E tests remain skipped unless their corresponding environment flags are enabled.
```