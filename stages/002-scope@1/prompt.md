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
Pipeline progress: 0 of 7 stages completed


# Scope

Create or refine a durable technical implementation plan for the requested
Skillmaker Studio feature. Do not edit implementation files in this stage.

## The repository

Skillmaker Studio is a bun + Effect TypeScript monorepo (bun workspaces,
`packageManager: bun@…` pinned in the root `package.json`):

- `packages/core` — the domain engine: skills, evals, journal, todos,
  triage. Effect-first; schemas live here and everything else consumes
  them.
- `packages/cli` — the `skillmaker` CLI and the local server the Studio
  UI rides on. Command execution is modeled as Effect programs; command
  data goes on stdout, diagnostics on stderr, exit codes are stable.
- `packages/viewer` — the Studio browser UI (Astro + React).
- `packages/desktop`, `packages/docs-site`, `packages/marketing-site`,
  `packages/skill` — desktop shell, sites, and the packaged
  `/skillmaker` agent skill. Touch these only when the goal names them.
- `test/e2e` — black-box end-to-end tests over the CLI and server
  surfaces (`bun test test/e2e`).
- `docs/` — plans and design docs; `docs/proposals/` holds dated
  proposal/plan documents.

Repository gates (mirrors `.github/workflows/ci.yml`): typecheck core and
cli, `bun test packages`, `bun test test/e2e`, and `bun run build:viewer`.
A later script node runs all of these; plan work that can pass them.

House comment style — plan for it now so implementation inherits it:
comments are plain English prose that explains WHY the code is shaped the
way it is, not what it does, and cites its sources — issue numbers,
dated proposals, and rulings (e.g. "ruling R2, 2026-07-17 data-model
reconciliation") — the way `packages/core/src/Todo.ts` does.

## Planning rules

- Read and obey the root `README.md`, `docs/README.md`, and any
  package-local README or guidance files for packages named by the goal.
- Write the plan to `docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md`
  (the house pattern for dated proposals). If a relevant plan already
  exists there, refine it instead of creating a duplicate.
- Keep work scoped to the packages and surfaces named by the goal.
- Keep domain logic and schemas in `packages/core`; keep deterministic
  CLI/server behavior in `packages/cli`; keep browser UI state in
  `packages/viewer`.
- Do not freehand-edit `docs/library`; it is the live product context
  library. Only touch that path when the approved plan explicitly owns a
  library migration.
- Use Effect patterns already present in the touched packages.
- Include black-box tests for CLI behavior, exit codes, and important
  output fields when the CLI changes (unit tests in the package,
  end-to-end coverage in `test/e2e` when the server surface changes).
- Include viewer build validation (`bun run build:viewer`) when viewer
  behavior changes.
- Include risks, mitigations, acceptance criteria, and deferred
  follow-ups.

## Implementation handoff output

- After writing or refining the plan, read the plan file back from disk.
- Your final response is what the implementation stage receives. It must
  show the real plan document, not a summary.
- Start with `Plan ready for implementation: <plan-path>`.
- Then paste the complete Markdown contents of the plan file between these
  exact markers:

```text
--- BEGIN PLAN DOC ---
<complete contents of docs/proposals/<yyyy-mm-dd>-<stable-feature-slug>.md>
--- END PLAN DOC ---
```

- Do not summarize, paraphrase, omit sections, or replace the plan with a
  status report.
- If the plan has risks or open questions that need attention before
  implementation, they must be present in the plan document itself.
