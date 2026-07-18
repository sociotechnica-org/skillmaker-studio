---
type: Reference
prefLabel: Surfaces and Texture
context: brand
status: new
links:
  related_to:
    - "./Concept - LifeBuild Brand"
    - "./Reference - Brand Palette"
---

## WHAT
The physical, paper-craft depth cues that make the brand feel analog. Four
signatures, all traced to `lifebuild-site/src/layouts/Layout.astro`:

1. **Paper grain** — a fixed, full-viewport, `pointer-events:none` overlay of
   layered `radial-gradient` dot fields in ink at 2–3% alpha
   (`rgba(44,36,22,0.02–0.03)`), each tiled at a tiny `background-size`
   (4–11px) to fake organic noise. ⚠ site uses **8** layers; product uses
   **5**. In dark mode the product inverts it to faint light specks
   (`rgba(236,227,210,~0.02)`).
2. **Ambient amber glow** — large, soft radial gradients bleeding in from the
   corners. ⚠ site: **two** blobs (top-right `#d4a052`@10%, bottom-left
   `#b8863a`@7%), no blur. Product: **one** blob top-right `#d4a052`@12% with
   `filter: blur(120px)` (boosted to 16% in dark).
3. **Hard flat offset shadows** — the riso/sticker signature: **zero blur**,
   offset in `--color-paper-dark`. ⚠ product baseline `2px 2px 0`
   (`3px 3px 0` for `rounded-xl`); site baseline `3px 3px 0` (up to
   `8px 8px 0` on the folder-style SkillCard). `rounded-full` badges and
   `shadow-xl` modals are deliberately excluded so real elevation survives.
4. **Hand-drawn amber underline** — on page titles: a 3px amber
   (`--color-amber`) bar, `transform: rotate(-0.5deg) scaleX(1.02)`,
   `border-radius: 2px`, `opacity: 0.85`, width `fit-content`.

Borders/radii use Tailwind defaults inline (`rounded-md`/`-lg`/`-xl`,
`border`). Text selection is amber (see [[Reference - Brand Palette]]).

## WHY
These four devices, not colour alone, are what read as "made of paper." They're
the most-copied and most-drifted part of the brand (both surfaces re-implement
the grain and glow from the same upstream file with different parameters), so
they're the highest-value thing to extract into one shared implementation. The
offset-shadow rule is written with compound selectors specifically to
out-specify Tailwind's own `shadow-*` utilities — keep that when consolidating.

## HOW
**Motion:** deliberately minimal — **no `@keyframes`, no animation.** Only
Tailwind colour-hover transitions on links/buttons, plus `scroll-behavior:
smooth`. Static decorative rotations (underline `-0.5deg`, sticky notes,
paperclips) are set once, never animated. The brand reads as *print*, not app.

**To reconcile** into one canonical treatment (ideally a shared CSS partial
sourced from the same place as the tokens): grain layer count, glow blob
count + blur, and the offset-shadow baseline distance. Recommend adopting one
`body::before`/`body::after` recipe and one shadow rule for both surfaces.

Verified 2026-07-17 against `packages/marketing-site/src/styles/global.css:36-113,
116-122` (surat) and `packages/viewer/src/styles/global.css:152-208, 210-231,
267-280` (san-jose). Unmerged branches — re-check on merge. Consumes
`--color-paper-dark` and `--color-amber` from [[Reference - Brand Palette]].
