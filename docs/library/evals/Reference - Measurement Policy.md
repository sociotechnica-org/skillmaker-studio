---
type: Reference
prefLabel: Measurement Policy
context: evals
status: migrated
links:
  related_to:
    - "./Economy - Pass Rate"
    - "./Capability - Eval Run"
---

## WHAT
The standard for how many graded runs a claim needs: smoke (k=5), estimate
(k=30), ship-gate (k=100) — the named k-tier policy shipped exactly as
before, plus a rule-of-three / Wilson confidence interval computed from
whatever `n` actually exists. Never pool across fixtures or versions; a
risk's headline is its weakest required test.

## WHY
The prep doc flagged this card ⚠ likely-KEEP-but-verify: data-model.md
itself doesn't restate the named k-tier table, only the CI mechanism
(§2.11: "CI (rule-of-three when 0 failures, else binomial)"). This is
**CONFIRMED, not just likely** — the k-tier policy shipped under the exact
names the old model used.

## HOW
`packages/core/src/Measurements.ts` defines:

```ts
export const SMOKE_K = 5;
export const ESTIMATE_K = 30;
export const SHIP_GATE_K = 100;

export const GUIDANCE_LEVELS = [
  { label: "smoke", k: SMOKE_K },
  { label: "estimate", k: ESTIMATE_K },
  { label: "ship-gate", k: SHIP_GATE_K },
];
```

`guidanceForN(n)` returns the highest label whose `k` threshold `n` meets
(or `undefined` below smoke). These are explicitly "guidance thresholds
surfaced as data, not enforcement" (module comment) — no CLI command or
guard blocks a run below a tier; the labels exist so the viewer/CLI can
tell you where a fixture's sample size sits.

The CI half: `confidenceInterval(passes, n)` picks `ruleOfThreeCi(n)` when
there are zero failures (95% upper bound on failure probability = `3/n`,
so pass-rate CI = `[1 - 3/n, 1]`), otherwise `wilsonCi(passes, n)` (95%
Wilson score interval, z = 1.959963984540054). Both match the "rule of
three when 0 failures, else binomial[-approximation]" description in
data-model.md §2.11.

A Pass Rate ([[Economy - Pass Rate]]) is earned across
[[Capability - Eval Run]] repetitions and reads its guidance label from
this policy.

**Verified — status: Verified.** Read `packages/core/src/Measurements.ts`
in full: `SMOKE_K = 5`, `ESTIMATE_K = 30`, `SHIP_GATE_K = 100`,
`GUIDANCE_LEVELS`, `guidanceForN`, `ruleOfThreeCi`, `wilsonCi`, and
`confidenceInterval` all shipped exactly as named. The prep doc's ⚠ is
resolved as CONFIRMED.
