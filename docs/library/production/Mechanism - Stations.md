---
type: Mechanism
prefLabel: Stations
context: production
status: new
links:
  contains:
    - "./Economy - Station Doer"
  related_to:
    - "./Mechanism - Guarded Transition"
    - "../runs/Entity - Run"
    - "../runs/Mechanism - Review Pair"
    - "../_index/Role - William"
---

## WHAT

Per-bundle work configuration: `skills/<slug>/stations.json` names, for each
production state, who does that state's work (`doer: "agent" | "human"`),
which skill the station-agent runs with, what paths the work `produces`, and
whether the result goes to `review`. A station is how a state gets its work
done; the state machine ([[Mechanism - Guarded Transition]]) is how the
bundle moves once that work is approved.

## WHY

The old model had no per-state work config at all — production advice lived
in prose and the per-*move* Doer economy. Stations make production
agent-first by default (data-model.md's agent-first ruling): every state in
the default template is `doer: "agent"`, and a station run is a first-class
[[../runs/Entity - Run|Run]] (`kind: "station"`) with a transcript, not an
untracked working session. The file is **copied, not referenced**, from an
app-level template at `skillmaker new` — each bundle owns its config and can
diverge without breaking others (template provenance is recorded in the
`template` field).

## HOW

`stations.json` shape (schema: `packages/core/src/Stations.ts` —
`StationsFile` / `Station`):

```jsonc
{
  "schemaVersion": 1,
  "template": "default",           // provenance of the copy
  "stations": {
    "researching": { "doer": "agent", "skill": "william-research-a-skill",
                     "produces": ["research/"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william-draft-skill-md",
                     "produces": ["design.md", "output/SKILL.md"],
                     "seeds": ["research/"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"],
                     "seeds": ["research/", "design.md", "output/"], "review": true }
  }
}
```

A station's `skill` is a **bundle slug in the same workspace**: the station
engine (`packages/core/src/StationEngine.ts`, `runStation`) resolves it to
`skills/<skill-slug>/`, installs that bundle's `output/` into a temp sandbox
as the agent's skill, seeds the sandbox with the current source files named
by `seeds` + `produces` (`seeds` is read-only upstream context — e.g. the
drafting station reads the researching station's `research/` — and is never
copied back; copyback stays filtered to `produces` alone), launches the
configured ACP provider, then copies changed
files back and emits `review.requested` — landing the bundle in the
`awaiting-review` substate ([[../runs/Mechanism - Review Pair]]). Only
`doer: "agent"` stations run through the engine; a `"human"` doer is a
config-level declaration that the state's work is done by hand.

Launched via `skillmaker station run <slug>` (CLI:
`packages/cli/src/commands/StationRun.ts`) or the viewer — never
autonomously.

Both agent stations with a `skill` now name real shipped bundles:
`researching` names `william-research-a-skill` and `drafting` names
`william-draft-skill-md` (bundle slugs — slugs cannot contain `/`). An
earlier revision of this card noted `researching` carried a
`william/research-a-skill` placeholder; that deviation is gone.

Note: `stations.json` is a copy, so bundles created before `seeds` existed
keep their old copies and are not auto-migrated — the `template` provenance
field is how a divergent copy is recognized.

Verified: `packages/core/src/Stations.ts` (`Station`/`StationsFile` schemas,
`DEFAULT_STATIONS_TEMPLATE` with the exact shape above) and
`packages/core/src/StationEngine.ts` (`runStation` sandbox pipeline,
skill-slug resolution, `review.requested` emission).
