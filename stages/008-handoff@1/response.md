I’ll prepare the PR title and reviewer-facing body from the completed implementation and verification record, including the generated-docs scope and any skipped checks.I can’t write files in this environment, but the requested PR-ready contents are:

`/tmp/fabro-pr-title.txt`
```text
docs: document the current publish install door
```

`/tmp/fabro-pr-body.md`
```md
## Summary

Updates the CLI publish reference to document the current install door shipped in v0.6.2, following `docs/proposals/2026-08-04-current-publish-door-docs.md`.

- Leads with `skillmaker publish <slug> --to user|project`, including resolved install locations and remembered per-bundle audiences in `bundle.json`.
- Documents bare re-publish behavior, snapshot publishing and revert with `--version`, and install-door `--json` output.
- Describes the `published` stage requirement, provenance stamp and evidence line, `skill.published` journal receipts, and idempotent no-op behavior.
- Documents the adopted in-place exception: the live directory remains the target, `--to` is not applicable, and `SKILL.md` is not stamped.
- Retains `skillmaker.config.json.publishTargets` and `--target` as the legacy/secondary configured-target path, including all supported target kinds.
- Keeps links to the first-bundle publish walkthrough and the Publishing and the Skillbook concept page coherent.
- Regenerates docs-site output and Pagefind assets.

## Validation

Passed:

- `bun run --filter @skillmaker/docs-site check`
- `bun run build:docs`
- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages`
- `bun test test/e2e --timeout 30000` — 370 passed, 16 skipped, 0 failed
- `git diff --check`

`bun run build:viewer` was not run because this change does not modify viewer files.

## Verification evidence

Verification also passed:

- Focused publish-door E2E coverage: `bun test test/e2e/publish-door.e2e.test.ts` — 7 passed.
- A fresh throwaway CLI session verified user installation, JSON output, provenance stamping, journal receipt creation, remembered audiences, and idempotent bare re-publish.
- Rendered-page assertions verified the generated publish page and both required cross-links.

Run evidence:

- `verification-artifacts/verification-plan.md`
- `verification-artifacts/report.md`
- `verification-artifacts/json/publish-cli-session.json`
- `verification-artifacts/json/rendered-page-assertions-passed.txt`
- `verification-artifacts/cli/publish-door-e2e.txt`
- `verification-artifacts/cli/docs-build.txt`

## Notes and remaining gaps

- This is documentation and generated-site output only; it does not change publish behavior.
- The docs build updates generated `packages/docs-site/dist/` and Pagefind output. Verification notes that some generated `dist/` changes existed before verification; no additional tracked implementation changes were introduced by verification.
- Conditional distributed-binary and real ACP adapter E2E cases remain skipped when their required environment flags or dependencies are unavailable.
- The existing CLI discovery limitation for adopted bundles outside the workspace skills directory is not changed by this documentation update. The documented in-place behavior applies when the bundle is resolved as in-place.
```