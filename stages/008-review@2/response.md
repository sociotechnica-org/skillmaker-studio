Review complete: ready for PR.

The change is tightly scoped to the viewer theme token, its focused regression test, the approved brand-library migration, and the run’s proposal record. There are no changes under `packages/core`, `packages/cli`, or `test/e2e`; `SkillPage.tsx` and `Markdown.tsx` remain untouched.

`--color-well` now has exactly one light declaration and one documented dark override in [global.css](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.css:49) and [global.css](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.css:295). The cited comment explains the historical and visual rationale rather than restating the declaration. The focused test covers declaration counts/values, all four existing consumer sites, and the relevant contrast contracts in [global.test.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.test.ts:75). The documentation migration accurately records the app-only `well` token and its updated verification provenance in [Reference - Brand Palette.md](/home/daytona/workspace/skillmaker-studio/docs/library/brand/Reference%20-%20Brand%20Palette.md:24).

Verification:

- `bun test packages/viewer/src/styles/global.test.ts` — 3 passing
- `bun run --filter @skillmaker/viewer check` — 0 errors; 6 pre-existing hints
- Prior gate output is understood: full package/e2e suites and viewer build passed; the 16 e2e skips are suite-configured real-adapter skips, not failures.
- `git diff --check` passed and the worktree is clean.

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```