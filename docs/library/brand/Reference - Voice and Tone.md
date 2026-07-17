---
type: Reference
prefLabel: Voice and Tone
context: brand
status: new
links:
  related_to:
    - "./Concept - LifeBuild Brand"
    - "../_index/Concept - Skillmaker Studio"
---

## WHAT
One brand, **two registers** keyed to surface:

- **Marketing (site) — loud.** Noir/detective crossed with late-night
  infomercial. Second-person, wry, confident, anti-corporate. Drift is a
  "case," skills are "suspects," results are "receipts."
  - Hero: *"Skillmaker Studio — Your agent did something weird again."*
  - Tagline: *"…turns drift into a number, blame into a lookup, and breakage
    into a fix — receipts on every skill."*
  - Section heads: *"Meet the suspects." / "Become a case-closing machine."*
  - Payoff: *"Drift doesn't stop. It stops mattering."*
  - Honesty flex: *"Free, local, MIT-licensed, no account. It phones nothing
    home."*

- **Product (viewer) — quiet.** Terse, plain, matter-of-fact. Workshop /
  stock-and-flow vocabulary, never jokey. The retro character comes entirely
  from **typography**, not copy.
  - Nav taxonomy: **Board · Lab · Ship · Receive · Activity**.
  - Empty states are uniformly *"No X yet."* (`No events yet.`, `No bundles
    yet.`, `No todos yet.`).
  - Microcopy instructs plainly: *"Pick a verdict to enable submit."*,
    *"Grade this run"*, *"Not graded yet."*
  - `—` (em dash) is the placeholder/empty glyph in tables.

## WHY
The split is intentional and worth protecting: marketing has to *win a click*,
so it performs; the product sits with you all day, so it gets out of the way. A
common failure mode is leaking the loud voice into the product (cutesy empty
states, jokes in error messages) — don't. Conversely, the marketing site should
never read like enterprise SaaS boilerplate; its edge is the honesty and the
noir wit.

## HOW
**Shared rules (both surfaces):**
- Lowercase sentence-case microcopy; no Title Case Buttons.
- No corporate filler ("empower", "seamless", "solutions"). Say the true,
  slightly blunt thing ("phones nothing home", "the only thing you risk is
  finding out").
- Prefer concrete workshop nouns (bundle, run, verdict, drift, receipt) over
  abstractions.

**Register by surface:** marketing may use metaphor, rhetorical second person,
and punchlines. In-product copy stays literal, short, and status-first — if a
string could be a headline, it's too loud for the product.

Verified 2026-07-17 from copy in `packages/marketing-site/src/pages/index.astro`
(surat) and UI strings across `packages/viewer/src/app/components/*` (san-jose,
e.g. `Header.tsx:9-17`, `ActivityFeed.tsx:78`, `RunDetailModal.tsx:268,324`).
Unmerged branches — re-check on merge. Anchors to
[[Concept - Skillmaker Studio]] for the product's core model and vocabulary.
