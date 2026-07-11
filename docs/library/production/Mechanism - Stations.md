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
    "researching": { "doer": "agent", "skill": "william/research-a-skill",
                     "produces": ["research/"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william-draft-skill-md",
                     "produces": ["design.md", "output/SKILL.md"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"], "review": true }
  }
}
```

A station's `skill` is a **bundle slug in the same workspace**: the station
engine (`packages/core/src/StationEngine.ts`, `runStation`) resolves it to
`skills/<skill-slug>/`, installs that bundle's `output/` into a temp sandbox
as the agent's skill, seeds the sandbox with the current source files named
by `produces`, launches the configured ACP provider, then copies changed
files back and emits `review.requested` — landing the bundle in the
`awaiting-review` substate ([[../runs/Mechanism - Review Pair]]). Only
`doer: "agent"` stations run through the engine; a `"human"` doer is a
config-level declaration that the state's work is done by hand.

Launched via `skillmaker station run <slug>` (CLI:
`packages/cli/src/commands/StationRun.ts`) or the viewer — never
autonomously.

Deviation from the shipped default worth knowing: the default template's
`drafting` station names the real shipped skill `william-draft-skill-md`
(bundle slug — slugs cannot contain `/`), while `researching` still carries
the aspirational `william/research-a-skill` name, which is not a valid slug
and not a shipped bundle — a placeholder, documented as such in a code
comment in `Stations.ts`.

Verified: `packages/core/src/Stations.ts` (`Station`/`StationsFile` schemas,
`DEFAULT_STATIONS_TEMPLATE` with the exact shape above) and
`packages/core/src/StationEngine.ts` (`runStation` sandbox pipeline,
skill-slug resolution, `review.requested` emission).
