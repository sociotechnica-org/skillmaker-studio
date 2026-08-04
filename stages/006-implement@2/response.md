Issue #192 is complete and the review finding is resolved.

- `--color-well` remains `#f6eee0` in light mode and flips to `#1b150d` in `.dark`, with focused regression coverage for both declarations, contrast contracts, and all four Skill-page consumers.
- The brand reference documents the token and now accurately distinguishes its original cross-surface verification from the Issue #192 app-only verification at [Reference - Brand Palette.md](/home/daytona/workspace/skillmaker-studio/docs/library/brand/Reference%20-%20Brand%20Palette.md:79).
- `SkillPage.tsx` and `Markdown.tsx` remain unchanged.

Validation passed using the repository-pinned Bun 1.3.11:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages` — 1063 passed
- `bun test test/e2e --timeout 30000` — 370 passed; 16 suite-configured skips
- `bun run build:viewer`

Final uncommitted review correction: 1 file, 5 additions / 3 removals.