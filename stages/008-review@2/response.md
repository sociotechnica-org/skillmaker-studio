One remaining test gap blocks PR readiness: the direct suite never puts the same helper in both the workspace and packaged locations. Its mixed test has workspace `william-research-a-skill` and packaged `william-draft-skill-md`, so it proves per-slug fallback and layout precedence, but not the acceptance-critical guarantee that a workspace helper wins over an available packaged copy.

Add a distinguishable packaged `william-research-a-skill` fixture to the mixed test, then assert the installed bytes and `source: "workspace"` still come from the workspace. This is a test-only change; the implementation’s ordered resolver already appears correct.

Everything else is properly scoped: only CLI chat seeding and tests changed; no core, permission policy, viewer, project indexing, or `docs/library` changes. The explanatory comment cites Issue #190 and the dated D6 proposal. Focused chat, packaged-skill, and station tests passed locally; the recorded repository gate also passed (370 tests, with 16 explicitly gated skips).

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```