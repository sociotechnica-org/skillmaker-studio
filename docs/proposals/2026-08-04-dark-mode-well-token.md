# Dark-Mode Well Token

*Implementation plan — 2026-08-04. Run
`01KZ6YKAKGKPFD70772920JR9J`; addresses GitHub issue #192.*

## Status

Ready for implementation. This is a viewer theme-token correction, one
focused regression test, and a narrowly owned brand-library migration. It
does not change component markup, Markdown styling, application state, core,
CLI, or server behavior.

## Outcome

The skill page's folder tabs and tab-content well will keep
`--color-well: #f6eee0` in light mode and use the already-authored
`#1b150d` value in dark mode. Moving that night value from a clobbered
declaration in `@theme` into `.dark` restores the token-flipping contract:
the active tab, full tab-content surface, idle-tab hover, and version-menu-row
hover all theme together without component-specific `dark:` utilities or
hardcoded text colors.

At the fixed values, the reported dark-mode pairings become:

| Pair | Contrast after the fix |
| --- | ---: |
| Markdown h1/h2 (`#f1e6d3`) on well | 14.66:1 |
| Active-tab ink (`#ece3d2`) on well | 14.22:1 |
| Markdown body (`#d5c3a3`) on well | 10.49:1 |
| Muted ink (`#b6a988`) on well | 7.78:1 |

Light mode remains `#2c2416` on `#f6eee0` for the active tab, 13.29:1.

## Verified current state

The repository confirms the defect and the minimal correction:

- `packages/viewer/src/styles/global.css` declares
  `--color-well: #1b150d` and then immediately clobbers it with
  `--color-well: #f6eee0` in `@theme`. The `.dark` block overrides the
  neighboring surface and ink tokens but has no `well` declaration.
- `packages/viewer/src/app/next/SkillPage.tsx` has exactly four `well`
  utility sites: active-tab `bg-well`, idle-tab `hover:bg-well/70`, the
  full tab-content `bg-well`, and version-menu-row `hover:bg-well`.
- `packages/viewer/src/app/components/Markdown.tsx` deliberately leaves the
  neutral ramp unflipped and selects light neutral text plus dark code
  grounds with explicit `dark:` variants. Those classes are internally
  legible on the intended night well and must not be retuned.
- Overview and Research render Markdown directly on the well. Eval can
  render Markdown, but that run-detail pane has its own `bg-surface`;
  Publish uses ordinary JSX text. All four tab bodies still live within the
  common well, so each tab remains part of the manual visual check.
- `docs/library/brand/Reference - Brand Palette.md` predates the `well`
  token and lists neither its role nor its light/dark values.
- No existing test covers the CSS token or its four consumers. The current
  viewer suite passes: 260 tests across 22 files.

The code also corrects three details in the issue report that should not be
carried into implementation:

- `#1b150d` is slightly **lighter** than dark canvas `#16110a`, and sits
  between canvas and paper `#1d1610`; it is not darker than canvas.
- The `.dark` block existed before `b6a2424`; that commit reworked the
  current dark-mode implementation. Commit `35c419a` later introduced both
  `well` declarations together, including the dead night value.
- Markdown is not rendered directly on the well by Research, Eval, and
  Publish as a group. The direct cases are Overview and Research, with the
  Eval and Publish distinctions described above.

These corrections do not change the requested fix.

## Implementation contract

1. In `packages/viewer/src/styles/global.css`, delete the dead
   `--color-well: #1b150d` declaration from `@theme`, leaving the existing
   light value declared exactly once.
2. Add `--color-well: #1b150d` exactly once beside the other surface tokens
   in `.dark`. Its comment should explain that issue #192 restores the night
   value introduced with the folder tabs in #170, and should describe the
   value as slightly above/lighter than dark canvas.
3. Do not edit `packages/viewer/src/app/next/SkillPage.tsx` or
   `packages/viewer/src/app/components/Markdown.tsx`. Theme behavior must
   continue to flow solely through the token.
