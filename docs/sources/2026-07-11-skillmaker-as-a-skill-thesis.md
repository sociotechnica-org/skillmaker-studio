# Source — Skillmaker distributed *as a skill*

> **Type:** source note (frozen provenance — director's original thinking,
> captured 2026-07-11, third in the distribution-thesis series). Feeds a
> future library update. Interpretive notes below the line are Raven's.

## Director's thinking (2026-07-11)

Another interesting distribution mechanism for skillmaker-studio is **as a
skill itself**. Once it's available in the Claude marketplace, there's a
**natural distribution mechanism**.

## Raven's interpretive notes (same conversation)

- Precedent is exact: Anthropic's own **skill-creator** distributes this
  way — a plugin/skill in the official marketplace that *is* the product.
  Skillmaker-as-a-skill would be a SKILL.md (+ scripts) that teaches any
  Claude Code session to: install the studio (or find the binary), init a
  workspace, drive the loop (new/run/grade/advance/publish) conversationally.
- The recursion is the marketing: *a skill, published in the marketplace
  with its own receipts, that manages skills.* Skillmaker's own skillbook
  entry becomes the proof-of-product.
- Distribution stack now has four rungs: (1) CLI from source, (2) compiled
  binary, (3) desktop app (Phase 15), (4) **skill in the marketplace(s)** —
  the lowest-friction rung: `/plugin install skillmaker@...` and the studio
  is a conversation away, no terminal knowledge needed. Notably this
  partially serves the desktop thesis's persona 2 (non-technical) — for
  Claude Code users — without a GUI at all.
- Natural home: the self-hosted `skills/` workspace — the skillmaker skill
  is developed IN skillmaker, evaluated with its own fixtures, published
  through its own gate. Maximal dogfood; every Skillmaker law applies to
  its own distribution artifact.
- Cost: small — one bundle + the packaging Phase 11 already builds. The
  skill's design doc must be careful about what it drives (installing
  binaries from a skill needs a trust story).

## Open (for a future ruling)

- Scope of the v1 skill: full-loop driver vs "install + start + explain"?
- Marketplace target: our own marketplace repo first, or submit to
  anthropics' curated directory?
- Whether this becomes Phase 11's flagship publish artifact (the studio
  publishing itself as its own first shipped skill).
