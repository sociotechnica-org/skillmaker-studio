---
title: The production state machine
description: How a bundle moves through idea → researching → drafting → evaluating → published.
---

Skillmaker Studio's production line is **one universal state machine**,
defined once in `@skillmaker/core`, shared by every Skill Bundle. What
varies per bundle is *how* the work at each stage gets done (its
`stations.json`), never the stage set or the transition rules.

## Stages

```text
idea → researching → drafting → evaluating → published
```

plus an orthogonal `archived` flag. Each stage also has a **substate**:
`working` or `awaiting-review`. Requesting a review moves a bundle into
`awaiting-review`; resolving it (`approve` or `revise`) moves it back to
`working`.

## Guards

Every stage change is journaled as a `bundle.stage_changed` event, and
every one is checked against a guard before it's allowed to append — the
CLI (`advance`, `review request`) and the server's `POST /api/events` share
the exact same guard function, so there is no way to move a bundle from the
viewer that the CLI would reject, or vice versa.

| Transition | Guard |
|---|---|
| Forward one stage | An approved review (`review.resolved` with `decision: "approve"`) for the **current** stage's work, recorded since the last stage change |
| `evaluating → published` | The forward guard above, **plus** an approved publish gate (`bundle.gate_decided` with `gate: "publish"`, `decision: "approved"`) recorded since the last stage change |
| Backward (any stage → an earlier one) | Always legal, but requires a **non-empty reason** — regression is a modeled fact (evals regress, models change), not an embarrassment |
| `--override` | Bypasses every guard above; still journaled as a `bundle.stage_changed` with `override: true`, so overrides are visible history, not silent — the escape hatch for station-less bundles (imported skills, quick captures) |

Forward moves are always exactly one stage at a time — you can't jump from
`idea` straight to `drafting` even with an approved review. A stale `from`
(the bundle has already moved since you last read its status) is rejected
outright, guard or no guard.

## Walking through it by hand

A freshly created bundle starts at `idea` / `working`. Trying to advance it
immediately fails:

```sh
skillmaker advance my-first-skill
```

```text
skillmaker advance: forward transition from "idea" requires an approved
review ("review.resolved" with decision "approve" for state "idea")
recorded since the last stage change
```

Request a review, then approve it (today, review resolution is driven from
the viewer's review panel — see the review-pair note below), and the same
`advance` call succeeds:

```sh
skillmaker review request my-first-skill --question "Ready?"
```

```text
skillmaker: requested review for my-first-skill at stage "idea"
```

That's the CLI's half of the pair — see
[`skillmaker review request`](/cli/review-request/) for the full flag set,
and [`skillmaker advance`](/cli/advance/) for `--to`, `--back`, `--reason`,
and `--override`.

## The non-blocking review pair

Requesting a review never blocks anything — the bundle just enters
`awaiting-review` and work can continue elsewhere. A human resolves the
review in the viewer: **approve** satisfies the forward guard for that
stage; **revise** (with notes) clears the `awaiting-review` substate
without unlocking the guard, so the work continues at the same stage. This
is deliberate: human gates are data on the journal, never a blocked
process.

## Why backward moves are always legal

Regression is treated as a first-class, modeled fact rather than something
to hide: an eval that used to pass can start failing (models change,
fixtures get stricter), and moving a bundle back from `evaluating` to
`drafting` with a reason is exactly as legitimate a journal entry as moving
it forward. The only requirement is a non-empty `--reason`.
