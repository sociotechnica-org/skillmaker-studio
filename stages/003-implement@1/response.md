Implemented Issue #196 in the CLI chat-session flow.

- `prepareAgentHome`’s actual `installedHelpers` result is retained on the live session and passed to both fresh full-preamble paths.
- The guidance bullet now appears only when helpers installed, names only those slugs in returned order, and is omitted entirely when none installed.
- Re-orientation remains unchanged; sentinel and separator are unchanged.
- Extended [ChatPreamble.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatPreamble.test.ts) for helpers present, absent, partial, and byte-identical non-helper content.
- Extended [chat-sessions.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/chat-sessions.e2e.test.ts) to cover the partial real session handoff in both first-message and agent-first paths.

Validation:

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: focused preamble tests (23 tests)
- Passed: focused chat-session E2E (8 tests)
- Passed: `bun run build:viewer` (needed to make E2E server available)
- Passed: `bun test test/e2e --timeout 30000` (370 passed, 16 expected skips)

One required gate remains blocked by an unrelated, reproducible existing failure:

- `bun test packages` fails only at `packages/cli/test/JournalWatcher.test.ts`, `watchJournal > fires (debounced) on appends to an existing journal`—the callback never fires within its 3-second wait. All 1,062 other package tests passed. I left that watcher behavior untouched to keep this issue scoped.