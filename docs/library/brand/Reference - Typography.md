---
type: Reference
prefLabel: Typography
context: brand
status: new
links:
  related_to:
    - "./Concept - LifeBuild Brand"
    - "./Reference - Brand Palette"
---

## WHAT
Three type roles, two typefaces, loaded from Google Fonts (no self-hosted
fonts).

| Token | Stack | Used for |
|---|---|---|
| `--font-sans` | `"Source Serif 4", Georgia, "Times New Roman", serif` | body copy |
| `--font-display` | `"Special Elite", "Courier New", monospace` | headings, chrome |
| `--font-mono` | `"Special Elite", ui-monospace, "SF Mono", Menlo, monospace` | labels, hashes, IDs |

Note the deliberate misnomer: **`--font-sans` is a serif.** The body face is
Source Serif 4 — the "sans" name is legacy and reinforces the bookish
manuscript feel.

- **Source Serif 4** — humanist serif, optical-size axis `8..60`. Weights:
  **300**/400/600 + italic 400 (product) — the marketing site loads only
  400/600 + italic 400. ⚠ reconcile the weight set.
- **Special Elite** — single-weight (400) distressed typewriter face. Because
  it ships one weight, faux-bold is disabled with `font-synthesis: none` and
  headings render at weight 400 even where markup says `font-semibold`.

## WHY
The typewriter/serif pairing is the brand's loudest typographic signal — it
does most of the "90s analog manuscript" work, so it must render identically on
both surfaces. The single-weight constraint on Special Elite is load-bearing:
any `font-weight`/`font-synthesis` you don't pin will produce muddy synthetic
bold and break the look. All-caps mono micro-labels with wide tracking are the
recurring structural device that ties chrome together.

## HOW
**Loading** — Google Fonts `<link>` with `preconnect` to
`fonts.googleapis.com` / `fonts.gstatic.com`, then
`css2?family=Special+Elite&family=Source+Serif+4:ital,opsz,wght@...&display=swap`.
Canonical weight axis: **Source Serif 4 300;400;600 + italic 400**, **Special
Elite 400**.

**Treatments (canonical):**
- All `h1`–`h6` / `.font-display`: `font-synthesis: none`,
  `letter-spacing: 0.01em`, weight 400.
- Micro-labels / kickers / nav: `font-mono` (Special Elite), **uppercase**,
  wide tracking — section kickers `tracking-widest`; structural labels
  `letter-spacing: 0.12em`–`0.2em`.
- Body: `--font-sans` (Source Serif 4), `leading-relaxed` for lead paragraphs.
- Type scale is Tailwind's default utility scale used inline (`text-4xl`
  headlines down to `text-[10px]`/`text-[9px]` micro-labels); no custom
  `--text-*` tokens.

Verified 2026-07-17 against `packages/marketing-site/src/styles/global.css:19-21,
84-93` + `index.astro` font `<link>` (surat) and
`packages/viewer/src/styles/global.css:26-28, 188-196` + `index.astro:13-18`
(san-jose). Unmerged branches — re-check on merge. Pairs with
[[Reference - Brand Palette]] for accent colour on links/kickers.
