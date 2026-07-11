---
title: skillmaker review resolve
description: Resolve a pending review (approve or revise) without leaving the terminal.
---

```text
skillmaker review resolve <slug> --decision approve|revise [--notes <text>]
```

Resolves the bundle's pending review at its current stage: appends a
`review.resolved` event and moves the bundle out of the `awaiting-review`
substate back to `working`. This is the CLI's half of the
[non-blocking review pair](/concepts/state-machine/#the-non-blocking-review-pair)
— the other half is [`skillmaker review request`](/cli/review-request/).

`review resolve` writes through the exact same journal path the viewer's
review panel POSTs to (`POST /api/events`, guarded by the same
"is this bundle actually awaiting review at this stage?" check). Two doors,
one journal: a solo publisher can approve or send back work from the
terminal alone and never needs to open the browser, and CI automation can
resolve reviews the same way.

## Options

| Flag | Meaning |
|---|---|
| `--decision approve\|revise` | Required. `approve` satisfies `advance`'s forward guard; `revise` sends the bundle back to `working` with notes for the next station run. |
| `--notes <text>` | Free-text notes; carried into the next agent station's prompt on `revise`. |
| `--json` | Emit machine-readable JSON instead of text |

## Output

```text
skillmaker: resolved review for my-first-skill at stage "idea" (approve)
```

Fails (exit 1) if the bundle isn't currently awaiting review; fails (exit 2)
if `--decision` is missing or isn't `approve`/`revise`.

## Why this matters for `advance`

An approved review is what unlocks
[`skillmaker advance`](/cli/advance/)'s forward-move guard — `review resolve
--decision approve` is one way to produce that approval without the viewer.

## See also

[The production state machine](/concepts/state-machine/) for the full
guard table.
