---
type: Reference
prefLabel: Brand Palette
context: brand
status: new
links:
  related_to:
    - "./Concept - LifeBuild Brand"
    - "./Reference - Surfaces and Texture"
---

## WHAT
The colour system: a warm parchment/ink core, one amber accent, and a
warm-retinted semantic ramp. All values are CSS custom properties in a
Tailwind v4 `@theme` block (one per surface). "✓" = both surfaces agree; "⚠" =
they diverge and need a ruling ([[Concept - LifeBuild Brand]] › open decisions).

### Core — ink & paper (light)
| Role | Value | Status |
|---|---|---|
| Page ground (parchment) | `#f1e6d3` | ✓ |
| Card surface / paper | `#fff9f0` | ✓ |
| Raised paper | `#f4ece0` | ✓ (named `surface-raised` / `paper`) |
| Primary ink (text, wordmark) | `#2c2416` | ✓ |
| Dim ink (secondary text) | `#5b5143` | ✓ (named `ink-dim` / `ink-muted`) |
| Hairline border | `#d9cbb2` **vs** `#e5d6bd` | ⚠ |
| Offset-shadow colour (`paper-dark`) | `#e8dcc8` **vs** `#e3d5bd` | ⚠ |

### Accent — amber (the only brand accent)
| Role | Value | Status |
|---|---|---|
| Brand amber ("device": underline, glow, selection) | `#d4a052` | ✓ (named `amber-device` / `amber`) |
| Deep amber (small text on parchment, accents) | `#b8863a` | ✓ (named `accent` / `amber-deep`) |
| Amber glow (highlight) | `#e8b86d` | app only |
| Amber hover / dim | `#8f6526` **vs** `#8f6a2e` | ⚠ |

### Semantic status ramp (product only)
The viewer re-tints Tailwind's default ramps warm so component code can keep
using `neutral-*`, `amber`, `sky`, `indigo`, `emerald`, `red` inline and get
the brand for free. Intent map:

| Tailwind ramp | Brand meaning | Anchor (500/600) |
|---|---|---|
| `neutral` | paper → ink | `#857a61` / `#5b5143` |
| `amber` | evaluating / gold | `#d4a052` / `#b8863a` |
| `sky` → **teal** | researching | `#4a7c7c` |
| `indigo` → **plum** | drafting | `#7c5a6a` |
| `emerald` → **moss** | published / in-sync | `#78854a` |
| `red` → **rust** | revise / error | `#984841` / `#8b3a3a` |

### Selection
`::selection` = amber `#d4a052` ground, ink `#2c2416` text. ✓

## WHY
The core (parchment/ink) and the amber accent are already consistent across
both surfaces — that agreement *is* the brand and should be treated as fixed.
The **ramp-retint trick** is the key mechanism: it lets an app that only uses
default palette classes inline get re-skinned wholesale from the `@theme` layer
with zero component churn — adopt it anywhere the brand needs to spread. The
marketing site does *not* yet use the ramp; it hardcodes one-off heat colours
in `SkillCard.astro` (`#dca94e`, `#b0561c`, `#ece3ce`, …) that should migrate
onto the ramp.

## HOW
**Canonical token names** (prefer the role-named form): `--color-canvas`,
`--color-surface`, `--color-surface-raised`, `--color-ink`, `--color-ink-dim`,
`--color-border`, `--color-paper-dark`, `--color-amber` (`#d4a052`),
`--color-amber-deep` (`#b8863a`), `--color-amber-glow`, `--color-accent-dim`.

**Naming crosswalk** (site → app): `ink-dim`→`ink-muted`,
`surface-raised`→`paper`, `accent`→`amber-deep`, `amber-device`→`amber`.
Pick one set when reconciling.

**To reconcile** (needs a ruling): `--color-border`, `--color-paper-dark`,
the amber hover shade; and whether the marketing site adopts the full semantic
ramp + dark overrides.

Verified 2026-07-17 against `packages/marketing-site/src/styles/global.css:8-22`
(surat) and `packages/viewer/src/styles/global.css:24-139` (san-jose). Both are
unmerged branches — re-check on merge. Relates to
[[Reference - Surfaces and Texture]] (which consumes `paper-dark` and amber).
