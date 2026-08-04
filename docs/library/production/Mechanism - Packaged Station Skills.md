---
type: Mechanism
prefLabel: Packaged Station Skills
context: production
status: new
links:
  related_to:
    - "./Mechanism - Stations"
    - "../_index/Role - William"
    - "../runs/Mechanism - Agent-Home Injection"
---

## WHAT

The product ships William's station skills inside itself: checked-in
copies of the William bundles live at `packages/cli/skills/`, ship in the
npm tarball and the desktop sidecar (as `packaged-skills/` next to the
compiled binary), and serve as the **fallback** when a station's `skill`
slug has no bundle in the workspace. Resolution is **workspace-wins**: a
workspace's own `skills/<slug>/` always beats the packaged copy, so
hacking on William locally still works.

## WHY

D6 ruled "William and a starter set of research/drafting skills ship
inside the product" (`docs/proposals/2026-07-21-simplification.md`), but
it stayed unbuilt until the 2026-07-27 from-scratch walk hit it as
friction entry 1 (`docs/friction/fresh-skill.md`): a truly fresh
workspace had no William, `StationEngine` resolved `station.skill` only
against the workspace, and the first station failed with a precondition
error — every workspace had to hand-carry his bundles (which also
polluted the Board as skills-under-work). Fixed same day, PR #171.

## HOW

`packages/cli/src/PackagedSkills.ts` locates the packaged directory with
the same two-walk shape as the viewer's `ViewerDist.ts`: an ancestor walk
from the module URL looking for `packages/cli/skills` (the monorepo
checkout — a drift test keeps those copies in lockstep with the repo's
own self-hosted `skills/` workspace), else an ancestor walk from the
executable's directory looking for `packaged-skills/` (the
`build-dist.sh` layout). Missing packaged skills are NOT an error — a
workspace whose stations only reference its own skills never needs them,
so the locator returns `undefined` and `StationEngine.runStation`'s
precondition error names the missing fallback only when a skill resolves
nowhere. `StationEngine.resolveStationSkillDir` returns the resolved
directory with `source: "workspace" | "packaged"`.

Verified: `packages/cli/src/PackagedSkills.ts` (locator, D6 citation,
`PACKAGED_SKILLS_DIRNAME = "packaged-skills"` and its build-script
coupling note) and `packages/core/src/StationEngine.ts`
(`resolveStationSkillDir`, `packagedSkillsDir` input, workspace-wins
order); origin story against `docs/friction/fresh-skill.md` entry 1.
