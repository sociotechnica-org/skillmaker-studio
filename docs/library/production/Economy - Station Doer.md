---
type: Economy
prefLabel: Station Doer
context: production
status: migrated
links:
  related_to:
    - "./Entity - Skill Bundle"
    - "./Mechanism - Guarded Transition"
    - "../_index/Role - William"
    - "../runs/Entity - Run"
---

## WHAT

`doer: "agent" | "human"` — the field on each entry in a bundle's
`stations.json` naming who does that production state's work. This is the
new home of the old per-*move* Doer economy (judgment / mechanical /
human), moved one altitude up: instead of labeling every individual step in
a move graph, the label now applies once per production *state*
(researching, drafting, evaluating).

## WHY

⚠ **Open question carried forward from the prep doc (open question 5):**
collapsing doer labeling from per-move to per-station loses the old model's
finer-grained honesty check. The old Doer Honesty standard existed because
a single mislabeled *move* could quietly "make software of a conversation"
— automate a step that was actually a judgment call. At station
granularity, an entire state's worth of work (e.g. all of drafting) is
labeled agent or human as one unit; there is no sub-field in
`stations.json` for flagging that only *part* of a station's work is safe
to automate. The prep doc leaves this open rather than resolving it, and
this card does the same — noted here as an explicit ⚠, not silently
dropped.

## HOW

```jsonc
// stations.json
{
  "schemaVersion": 1,
  "template": "default",
  "stations": {
    "researching": { "doer": "agent", "skill": "william/research-a-skill",
                      "produces": ["research/"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william-draft-skill-md",
                      "produces": ["design.md", "output/SKILL.md"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"], "review": true }
  }
}
```

`stations.json` is copied — not referenced — from an app-level template at
`skillmaker new`, so a bundle's station config is frozen with the bundle at
creation time. Only `doer: "agent"` stations run through
`StationEngine.runStation`; a `doer: "human"` station has no `skill` to
resolve and is presumably done by a person directly editing the bundle's
files, though the current shipped code path (`StationEngine.ts`) explicitly
rejects running a non-agent station through the engine rather than
describing a human-doer workflow.

Verified: `packages/core/src/Stations.ts`'s `Station` schema class
(`doer: StationDoer`, `Schema.Literals(["agent", "human"])`) and
`DEFAULT_STATIONS_TEMPLATE`; `packages/core/src/StationEngine.ts`'s
`runStation` fails with `StationPreconditionError` when
`station.doer !== "agent"` ("only \"agent\" stations run through the
station engine").
