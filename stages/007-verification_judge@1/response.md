Verification is sufficient.

- All required repo gates passed on the implementation: core and CLI typechecks, `bun test packages`, and the full E2E suite with 370 passing and 0 failures. No viewer files changed, so `build:viewer` was correctly skipped.
- The authored page matches the scoped plan: the current install door leads, remembered audiences, `--version`, `--json`, provenance stamps, journal receipts, stage guards, no-op behavior, and adopted in-place behavior are covered. The legacy configured-target door and required cross-links remain intact.
- Independent verification included the docs check and build, rendered-page and anchor assertions, focused publish-door E2E tests, source-contract inspection, and a realistic throwaway workspace exercising user installation, JSON output, stamping, journaling, audience memory, and idempotent republishing.
- Generated documentation changes existed before verification and the before/final status inventories match. Verification added no tracked implementation changes outside `verification-artifacts/`.
- Screenshots were unnecessary for this static documentation change; built-page assertions provide appropriate evidence.

{"preferred_next_label":"Verified","context_updates":{"verification_ready":true,"verification_route":"handoff"}}