One documentation correction is needed before this is PR-ready:

- [Reference - Brand Palette.md](/home/daytona/workspace/skillmaker-studio/docs/library/brand/Reference%20-%20Brand%20Palette.md:79) still says it was verified against viewer CSS lines 24–139 on 2026-07-17. The migration now documents dark `well` (`#1b150d`), which is at [global.css](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.css:297) and was introduced later. Update the verification/source note so the new dark-token claim has accurate provenance.

Everything else is appropriately scoped: no Core/CLI changes, the approved library migration is narrow, `SkillPage.tsx` and `Markdown.tsx` remain unchanged, token declarations and all four consumers are covered, and the cited full gates passed. I also reran the focused test (3 passing) and viewer check (0 errors; only pre-existing hints).

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```