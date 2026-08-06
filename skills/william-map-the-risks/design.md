---
bundle: william-map-the-risks
---
# Design — William Map The Risks

## Intent

Author `evals/risk-map.md` — the ways a skill can go wrong — and the fixtures
that buy each row.

This is the Evals piece, and it has no agent today: `stations.json` says the
evaluating station's doer is `agent` with no `skill` behind it, which is the
placeholder problem William exists to end.

Note what this skill does NOT do: it designs the testing strategy, it does not
run tests. Running happens in a playground we don't own.

## When to use / triggers

Use when a bundle has a prompt worth testing and no risk map, or a risk map
whose rows have no fixtures.

## The workflow

<!-- Unwritten on purpose. The shape of this one is a real conversation with
     the maker -- how risks band into families, when a row earns a fixture,
     what "covered" is allowed to mean. Inventing it here would be the exact
     fabrication agents/william.md forbids. -->

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | Claims coverage a fixture doesn't actually buy | OUT |
| 2 | Writes rows so generic they'd fit any skill | OUT |

## Proof spec

<!-- Follows the workflow. -->
