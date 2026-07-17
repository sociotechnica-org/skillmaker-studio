---
type: Concept
prefLabel: LifeBuild Brand
context: brand
status: new
links:
  related_to:
    - "./Reference - Brand Palette"
    - "./Reference - Typography"
    - "./Reference - Surfaces and Texture"
    - "./Reference - Voice and Tone"
    - "../_index/Concept - Skillmaker Studio"
---

## WHAT
Skillmaker Studio's brand is **"LifeBuild — analog manuscript"**: a 90s
paper-craft aesthetic. Warm parchment ground, distressed typewriter headings,
a humanist serif body, a single amber accent used sparingly as a "device"
(underline, glow, selection), hard flat blur-free offset shadows (riso/sticker
print), a faint paper-grain texture, and the hand-drawn **"SKILLMAKER STUD!O"**
wordmark. No pure black or white — every neutral leans warm toward tan/brown.

One brand system dresses two surfaces:

- **The marketing site** (`packages/marketing-site`) — light-only, loud.
- **The product / viewer** (`packages/viewer`) — light **and** a
  "manuscript at night" dark mode, quiet.

This card is the anchor for the `brand` context. Token-level standards live in
the Reference cards: [[Reference - Brand Palette]], [[Reference - Typography]],
[[Reference - Surfaces and Texture]], [[Reference - Voice and Tone]].

## WHY
The brand has an upstream **source of truth**: `lifebuild-site`'s
`src/layouts/Layout.astro`, cited verbatim in both surfaces' CSS as the origin
of the parchment ground, the radial-gradient grain, and the amber glow blobs.
Both surfaces re-implement it, which is exactly why they drift — hence the move
to codify it here and to single-source shared assets (see
[[Concept - Skillmaker Studio]] and `assets/brand/`).

The wordmark is already consolidated: `assets/brand/skillmaker-logo.png` is the
one tracked master, synced into each app's `public/` by
`scripts/sync-brand-assets.ts` (see `assets/brand/README.md`). It is a
black-on-transparent monochrome silhouette painted in the theme ink colour via
a CSS `mask`, so a single file serves light and dark — do **not** bake colour
into it.

## HOW
The brand's pillars, each with its own Reference card:

1. **Palette** — parchment/ink core + one amber accent + a warm-retinted
   semantic ramp. [[Reference - Brand Palette]]
2. **Typography** — Source Serif 4 body under a "sans" token name; Special
   Elite single-weight typewriter for headings and all-caps mono micro-labels.
   [[Reference - Typography]]
3. **Surfaces & texture** — paper grain, amber glow, hard offset shadows, the
   hand-drawn amber underline. [[Reference - Surfaces and Texture]]
4. **Voice** — loud noir/infomercial in marketing, quiet and utilitarian
   in-product. [[Reference - Voice and Tone]]

### Open reconciliation decisions
The two surfaces were built independently and disagree on a few points. These
need a ruling before the standard is fully canonical:

- **Dark mode scope.** The viewer ships a full "manuscript at night" dark
  theme; the marketing site is light-only (`color-scheme: light` pinned). Is
  dark mode part of the brand everywhere, or product-only?
- **Divergent hex** (see [[Reference - Brand Palette]]): `--color-border`,
  the offset-shadow `paper-dark`, and the amber hover shade differ slightly.
- **Token naming.** `ink-dim`/`ink-muted`, `surface-raised`/`paper`,
  `accent`/`amber-deep`, `amber-device`/`amber` name the same roles
  differently across surfaces.
- **Texture recipe** (see [[Reference - Surfaces and Texture]]): grain layer
  count (8 vs 5), glow blob count and blur differ.

### Provenance
Derived from a brand audit on **2026-07-17** of two in-flight branches:
`skillmaker-sales-site` (surat worktree, `packages/marketing-site`) and
`skillmaker-lifebuild-branding` (san-jose worktree, `packages/viewer`).
Both trace to `lifebuild-site/src/layouts/Layout.astro` (external). Re-verify
exact values against `packages/*/src/styles/global.css` once those branches
land on `main`.
