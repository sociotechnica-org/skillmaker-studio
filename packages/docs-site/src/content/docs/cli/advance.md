---
title: skillmaker advance
description: Move a bundle along the state machine (guarded).
---

```text
skillmaker advance <slug> [--to <stage>] [--back <stage> --reason <text>] [--override]
```

Moves a bundle one step along `idea → researching → drafting → evaluating →
published`, subject to the guards in
[the production state machine](/concepts/state-machine/). This is the same
guard function the viewer's `POST /api/events` uses — the CLI and the
viewer are two doors onto one contract.

## Options

| Flag | Meaning |
|---|---|
| `--to <stage>` | Target stage; defaults to the next stage forward |
| `--back <stage>` | Move backward to an earlier stage — requires `--reason` |
| `--reason <text>` | Reason for a backward move |
| `--override` | Bypass every guard (still journaled, with `override: true`, so it's visible history, not silent) |
| `--json` | Emit machine-readable JSON instead of text |

## Forward: blocked without an approved review

```sh
skillmaker advance my-first-skill
```

```text
skillmaker advance: forward transition from "idea" requires an approved
review ("review.resolved" with decision "approve" for state "idea")
recorded since the last stage change
```

Exit code `1`. Once [`skillmaker review request`](/cli/review-request/)'s
review has been approved in the viewer, the same command succeeds.

## Backward: always legal, but never silent

```sh
skillmaker advance my-first-skill --back idea
```

```text
skillmaker advance: --back requires --reason <text>
```

Exit code `2` (usage error) — a backward move without a reason is rejected
before it even reaches the guard check, because regression must always be
journaled with why.

```sh
skillmaker advance my-first-skill --back idea --reason "eval regressed after a model update"
```

succeeds unconditionally; the reason is recorded on the
`bundle.stage_changed` event.

## See also

[The production state machine](/concepts/state-machine/) for the full
guard table, including the publish gate on `evaluating → published`.
