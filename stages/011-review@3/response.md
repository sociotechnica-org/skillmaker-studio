Review complete: ready for PR.

The change stays within the intended boundary: CLI chat-home behavior, focused CLI tests, and the chat-server E2E. It does not touch core station resolution, permission policy, viewer code, project discovery, or `docs/library`.

The resolver implements the required per-helper precedence and preserves the important edge cases: workspace wins over packaged, output layout wins over root layout, unresolved destinations remain untouched, and resolved destinations are replaced cleanly. The E2E verifies the default packaged locator during an actual fresh-project chat start and confirms helpers do not leak into project bundles or catalog data.

Validation evidence is sound:

- Re-ran focused direct coverage: 5/5 passing.
- Re-ran packaged-skills and station regressions: 46/46 passing.
- Recorded repository gate passed: 370 E2E tests passed, with 16 explicitly environment-gated skips.
- Working tree is clean and diff whitespace checks pass.

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```