4. Add focused automated coverage for the token, contrast contract, and all
   four existing consumer sites without introducing a browser-test
   dependency.
5. Migrate the live brand reference narrowly: add `well` with its tabbed
   section role, light value `#f6eee0`, and dark value `#1b150d`, and include
   `--color-well` in the canonical-token list. No other library
   reconciliation is part of this change.

## Files and ownership

### Viewer stylesheet

- Modify `packages/viewer/src/styles/global.css`.

This is the only production-code edit.

### Viewer regression test

- Add `packages/viewer/src/styles/global.test.ts`.

Keep the test beside the stylesheet because it protects the stylesheet and
component-source contract, not the stored-theme selection logic in
`next/theme.test.ts`.

The test may use `bun:test`, `readFileSync`, and `import.meta.dir`; no new
runtime or test dependency is needed. It should:

1. Isolate the `@theme` and `.dark` blocks and assert that `--color-well`
   appears exactly once in each and exactly twice in the stylesheet.
2. Assert the exact values: `#f6eee0` for the base/light block and
   `#1b150d` for `.dark`. This directly guards both the dark fix and
   pixel-identical light mode.
3. Read `SkillPage.tsx`, tokenize the relevant quoted class strings, and
   assert the four semantic arrangements:
   - active tab has `bg-well` with `text-ink`;
   - idle tab has `bg-canvas`, `text-ink-muted`,
     `hover:bg-well/70`, and `hover:text-ink`;
   - the full-bleed tab-content container has `bg-well`;
   - the version-menu row has `hover:bg-well`.
4. Assert there are exactly four `bg-well`/`hover:bg-well` utility sites and
   that these class arrangements do not acquire a `dark:bg-*` override or an
   arbitrary hardcoded background/text color. Use token-set predicates
   rather than whole class-string snapshots so layout-only class changes do
   not make the test brittle.
5. Resolve the relevant base and `.dark` color declarations and use a small
   test-local WCAG relative-luminance helper to cover both themes:
   - active-tab `ink` on `well` is at least 7:1;
   - tab-content h1/h2 and body colors meet at least 7:1, and `ink-muted`
     meets at least 4.5:1, on `well`;
   - idle-hover `ink` is at least 7:1 after compositing 70% `well` over
     `canvas`;
   - selected and unselected version-row text meet 7:1 and 4.5:1
     respectively on the opaque well hover;
   - inline and fenced code text remains at least 7:1 against its
     light/dark code background.

The exact-value checks catch the reported cascade failure. The contrast
checks preserve the accessibility reason those values matter, while the
source assertions ensure all four surfaces continue to participate in the
same two-theme token contract.

### Brand-library migration

- Modify `docs/library/brand/Reference - Brand Palette.md`.

This plan explicitly owns only the `well` migration requested by issue #192:
add one core-surface row containing the role and both theme values, and add
the token to the canonical-token list. Preserve the card's frontmatter,
links, status, cross-surface reconciliation notes, and all unrelated palette
wording.

### Read-only verification surfaces

- `packages/viewer/src/app/next/SkillPage.tsx`
- `packages/viewer/src/app/components/Markdown.tsx`
- `packages/viewer/src/app/next/EvalsSection.tsx`
- `packages/viewer/src/pages/index.astro`

These establish the consumer, Markdown, nested-surface, and inherited-ink
contracts. They are not implementation targets.

## Implementation sequence

1. Add the regression test against the current files and confirm it fails
   because `@theme` has two `well` declarations and `.dark` has none.
2. Move the dead night value into `.dark`, preserving the one light value in
   `@theme`; rerun the focused test.
3. Apply the narrow brand-library migration and verify the documented
   values exactly match the stylesheet.
4. Run viewer tests and static/build validation.
5. Perform the two-theme browser pass described below, then run the
   repository gates.

## Visual verification

Use a real bundle with populated `research/notes.md` containing headings,
paragraphs, inline code, and fenced code. In both light and dark mode:

- inspect the active tab and each idle tab's hover state;
- inspect Overview and Research Markdown on the well;
- inspect Eval's content, noting that run-detail Markdown remains on its
  nested `surface`;
- inspect Publish's primary and muted ordinary text;
- open the version menu and inspect selected and unselected row hover states;
- confirm inline and fenced code read as intentional inset/raised elements;
- confirm the well remains visually distinct from canvas, paper, and surface.

Light mode should show no visual change. Dark mode should show a continuous
night surface with readable active-state, primary, muted, and Markdown text.

The repository has no Playwright, DOM, or visual-regression harness.
Introducing one for this CSS-token correction would expand scope
substantially, so browser-computed hover behavior and pixel identity remain a
manual check; the Bun contract test and viewer build provide the durable
automated layer.

## Validation commands

Fast feedback:

```sh
bun test packages/viewer/src/styles/global.test.ts
bun test packages/viewer
bun run --filter @skillmaker/viewer check
bun run build:viewer
```

Repository gates:

```sh
bunx tsc --noEmit -p packages/core
bunx tsc --noEmit -p packages/cli
bun test packages
bun run build:viewer
bun test test/e2e --timeout 30000
```

No CLI/server behavior changes, so no new black-box e2e case is required.

## Acceptance criteria

- [ ] `--color-well` is declared exactly once in `@theme` as `#f6eee0`.
- [ ] `--color-well` is declared exactly once in `.dark` as `#1b150d`.
- [ ] Dark active-tab ink on well is at least 7:1; the expected ratio is
      14.22:1.
- [ ] Dark muted ink on well is at least 4.5:1; the expected ratio is
      7.78:1.
- [ ] Dark Markdown h1/h2 and body text on well are at least 7:1; expected
      ratios are 14.66:1 and 10.49:1.
- [ ] Inline and fenced code retain legible text and read as intentional
      dark-theme elements within the corrected night surface.
- [ ] Idle-tab and version-menu-row hover states are legible in both themes.
- [ ] Automated coverage protects both theme values and all four existing
      token-consumer sites.
- [ ] Light mode keeps the existing well value and is visually unchanged
      across the active tab, idle tabs, content surface, and menu-row hover.
- [ ] `SkillPage.tsx` and `Markdown.tsx` have no diff.
- [ ] Canvas, surface, paper, border, the neutral ramp, and all other palette
      tokens are unchanged.
- [ ] The brand palette reference lists `well`, both values, its role, and
      its canonical token name.
- [ ] Viewer tests, viewer check/build, and repository gates pass.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A later duplicate silently wins by cascade order again. | Assert declaration counts per block and across the complete stylesheet, not only the effective value. |
| A component masks the token with a local dark utility or literal color. | Protect the four token-based class arrangements and reject local dark/hardcoded color overrides in the focused test. |
| Source-level consumer assertions become noisy after harmless class reordering. | Compare whitespace-delimited class token sets and semantic predicates, not full strings or snapshots. |
| Unit tests do not execute browser hover/computed-style behavior. | Build the Tailwind/Astro viewer and complete the explicit two-theme browser pass; defer browser infrastructure rather than adding it ad hoc. |
| The live brand card contains older cross-surface reconciliation questions. | Make only the explicitly owned `well` row/list migration; do not broaden this accessibility fix into a palette rewrite. |

## Deferred follow-ups

- The active tab's `border-neutral-900/50` may become visually quiet on the
  corrected dark well. It is cosmetic and remains a separate issue because
  changing it would revisit the deliberately unflipped neutral ramp.
- Automated screenshot and interaction testing can be considered as a
  repository-wide viewer-testing investment, not introduced solely for
  issue #192.
- The older brand-reference reconciliation notes and marketing-site
  crosswalk remain outside this token correction.

## Open questions

None. The intended night value, consumer contract, documentation migration,
and verification thresholds are all recoverable from the current code and
the commit that introduced the folder tabs.
