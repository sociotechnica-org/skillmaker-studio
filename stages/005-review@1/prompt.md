Goal: GitHub Issue #192: Dark mode: --color-well has no night value — the whole tabbed surface renders dark-mode ink on a light ground (1.07:1)

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/192

## Summary

`--color-well` — the ground for the skill page's folder tabs and the entire
tabbed content surface — is the one brand surface token with no dark-mode value.
At night the tab and its content panel keep painting light parchment `#f6eee0`
while everything drawn on them switches to dark-mode inks. The active tab's
label renders at **1.11:1**; rendered Markdown on the same surface is worse —
headings at **1.07:1**, body copy at **1.50:1** — so the Research, Eval, and
Publish tab content is effectively invisible, styled as though it were on a
black background while the ground stays cream. The intended dark value is
already in the file as a dead declaration. Restore it in the `.dark` block.

## Motivation / Problem

The active tab tells you where you are in the skill page. In dark mode you
cannot read it, so the primary navigation of the product's main surface has no
visible current-state indicator. The body copy on the same surface is affected
too — `ink-muted` on `well` measures **2.02:1** at night — so the whole tabbed
region reads as washed out, not just the tab label.

Light mode is unaffected and correct (`#2c2416` on `#f6eee0` = **13.3:1**); this
is a dark-mode-only defect.

The tempting fix is to hardcode a dark text colour on the active tab. That would
be wrong: it treats the label as the defect when the *ground* is what never
themed, leaves the content surface still painting daylight parchment at night,
and would itself become unreadable the moment `well` is corrected. The token is
the defect.

## Observed behavior

Dark mode, skill page, any bundle.

**The tabs.** The `OVERVIEW` tab is active and its label is near-invisible
against its own fill; the inactive tabs beside it (`RESEARCH`, `EVAL`,
`PUBLISH`) are legible, and the surrounding chrome is correctly dark.

**The tab content — worse.** Open the Research tab on a bundle with
`research/notes.md`. The rendered Markdown is washed out to the point of
unreadability: headings (`Topic restatement`, `The architecture the skill must
live inside`) are barely discernible, body paragraphs are pale tan on cream, and
inline code chips render as **dark chips with light text** — correct styling for
a dark theme, painted on a light page. The content is dressed for a black
background it isn't on.

**The diagnostic that proves it's the ground, not the text rules:** selecting
the text makes it fully legible. `.dark ::selection` (`global.css:329-331`)
forces `color: #16110a` over an amber ground — the one place in dark mode where
a dark ink is hardcoded. Everywhere the theme's own inks apply, they are
dark-mode inks on a light-mode surface.

Measured (WCAG 2.1 contrast ratio):

| Pair | Dark mode today | After fix |
|---|---|---|
| Markdown h1/h2 — `neutral-100` `#f1e6d3` on `well` `#f6eee0` | **1.07:1** | **14.7:1** |
| active tab label — `ink` `#ece3d2` on `well` `#f6eee0` | **1.11:1** | **14.2:1** |
| Markdown body — `neutral-300` `#d5c3a3` on `well` `#f6eee0` | **1.50:1** | **10.5:1** |
| surface body copy — `ink-muted` `#b6a988` on `well` `#f6eee0` | **2.02:1** | **7.78:1** |
| active tab label, light mode — `#2c2416` on `#f6eee0` | 13.3:1 | unchanged |

## Current shape

Every other brand surface token is redefined for dark. `well` is not.

`packages/viewer/src/styles/global.css`, `@theme` block, lines 48-51 — note the
duplicate declaration, where a dark value is written and immediately clobbered:

```css
  --color-paper: #f4ece0;
  --color-well: #1b150d;
  --color-well: #f6eee0;  /* tabbed-section ground: a shade lighter than canvas, distinct from paper+surface */
  --color-paper-dark: #e3d5bd;  /* colour of the hard offset shadow */
```

The `.dark` block, lines 288-296, overrides its siblings and omits `well`:

