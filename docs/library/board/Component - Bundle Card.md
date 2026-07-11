---
type: Component
prefLabel: Bundle Card
context: board
status: migrated
links:
  derived_from:
    - "../production/Entity - Skill Bundle"
  related_to:
    - "./Component - Board Column"
    - "../production/Economy - Awaiting-Review Substate"
---

## WHAT

A bundle's representation on the Board: name, monospace slug, an
"awaiting review" badge when the bundle's substate calls for it, an
optional one-liner, and a fixture count. Implemented as `BundleCard` in
`packages/viewer/src/app/components/BundleCard.tsx`.

## WHY

Same job the old Play Card did — legible, at-a-glance identity for the
card a Director clicks into — but stripped of everything that depended on
the retired org spine. There is no Division/Function glyph anymore because
there is no Division/Function; cross-ref `../production/Entity - Skill
Bundle` for what identity a bundle actually carries now (slug, name,
oneLiner, tags, created, targets — no tier, no filing).

## HOW

`BundleCard` is `derived_from` a `BundleRecord` (the `bundles` materialized
row, data-model.md §2.11) — it reads `bundle.name`, `bundle.slug`,
`bundle.substate`, `bundle.oneLiner`, plus a `fixtureCount` passed in from
the parent. It renders an amber "awaiting review" pill only when
`bundle.substate === "awaiting-review"` (the substate badge, §2.13).
Clicking the card is a real navigation to the bundle's own route
(`bundleHref(slug)`), not a local panel toggle.

**Deviation from the prep doc's expected shape:** the prep doc description
("stage badge, substate badge") is not quite what shipped. There is no
separate stage badge on the card itself — stage is communicated entirely
by which `Board Column` the card sits in, not repeated as a badge on the
card. Only the substate (`awaiting-review`) gets its own badge. `tags[]`
is also not rendered on the card in the current viewer (it exists on the
bundle identity but isn't surfaced here yet).

Verified: `packages/viewer/src/app/components/BundleCard.tsx` — props are
`bundle: BundleRecord`, `fixtureCount?`, `onSelect?`; the only conditional
badge is `bundle.substate === "awaiting-review"`; no stage text or tags
list appears anywhere in the render.
