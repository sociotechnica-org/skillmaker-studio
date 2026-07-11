---
title: skillmaker review request
description: Request review of the bundle's current stage work.
---

```text
skillmaker review request <slug> [--question <text>]
```

Requests a review of the bundle's work at its current stage: appends a
`review.requested` event and moves the bundle into the `awaiting-review`
substate. This is the CLI's half of the
[non-blocking review pair](/concepts/state-machine/#the-non-blocking-review-pair)
— resolution (`approve` or `revise`) happens in the viewer's review panel.

## Options

| Flag | Meaning |
|---|---|
| `--question <text>` | Question for the reviewer |
| `--json` | Emit machine-readable JSON instead of text |

## Output

```text
skillmaker: requested review for my-first-skill at stage "idea"
```

## Why this matters for `advance`

An approved review is what unlocks
[`skillmaker advance`](/cli/advance/)'s forward-move guard — without one,
`advance` refuses to move the bundle forward at all.

## See also

[The production state machine](/concepts/state-machine/) for the full
guard table.
