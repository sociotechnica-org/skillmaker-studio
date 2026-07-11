# Source — The macOS / desktop app thesis

> **Type:** source note (frozen provenance — director's original thinking,
> captured 2026-07-11, sibling to
> [`2026-07-11-skills-repo-marketplace-thesis.md`](2026-07-11-skills-repo-marketplace-thesis.md)).
> Feeds a future library update; not a plan or ruling. Interpretive notes
> below the line are Raven's, from the same conversation.

## Director's thinking (2026-07-11)

Wondering if we should be creating a **macOS app** for this.

A lot of people who use skills are **non-technical**. A desktop app version
could be *really* helpful for managing skills **without having to install a
CLI**.

## Raven's interpretive notes (same conversation)

- The architecture is already ~80% of a desktop app: the viewer is a static
  web app served by a single dependency-free compiled binary (Phase 12a).
  A Tauri shell with the binary as a sidecar = double-clickable
  Skillmaker.app, no CLI, no terminal. Cheap, low-risk.
- The persona splits in two, with very different costs:
  1. **Technical-but-app-preferring** — Tauri wrapper serves them nearly
     for free; git stays, they just never see a terminal.
  2. **Genuinely non-technical skill managers** — requires git fully hidden
     (app becomes the VCS), an eval story not assuming claude-code, and a
     skill-installation path into claude.ai / Claude Desktop, which today
     is manual zip-upload with no API. A different product on the same data
     model, blocked on distribution rails Anthropic hasn't built.
- Unresolved dependency for persona 2: how do non-technical users install
  and run skills at all? The competitive scan may partially answer whether
  this population exists and is underserved.

## Open (for a future ruling)

- Rule the Tauri wrapper in as a plan phase vs defer.
- Whether persona 2 is a product bet worth carrying as a standing thesis.
- Windows/Linux implications if the wrapper lands.
