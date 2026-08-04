I’ll prepare the PR title and reviewer context with the completed validation results and the review notes carried forward verbatim.I can’t write to the filesystem in this environment. The requested files should contain:

`/tmp/fabro-pr-title.txt`
```text
fix(cli): make chat helper preamble reflect installed skills
```

`/tmp/fabro-pr-body.md`
```md
## Summary

Implements the honest chat-helper preamble plan in
[`docs/proposals/2026-08-04-honest-chat-helper-preamble.md`](docs/proposals/2026-08-04-honest-chat-helper-preamble.md).

`prepareAgentHome`'s `installedHelpers` result is now retained and passed to
both fresh full-preamble paths. The guidance-skills bullet:

- appears only when one or more helpers were actually installed;
- names only the installed helper slugs, in returned order; and
- is omitted entirely when no helpers installed.

The re-orientation preamble, `PREAMBLE_SENTINEL`, separator, and unrelated
preamble content remain unchanged. Tests cover helpers present, absent, and
partially installed, including first-message and agent-first session paths.

## Validation

- Passed: `bunx tsc --noEmit -p packages/core`
- Passed: `bunx tsc --noEmit -p packages/cli`
- Passed: focused chat-preamble tests (23 tests)
- Passed: focused chat-session E2E tests (8 tests)
- Passed: `bun test packages` in the final `fabro-validate` gate
- Passed: `bun test test/e2e --timeout 30000` in the final gate
  (370 passed, 16 expected skips)
- The viewer did not change, so the final validation gate skipped the viewer
  build. `bun run build:viewer` was also run during implementation and passed.

An earlier implementation-stage `bun test packages` run encountered an existing
`JournalWatcher.test.ts` debounce timeout; the final validation rerun passed all
repo gates.

## Imperfections to note

- An existing `sendMessage` comment still describes the full preamble as containing a “william pointer,” although that pointer is now conditional.
- The unchanged reorientation builder is tested with an empty helper list, but there is no explicit non-empty-list assertion that helpers remain omitted from reorientation.

## Remaining risks / follow-up

No remaining failing validation checks. The stale `sendMessage` comment and the
missing explicit non-empty-helper re-orientation assertion are documented above;
neither changes runtime behavior for this issue.
```