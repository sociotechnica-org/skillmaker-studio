**ready** — the change is mergeable.

The implementation matches the approved scope and Issue #190’s behavior: per-slug workspace precedence, packaged fallback, source-aware results, stale replacement, unresolved preservation, and slug-only preamble projection. CLI unit coverage and server/distribution E2E coverage are present; station and permission behavior remain untouched. No `docs/library` files changed, the worktree is clean, and the final deterministic gates passed.

Imperfections to note in the PR body:

- Workspace resolution without any packaged directory is not tested separately; the stronger conflicting-copy test verifies workspace precedence.
- The unresolved-source test covers `prepareAgentHome` preservation and non-throw behavior, but does not start a full chat session with both sources unavailable. Existing empty-helper preamble coverage and the unchanged session path make this low risk.

{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}