```css
.dark {
  color-scheme: dark;
  --color-canvas: #16110a;      /* warm near-black ground */
  --color-surface: #221a10;
  --color-border: #3a3220;
  --color-ink: #ece3d2;         /* parchment ink — body text + wordmark */
  --color-ink-muted: #b6a988;
  --color-paper: #1d1610;       /* sidebar / panel ground, a shade above canvas */
  --color-paper-dark: #0b0805;  /* offset-shadow colour reads as depth on dark */
```

The consuming components are already correct and need no change — the tab label
colour is properly conditional on active state, `packages/viewer/src/app/next/SkillPage.tsx:18-21`:

```tsx
const TAB_ACTIVE =
  "relative z-10 -mb-px cursor-pointer rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-ink";
const TAB_IDLE =
  "cursor-pointer rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-ink-muted hover:bg-well/70 hover:text-ink";
```

Dark mode is expressed purely by token flipping — these tabs carry no `dark:`
utilities at all (`@custom-variant dark` at `global.css:32`), which is the house
pattern and worth preserving.

**Why the tab *content* is hit harder than the tab label.** Every tab body
renders inside that same `bg-well` container (`SkillPage.tsx:109`), and the
Research/Eval/Publish tabs render Markdown through
`packages/viewer/src/app/components/Markdown.tsx`, which is the one component
that pairs the deliberately-unflipped `neutral-*` ramp with explicit `dark:`
variants (`global.css:284-286` documents this arrangement):

```tsx
  1: "text-base font-semibold text-neutral-900 dark:text-neutral-100",
  2: "text-sm font-semibold text-neutral-900 dark:text-neutral-100",
```
```tsx
        <p className="text-neutral-700 dark:text-neutral-300">
```
```tsx
            <code key={i} className="rounded bg-neutral-100 px-1 font-mono text-[0.9em] dark:bg-neutral-900">
```

Those `dark:` variants are correct and fire correctly — the `.dark` class is on
the root. `neutral-100` (`#f1e6d3`) and `neutral-300` (`#d5c3a3`) are the right
inks *for a dark ground*, and `dark:bg-neutral-900` is the right chip *for a
dark ground*. They are simply being painted onto a ground that never became
dark. `ResearchTab` (`SkillPage.tsx:345-370`) puts `MarkdownContent` straight
into the `well` surface, which is where the two meet.

This is the same single defect, not a second one: no `dark:` variant in
`Markdown.tsx` is wrong, and none should change.

