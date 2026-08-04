**ready** — the change is mergeable and matches the approved scope.

The implementation threads the actual installed-helper list through both fresh-preamble paths, conditionally names only installed slugs, omits the line for an empty list, and leaves reorientation, sentinel, separator, and unrelated preamble content unchanged. Unit and E2E coverage exercise present, absent, partial-install, first-message, and agent-first cases. Changes stay within the planned CLI/server and test boundaries; no `docs/library` files changed. The final deterministic gates passed.

Imperfections to note in the PR body:

- An existing `sendMessage` comment still describes the full preamble as containing a “william pointer,” although that pointer is now conditional.
- The unchanged reorientation builder is tested with an empty helper list, but there is no explicit non-empty-list assertion that helpers remain omitted from reorientation.

{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}