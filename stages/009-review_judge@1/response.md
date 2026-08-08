**ready** — the change is mergeable and stays within the approved server/viewer scope. The resumable SSE behavior and viewer reconciliation are covered by focused tests and e2e coverage; no `docs/library` files changed, and the final deterministic gates passed.

Imperfections to note in the PR body:

- Header-validation tests use an empty manager, so malformed and out-of-range IDs are not directly exercised against a populated live buffer.
- The e2e test does not explicitly combine prefix and resumed suffix IDs for its duplicate assertion.
- The scroll-sentinel test is contract-level and somewhat tautological; it does not directly exercise `RightPanel` or guard against reintroducing an `open`-time clear. The repository has no browser/component test harness, and the production path itself is correct.

Route to Prepare PR.

{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}