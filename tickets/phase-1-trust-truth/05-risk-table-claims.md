---
id: 05
title: "Risk table leads with the claim sentence"
blocked-by: []
---

## What to build

The Coverage section's table shows each risk's Description (the claim
sentence) as the primary cell — id becomes a small handle beside it —
so a reader who has never seen the ids understands every row. The
section header drops the self-narrating subtitle ("the authored axis, in
its own words") for a plain heading.

## Acceptance criteria

- [ ] Every risk row displays its full description sentence from risk-map.md
- [ ] Rows without a description render an explicit "no description" state, not a blank
- [ ] The header contains no design-rationale prose
- [ ] Family grouping (Input/Reasoning/Output/Adversarial/Chain) is preserved

## Scope fence

Read/display only — no changes to risk-map.md parsing beyond reading the
Description column, no structured-risk storage migration (that is IA §C
rule 10, a later phase), no coverage computation changes.
