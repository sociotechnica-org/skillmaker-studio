Implemented Issue #190.

- [`ChatSessions.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/src/server/ChatSessions.ts:156) now resolves each William helper workspace-first, then falls back to `locatePackagedSkillsDir()`. Installed helpers report `{ slug, source }`; session preambles still receive only slug strings.
- Added deterministic agent-home coverage in [`ChatAgentHome.test.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatAgentHome.test.ts:1): packaged-only, workspace precedence, mixed sources, neither/preserve, idempotency, and stale replacement.
- Updated the chat E2E to use a fresh workspace and verify packaged helpers enter only the agent home, not workspace bundles/Board data.
- Updated the compiled-distribution E2E to copy and verify `packaged-skills/`; it passes against a freshly built distribution.

Validation:

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: `bun test packages/cli/test/ChatAgentHome.test.ts`
- Passed: `bun test test/e2e/chat-sessions.e2e.test.ts --timeout 30000`
- Passed: `bun test test/e2e --timeout 30000`
- Passed: `bun run build:dist && bun test test/e2e/dist.e2e.test.ts --timeout 30000`
- Passed: `git diff --check`

One required gate remains externally blocked: `bun test packages` consistently has 1068 passing tests and one failure in the untouched [`JournalWatcher.test.ts`](/home/daytona/workspace/skillmaker-studio/packages/cli/test/JournalWatcher.test.ts:34), whose existing-file append watch callback never fires in this environment. I reran that test and the full package suite; the same unrelated failure reproduced.