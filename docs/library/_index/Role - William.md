---
type: Role
prefLabel: William
context: _index
status: migrated
links:
  related_to:
    - "../production/Economy - Station Doer"
    - "../production/Mechanism - Guarded Transition"
    - "../runs/Entity - Run"
---

## WHAT

William is the product's own agent: not a face-agent-for-a-division (that
org-spine machinery is dropped entirely), but the agent who actually drives
Skillmaker Studio's production stations, via his own skill-writing skills
living in the self-hosted `skills/` workspace. A station's `skill` field in
`stations.json` names a skill bundle in the same workspace — when that
bundle is one of William's, William is the agent doing that station's work.

## WHY

Agent-first production (data-model.md ruling, §2.13) means stations default
to agent doers rather than humans. That only works if there's a real agent
behind the station config, not a placeholder slug — William is that agent,
and the studio dogfoods its own product to build him: his skills are
themselves Skill Bundles, produced, drafted, evaluated, and published
through the exact same state machine every other bundle goes through.

## HOW

As of this writing, William has **one real, shipped skill**:
`skills/william-draft-skill-md/` — wired into the `drafting` station of the
default stations template (`packages/core/src/Stations.ts`,
`DEFAULT_STATIONS_TEMPLATE.stations.drafting.skill:
"william-draft-skill-md"`). Its `design.md` frames it plainly: "This is
William's first skill: the skill that drafts skills." It turns a bundle's
`design.md` into a first-cut (or revised) `output/SKILL.md`, runs headless
via `StationEngine.runStation`, and stops without advancing the bundle's
stage or touching `research/`/`evals/` — those stay separate, human-gated
steps.

The `researching` station in the same template names a second skill,
`william/research-a-skill` — but that slug is not (yet) a real bundle in
this workspace; `packages/core/src/Stations.ts`'s own comment notes station
skills resolve to bundle slugs (no `/` allowed — see
`WorkspaceService.ts`'s `SLUG_PATTERN`), so `william/research-a-skill` is
presently a placeholder/aspirational name, not a shipped skill. Only the
`drafting` station has a real agent (William) behind it today.

When `StationEngine.runStation` runs the `drafting` station for a bundle,
it installs `skills/william-draft-skill-md/output/` as the ACP skill,
prompts the agent with the target bundle's `design.md` (plus any
`review.resolved: revise` notes), and — on success — appends
`review.requested`, putting the target bundle into `awaiting-review`; a
human resolves it in the viewer.

Verified: `packages/core/src/Stations.ts` (`DEFAULT_STATIONS_TEMPLATE`,
lines 32-58, including its comment on `william/research-a-skill` being
aspirational and `william-draft-skill-md` being "Real, working skill as of
Phase 10"); `skills/william-draft-skill-md/design.md` (Intent section
names it "William's first skill"); `packages/core/src/StationEngine.ts`
(`runStation`, the skill-install + prompt + `review.requested` flow).
