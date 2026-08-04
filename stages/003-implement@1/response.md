Implemented Issue #192.

- Moved the intended `--color-well: #1b150d` from the clobbered light-theme declaration into `.dark`, while preserving the light value `#f6eee0` in [global.css](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.css:49).
- Added [global.test.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.test.ts:1), covering exact token declaration counts and values, all four `well` consumers, dark/light contrast contracts, and Markdown/code-theme pairings.
- Documented `well`, its role, both values, and canonical token name in [Reference - Brand Palette.md](/home/daytona/workspace/skillmaker-studio/docs/library/brand/Reference%20-%20Brand%20Palette.md:24).
- Left `SkillPage.tsx` and `Markdown.tsx` unchanged.

Validation passed using the repository-pinned Bun 1.3.11:

- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages` — 1063 passed
- `bun run build:viewer`
- `bun test test/e2e --timeout 30000` — 370 passed, 16 expected skips

Note: the system-default Bun 1.3.6 fails an unrelated `fs.watch` test; the repo pins Bun 1.3.11, which passes the full suite unchanged.