How it drifted, since the archaeology explains the whole class of bug: dark mode
shipped in `b6a2424` (#164, 2026-07-23); the folder tabs and the `well` token
arrived four days later in `35c419a` (#170, 2026-07-27). The token was born
after the `.dark` block was authored and nobody revisited it. `well` is also
absent from `docs/library/brand/Reference - Brand Palette.md`, so there was no
document that would have caught the omission either.

## Proposed contract

Add the missing token to the `.dark` block and delete the dead duplicate:

```css
/* @theme — delete the clobbered line, keep the light value */
--color-well: #f6eee0;  /* tabbed-section ground: a shade lighter than canvas, distinct from paper+surface */

/* .dark — the intended night value */
--color-well: #1b150d;  /* tabbed-section ground at night, a shade below canvas */
```

**Decisions:**

- The dark value is `#1b150d` — the value already present as the dead
  declaration at `global.css:49`, i.e. the original author's intent recovered
  rather than a new colour invented.
- In light mode `well` sits a shade *lighter* than `canvas` (`#f6eee0` vs
  `#f1e6d3`); at night it sits a shade *darker* than `canvas` (`#1b150d` vs
  `#16110a`). Both keep it distinct from `paper` and `surface`, which is the
  token's stated job.
- **No component classes change.** `TAB_ACTIVE` / `TAB_IDLE` in `SkillPage.tsx`
  stay exactly as written; no `dark:` utility is added; no text colour is
  hardcoded.
- `well` is added to `docs/library/brand/Reference - Brand Palette.md` with both
  values and its role, so the brand doc stops being silent about a shipped
  surface token.

## Acceptance criteria

- [ ] In dark mode the active tab's label is legible against its own ground —
      `ink` on `well` measures ≥ 7:1 (14.2:1 at the proposed value).
- [ ] In dark mode the tabbed content surface reads as a dark ground continuous
      with the rest of the night theme, and secondary copy on it (`ink-muted`)
      measures ≥ 4.5:1 (7.78:1 at the proposed value).
- [ ] The idle tab's `hover:bg-well/70` + `hover:text-ink` hover state is legible
      in dark mode — the same pairing that fails today.
- [ ] In dark mode, rendered Markdown on the tab surface is legible: headings
      (`dark:text-neutral-100`) ≥ 7:1 and body copy (`dark:text-neutral-300`)
      ≥ 7:1 against `well`. Verified on the Research tab with a real
      `research/notes.md`.
- [ ] In dark mode, inline code chips (`dark:bg-neutral-900`) and fenced code
      blocks read as raised/inset against the surface rather than as dark
      patches on a light page, and their text is legible against the chip.
- [ ] Negative: `Markdown.tsx` is unchanged — no `dark:` variant is added,
      removed, or retuned. Every one of them is already correct for a dark
      ground.
- [ ] Regression: light mode is pixel-identical. The active tab, idle tabs, the
      content surface, and the row-hover at `SkillPage.tsx:264` all render
      unchanged in daylight.
- [ ] Negative: `--color-well` is declared exactly once in `@theme` and exactly
      once in `.dark`; the duplicate declaration is gone.
- [ ] Negative: `SkillPage.tsx` is unchanged — no hardcoded text colour, no new
      `dark:` utility on the tabs.
- [ ] `docs/library/brand/Reference - Brand Palette.md` lists `well` with its
      light and dark values and its role.
- [ ] Tests cover both themes across all four surfaces that consume the token
      (active tab, tab content surface, idle-tab hover, menu-row hover at
      `SkillPage.tsx:264`).

## Implementation notes

The token has exactly four consumers, all in one file —
`packages/viewer/src/app/next/SkillPage.tsx:19` (active tab), `:21` (idle-tab
hover tint), `:109` (tab content surface), `:264` (menu row hover) — and there
are no others in the viewer.

**Do not mistake that for a small verification surface.** Consumer `:109` is the
ground for *every* tab body, so the visual blast radius is all Markdown and all
content rendered in the Overview, Research, Eval, and Publish tabs. Verifying
the four class sites is not enough; check real rendered content in each tab, in
both themes — a bundle with a populated `research/notes.md` is the sharpest test
because it exercises headings, body copy, inline code, and fenced blocks at
once.

Scope fences:

- **Do not hardcode a text colour on the tabs.** The label already switches
  correctly between `text-ink` and `text-ink-muted`; the ground is what's
  missing. A literal black or white in `SkillPage.tsx` would mask this bug and
  block the token fix.
- **Do not re-theme the other surface tokens.** `canvas`, `surface`, `paper`,
  and `border` have considered dark values; leave them.
- **Do not flip the `neutral-*` ramp.** It is deliberately not flipped in dark
  (`global.css:284-286`), and `Markdown.tsx` pairs it with explicit `dark:`
  variants.
- **Do not touch `Markdown.tsx`.** Its `dark:` variants look wrong on screen
  today only because the ground beneath them is wrong. Retuning them would make
  the content readable on the broken light ground and then break it a second
  time when `well` is corrected.

Relevant current files, as orientation only:

- `packages/viewer/src/styles/global.css` — `@theme` (:34), the duplicate
  `--color-well` (:49-50), the `.dark` block (:288)
- `packages/viewer/src/app/next/SkillPage.tsx` — the four consumers above; `ResearchTab` (:345)
- `packages/viewer/src/app/components/Markdown.tsx` — the `dark:` variants rendered on the surface (:28, :62-67, :82, :100)
- `docs/library/brand/Reference - Brand Palette.md` — the palette table `well`
  is missing from

## Not in scope

The active tab's border is `border-neutral-900/50`, and the neutral ramp is
deliberately not flipped in dark — so once the ground goes dark, that hairline
becomes a dark border on a dark surface. Cosmetic, invisible rather than
illegible, and it touches the ramp-flipping decision rather than this token.
Worth a separate ticket if it reads poorly once the ground is corrected.


Implement exactly this issue. Verify every claim in the issue against the current code before acting on it; the issue is a report, not a spec — the code is the truth. Stay minimal: fix the reported defect with tests, nothing adjacent.

Run ID: 01KZ6YKAKGKPFD70772920JR9J
Pipeline progress: 3 of 7 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Plan ready for implementation: docs/proposals/2026-08-04-dark-mode-well-token.md
  > 
  > --- BEGIN PLAN DOC ---
  > # Dark-Mode Well Token
  > 
  > *Implementation plan — 2026-08-04. Run
  > `01KZ6YKAKGKPFD70772920JR9J`; addresses GitHub issue #192.*
  > 
  > ## Status
  > 
  > Ready for implementation. This is a viewer theme-token correction, one
  > focused regression test, and a narrowly owned brand-library migration. It
  > does not change component markup, Markdown styling, application state, core,
  > CLI, or server behavior.
  > 
  > ## Outcome
  > 
  > The skill page's folder tabs and tab-content well will keep
  > `--color-well: #f6eee0` in light mode and use the already-authored
  > `#1b150d` value in dark mode. Moving that night value from a clobbered
  > declaration in `@theme` into `.dark` restores the token-flipping contract:
  > the active tab, full tab-content surface, idle-tab hover, and version-menu-row
  > hover all theme together without component-specific `dark:` utilities or
  > hardcoded text colors.
  > 
  > At the fixed values, the reported dark-mode pairings become:
  > 
  > | Pair | Contrast after the fix |
  > | --- | ---: |
  > | Markdown h1/h2 (`#f1e6d3`) on well | 14.66:1 |
  > | Active-tab ink (`#ece3d2`) on well | 14.22:1 |
  > | Markdown body (`#d5c3a3`) on well | 10.49:1 |
  > | Muted ink (`#b6a988`) on well | 7.78:1 |
  > 
  > Light mode remains `#2c2416` on `#f6eee0` for the active tab, 13.29:1.
  > 
  > ## Verified current state
  > 
  > The repository confirms the defect and the minimal correction:
  > 
  > - `packages/viewer/src/styles/global.css` declares
  >   `--color-well: #1b150d` and then immediately clobbers it with
  >   `--color-well: #f6eee0` in `@theme`. The `.dark` block overrides the
  >   neighboring surface and ink tokens but has no `well` declaration.
  > - `packages/viewer/src/app/next/SkillPage.tsx` has exactly four `well`
  >   utility sites: active-tab `bg-well`, idle-tab `hover:bg-well/70`, the
  >   full tab-content `bg-well`, and version-menu-row `hover:bg-well`.
  > - `packages/viewer/src/app/components/Markdown.tsx` deliberately leaves the
  >   neutral ramp unflipped and selects light neutral text plus dark code
  >   grounds with explicit `dark:` variants. Those classes are internally
  >   legible on the intended night well and must not be retuned.
  > - Overview and Research render Markdown directly on the well. Eval can
  >   render Markdown, but that run-detail pane has its own `bg-surface`;
  >   Publish uses ordinary JSX text. All four tab bodies still live within the
  >   common well, so each tab remains part of the manual visual check.
  > - `docs/library/brand/Reference - Brand Palette.md` predates the `well`
  >   token and lists neither its role nor its light/dark values.
  > - No existing test covers the CSS token or its four consumers. The current
  >   viewer suite passes: 260 tests across 22 files.
  > 
  > The code also corrects three details in the issue report that should not be
  > carried into implementation:
  > 
  > - `#1b150d` is slightly **lighter** than dark canvas `#16110a`, and sits
  >   between canvas and paper `#1d1610`; it is not darker than canvas.
  > - The `.dark` block existed before `b6a2424`; that commit reworked the
  >   current dark-mode implementation. Commit `35c419a` later introduced both
  >   `well` declarations together, including the dead night value.
  > - Markdown is not rendered directly on the well by Research, Eval, and
  >   Publish as a group. The direct cases are Overview and Research, with the
  >   Eval and Publish distinctions described above.
  > 
  > These corrections do not change the requested fix.
  > 
  > ## Implementation contract
  > 
  > 1. In `packages/viewer/src/styles/global.css`, delete the dead
  >    `--color-well: #1b150d` declaration from `@theme`, leaving the existing
  >    light value declared exactly once.
  > 2. Add `--color-well: #1b150d` exactly once beside the other surface tokens
  >    in `.dark`. Its comment should explain that issue #192 restores the night
  >    value introduced with the folder tabs in #170, and should describe the
  >    value as slightly above/lighter than dark canvas.
  > 3. Do not edit `packages/viewer/src/app/next/SkillPage.tsx` or
  >    `packages/viewer/src/app/components/Markdown.tsx`. Theme behavior must
  >    continue to flow solely through the token.
  > 4. Add focused automated coverage for the token, contrast contract, and all
  >    four existing consumer sites without introducing a browser-test
  >    dependency.
  > 5. Migrate the live brand reference narrowly: add `well` with its tabbed
  >    section role, light value `#f6eee0`, and dark value `#1b150d`, and include
  >    `--color-well` in the canonical-token list. No other library
  >    reconciliation is part of this change.
  > 
  > ## Files and ownership
  > 
  > ### Viewer stylesheet
  > 
  > - Modify `packages/viewer/src/styles/global.css`.
  > 
  > This is the only production-code edit.
  > 
  > ### Viewer regression test
  > 
  > - Add `packages/viewer/src/styles/global.test.ts`.
  > 
  > Keep the test beside the stylesheet because it protects the stylesheet and
  > component-source contract, not the stored-theme selection logic in
  > `next/theme.test.ts`.
  > 
  > The test may use `bun:test`, `readFileSync`, and `import.meta.dir`; no new
  > runtime or test dependency is needed. It should:
  > 
  > 1. Isolate the `@theme` and `.dark` blocks and assert that `--color-well`
  >    appears exactly once in each and exactly twice in the stylesheet.
  > 2. Assert the exact values: `#f6eee0` for the base/light block and
  >    `#1b150d` for `.dark`. This directly guards both the dark fix and
  >    pixel-identical light mode.
  > 3. Read `SkillPage.tsx`, tokenize the relevant quoted class strings, and
  >    assert the four semantic arrangements:
  >    - active tab has `bg-well` with `text-ink`;
  >    - idle tab has `bg-canvas`, `text-ink-muted`,
  >      `hover:bg-well/70`, and `hover:text-ink`;
  >    - the full-bleed tab-content container has `bg-well`;
  >    - the version-menu row has `hover:bg-well`.
  > 4. Assert there are exactly four `bg-well`/`hover:bg-well` utility sites and
  >    that these class arrangements do not acquire a `dark:bg-*` override or an
  >    arbitrary hardcoded background/text color. Use token-set predicates
  >    rather than whole class-string snapshots so layout-only class changes do
  >    not make the test brittle.
  > 5. Resolve the relevant base and `.dark` color declarations and use a small
  >    test-local WCAG relative-luminance helper to cover both themes:
  >    - active-tab `ink` on `well` is at least 7:1;
  >    - tab-content h1/h2 and body colors meet at least 7:1, and `ink-muted`
  >      meets at least 4.5:1, on `well`;
  >    - idle-hover `ink` is at least 7:1 after compositing 70% `well` over
  >      `canvas`;
  >    - selected and unselected version-row text meet 7:1 and 4.5:1
  >      respectively on the opaque well hover;
  >    - inline and fenced code text remains at least 7:1 against its
  >      light/dark code background.
  > 
  > The exact-value checks catch the reported cascade failure. The contrast
  > checks preserve the accessibility reason those values matter, while the
  > source assertions ensure all four surfaces continue to participate in the
  > same two-theme token contract.
  > 
  > ### Brand-library migration
  > 
  > - Modify `docs/library/brand/Reference - Brand Palette.md`.
  > 
  > This plan explicitly owns only the `well` migration requested by issue #192:
  > add one core-surface row containing the role and both theme values, and add
  > the token to the canonical-token list. Preserve the card's frontmatter,
  > links, status, cross-surface reconciliation notes, and all unrelated palette
  > wording.
  > 
  > ### Read-only verification surfaces
  > 
  > - `packages/viewer/src/app/next/SkillPage.tsx`
  > - `packages/viewer/src/app/components/Markdown.tsx`
  > - `packages/viewer/src/app/next/EvalsSection.tsx`
  > - `packages/viewer/src/pages/index.astro`
  > 
  > These establish the consumer, Markdown, nested-surface, and inherited-ink
  > contracts. They are not implementation targets.
  > 
  > ## Implementation sequence
  > 
  > 1. Add the regression test against the current files and confirm it fails
  >    because `@theme` has two `well` declarations and `.dark` has none.
  > 2. Move the dead night value into `.dark`, preserving the one light value in
  >    `@theme`; rerun the focused test.
  > 3. Apply the narrow brand-library migration and verify the documented
  >    values exactly match the stylesheet.
  > 4. Run viewer tests and static/build validation.
  > 5. Perform the two-theme browser pass described below, then run the
  >    repository gates.
  > 
  > ## Visual verification
  > 
  > Use a real bundle with populated `research/notes.md` containing headings,
  > paragraphs, inline code, and fenced code. In both light and dark mode:
  > 
  > - inspect the active tab and each idle tab's hover state;
  > - inspect Overview and Research Markdown on the well;
  > - inspect Eval's content, noting that run-detail Markdown remains on its
  >   nested `surface`;
  > - inspect Publish's primary and muted ordinary text;
  > - open the version menu and inspect selected and unselected row hover states;
  > - confirm inline and fenced code read as intentional inset/raised elements;
  > - confirm the well remains visually distinct from canvas, paper, and surface.
  > 
  > Light mode should show no visual change. Dark mode should show a continuous
  > night surface with readable active-state, primary, muted, and Markdown text.
  > 
  > The repository has no Playwright, DOM, or visual-regression harness.
  > Introducing one for this CSS-token correction would expand scope
  > substantially, so browser-computed hover behavior and pixel identity remain a
  > manual check; the Bun contract test and viewer build provide the durable
  > automated layer.
  > 
  > ## Validation commands
  > 
  > Fast feedback:
  > 
  > ```sh
  > bun test packages/viewer/src/styles/global.test.ts
  > bun test packages/viewer
  > bun run --filter @skillmaker/viewer check
  > bun run build:viewer
  > ```
  > 
  > Repository gates:
  > 
  > ```sh
  > bunx tsc --noEmit -p packages/core
  > bunx tsc --noEmit -p packages/cli
  > bun test packages
  > bun run build:viewer
  > bun test test/e2e --timeout 30000
  > ```
  > 
  > No CLI/server behavior changes, so no new black-box e2e case is required.
  > 
  > ## Acceptance criteria
  > 
  > - [ ] `--color-well` is declared exactly once in `@theme` as `#f6eee0`.
  > - [ ] `--color-well` is declared exactly once in `.dark` as `#1b150d`.
  > - [ ] Dark active-tab ink on well is at least 7:1; the expected ratio is
  >       14.22:1.
  > - [ ] Dark muted ink on well is at least 4.5:1; the expected ratio is
  >       7.78:1.
  > - [ ] Dark Markdown h1/h2 and body text on well are at least 7:1; expected
  >       ratios are 14.66:1 and 10.49:1.
  > - [ ] Inline and fenced code retain legible text and read as intentional
  >       dark-theme elements within the corrected night surface.
  > - [ ] Idle-tab and version-menu-row hover states are legible in both themes.
  > - [ ] Automated coverage protects both theme values and all four existing
  >       token-consumer sites.
  > - [ ] Light mode keeps the existing well value and is visually unchanged
  >       across the active tab, idle tabs, content surface, and menu-row hover.
  > - [ ] `SkillPage.tsx` and `Markdown.tsx` have no diff.
  > - [ ] Canvas, surface, paper, border, the neutral ramp, and all other palette
  >       tokens are unchanged.
  > - [ ] The brand palette reference lists `well`, both values, its role, and
  >       its canonical token name.
  > - [ ] Viewer tests, viewer check/build, and repository gates pass.
  > 
  > ## Risks and mitigations
  > 
  > | Risk | Mitigation |
  > | --- | --- |
  > | A later duplicate silently wins by cascade order again. | Assert declaration counts per block and across the complete stylesheet, not only the effective value. |
  > | A component masks the token with a local dark utility or literal color. | Protect the four token-based class arrangements and reject local dark/hardcoded color overrides in the focused test. |
  > | Source-level consumer assertions become noisy after harmless class reordering. | Compare whitespace-delimited class token sets and semantic predicates, not full strings or snapshots. |
  > | Unit tests do not execute browser hover/computed-style behavior. | Build the Tailwind/Astro viewer and complete the explicit two-theme browser pass; defer browser infrastructure rather than adding it ad hoc. |
  > | The live brand card contains older cross-surface reconciliation questions. | Make only the explicitly owned `well` row/list migration; do not broaden this accessibility fix into a palette rewrite. |
  > 
  > ## Deferred follow-ups
  > 
  > - The active tab's `border-neutral-900/50` may become visually quiet on the
  >   corrected dark well. It is cosmetic and remains a separate issue because
  >   changing it would revisit the deliberately unflipped neutral ramp.
  > - Automated screenshot and interaction testing can be considered as a
  >   repository-wide viewer-testing investment, not introduced solely for
  >   issue #192.
  > - The older brand-reference reconciliation notes and marketing-site
  >   crosswalk remain outside this token correction.
  > 
  > ## Open questions
  > 
  > None. The intended night value, consumer contract, documentation migration,
  > and verification thresholds are all recoverable from the current code and
  > the commit that introduced the folder tabs.
  > --- END PLAN DOC ---

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented Issue #192.
  > 
  > - Moved the intended `--color-well: #1b150d` from the clobbered light-theme declaration into `.dark`, while preserving the light value `#f6eee0` in [global.css](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.css:49).
  > - Added [global.test.ts](/home/daytona/workspace/skillmaker-studio/packages/viewer/src/styles/global.test.ts:1), covering exact token declaration counts and values, all four `well` consumers, dark/light contrast contracts, and Markdown/code-theme pairings.
  > - Documented `well`, its role, both values, and canonical token name in [Reference - Brand Palette.md](/home/daytona/workspace/skillmaker-studio/docs/library/brand/Reference%20-%20Brand%20Palette.md:24).
  > - Left `SkillPage.tsx` and `Markdown.tsx` unchanged.
  > 
  > Validation passed using the repository-pinned Bun 1.3.11:
  > 
  > - `bunx tsc --noEmit -p packages/core`
  > - `bunx tsc --noEmit -p packages/cli`
  > - `bun test packages` — 1063 passed
  > - `bun run build:viewer`
  > - `bun test test/e2e --timeout 30000` — 370 passed, 16 expected skips
  > 
  > Note: the system-default Bun 1.3.6 fails an unrelated `fs.watch` test; the repo pins Bun 1.3.11, which passes the full suite unchanged.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1719 lines omitted)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1631 expect() calls
  Ran 386 tests across 48 files. [166.71s]
  == Build viewer ==
  $ bun run --filter @skillmaker/viewer build
  @skillmaker/viewer build: $ bun ../../scripts/sync-brand-assets.ts
  @skillmaker/viewer build: brand: skillmaker-logo.png -> packages/viewer/public/skillmaker-logo.png
  @skillmaker/viewer build: brand: synced 1 file(s) from assets/brand/
  @skillmaker/viewer build: 18:18:11 [content] Syncing content
  @skillmaker/viewer build: 18:18:11 [content] Synced content
  @skillmaker/viewer build: 18:18:11 [types] Generated 34ms
  @skillmaker/viewer build: 18:18:11 [build] output: "static"
  @skillmaker/viewer build: 18:18:11 [build] mode: "static"
  @skillmaker/viewer build: 18:18:11 [build] directory: /home/daytona/repos/sociotechnica-org/skillmaker-studio/packages/viewer/dist/
  @skillmaker/viewer build: 18:18:11 [build] Collecting build info...
  @skillmaker/viewer build: 18:18:11 [build] ✓ Completed in 58ms.
  @skillmaker/viewer build: 18:18:11 [build] Building static entrypoints...
  @skillmaker/viewer build: 18:18:12 [vite] ✓ built in 957ms
  @skillmaker/viewer build: 18:18:12 [build] ✓ Completed in 981ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  building client (vite) 
  @skillmaker/viewer build: 18:18:12 [vite] transforming...
  @skillmaker/viewer build: 18:18:13 [vite] ✓ 251 modules transformed.
  @skillmaker/viewer build: 18:18:13 [vite] rendering chunks...
  @skillmaker/viewer build: 18:18:13 [vite] computing gzip size...
  @skillmaker/viewer build: 18:18:13 [vite] dist/_astro/index.DBy5LfQW.js        7.85 kB │ gzip:  3.05 kB
  @skillmaker/viewer build: 18:18:13 [vite] dist/_astro/NextShell.DMJ6q6tK.js  178.62 kB │ gzip: 54.71 kB
  @skillmaker/viewer build: 18:18:13 [vite] dist/_astro/client.Fd5LK8aS.js     186.79 kB │ gzip: 58.63 kB
  @skillmaker/viewer build: 18:18:13 [vite] ✓ built in 1.51s
  @skillmaker/viewer build: 
  @skillmaker/viewer build:  generating static routes 
  @skillmaker/viewer build: 18:18:14 ▶ src/pages/index.astro
  @skillmaker/viewer build: 18:18:14   └─ /index.html(node:71452) Warning: `--localstorage-file` was provided without a valid path
  @skillmaker/viewer build: (Use `node --trace-warnings ...` to show where the warning was created)
  @skillmaker/viewer build:  (+12ms) 
  @skillmaker/viewer build: 18:18:14 ▶ src/pages/next.astro
  @skillmaker/viewer build: 18:18:14   └─ /next/index.html (+1ms) 
  @skillmaker/viewer build: 18:18:14 ✓ Completed in 179ms.
  @skillmaker/viewer build: 
  @skillmaker/viewer build: 18:18:14 [build] 2 page(s) built in 2.73s
  @skillmaker/viewer build: 18:18:14 [build] Complete!
  @skillmaker/viewer build: Exited with code 0
  All repo gates passed.
  ```


# Review

Review the implementation as if preparing a pull request.

Check:

- The diff stays within the requested Skillmaker Studio scope and the
  plan's named package boundaries: domain logic and schemas in
  `packages/core`, deterministic CLI/server behavior in `packages/cli`,
  browser UI in `packages/viewer`.
- CLI changes have black-box tests for behavior, exit codes, and
  important output fields; server-surface changes have `test/e2e`
  coverage.
- Viewer changes build (`bun run build:viewer` ran in validation).
- Comments follow the house style: plain English prose explaining WHY,
  citing issues, dated proposals, and rulings (see
  `packages/core/src/Todo.ts` for the standard). Flag comments that
  merely restate the code, and new non-obvious decisions left
  uncommented or uncited.
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- Validation output from the gates node is understood and any failures
  are actionable.

Do not make implementation, prompt, config, or test edits in this stage.
If a change is required, route back to implementation with enough context
for the next implement stage to make the fix.

If the implementation is not ready, be concrete about the remaining
blocking work so the next implementation stage has actionable context.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"review_ready":true}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"review_ready":false}}
```
