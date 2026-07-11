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

As of this writing, William has **two real, shipped skills**, one per
default station he covers:

- `skills/william-draft-skill-md/` — wired into the `drafting` station of
  the default stations template (`packages/core/src/Stations.ts`,
  `DEFAULT_STATIONS_TEMPLATE.stations.drafting.skill:
  "william-draft-skill-md"`). Its `design.md` frames it plainly: "This is
  William's first skill: the skill that drafts skills." It turns a
  bundle's `design.md` into a first-cut (or revised) `output/SKILL.md`,
  runs headless via `StationEngine.runStation`, and stops without
  advancing the bundle's stage or touching `research/`/`evals/` — those
  stay separate, human-gated steps.
- `skills/william-research-a-skill/` — wired into the `researching`
  station (`DEFAULT_STATIONS_TEMPLATE.stations.researching.skill:
  "william-research-a-skill"`, fixed in Phase 19 from an earlier
  placeholder slug, `william/research-a-skill`, that violated bundle-slug
  rules — see below). Its `design.md` frames it as "William's second
  skill: the skill that researches skills." Given a bundle's topic
  (`bundle.json`'s `oneLiner` and `design.md`'s `## Intent`), it writes
  `research/notes.md` — facts/conventions, edge cases framed as "must
  handle"/"must never", and named open questions — and stops there,
  leaving `design.md` and `output/SKILL.md` to the `drafting` station.

Both stations therefore have a real agent (William) behind them today —
there is no longer a placeholder skill slug in the default template. The
earlier note on this card, that `william/research-a-skill` was an
aspirational slug rather than a real bundle, described a real gap at the
time (Phase 10 through 18) but is now stale; `packages/core/src/Stations.ts`'s
comment on the `researching` station has likewise been updated to point at
the real bundle instead of the placeholder.

`william-research-a-skill`'s own proof is thinner than
`william-draft-skill-md`'s: its `golden-basic` fixture is authored and its
one clean transcript shows genuinely good research output, but three real
`skillmaker run` attempts against it all came back `status: "infra-error"`
(a `RunEngine`/`AcpClient` classification or reliability issue under this
fixture's roughly dozen permission round-trips, not a skill-text problem —
see `skills/william-research-a-skill/evals/risk-map.md`'s "Honest gaps"
and the filed todo). It ships real, but not yet cleanly measured.

When `StationEngine.runStation` runs a station for a bundle, it installs
that station's skill's `output/` as the ACP skill, prompts the agent with
the target bundle's relevant files (plus any `review.resolved: revise`
notes), and — on success — appends `review.requested`, putting the target
bundle into `awaiting-review`; a human resolves it in the viewer.

Verified: `packages/core/src/Stations.ts` (`DEFAULT_STATIONS_TEMPLATE`,
both `researching.skill: "william-research-a-skill"` and
`drafting.skill: "william-draft-skill-md"` now naming real bundles);
`skills/william-draft-skill-md/design.md` (Intent section names it
"William's first skill"); `skills/william-research-a-skill/design.md`
(Intent section names it "William's second skill"); `skills/william-
research-a-skill/evals/risk-map.md` (honest-gaps section on the ungraded
`golden-basic` fixture); `packages/core/src/StationEngine.ts`
(`runStation`, the skill-install + prompt + `review.requested` flow).
