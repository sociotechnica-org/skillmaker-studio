---
title: Fixtures and risk maps
description: The fixture kit, risk families, and how to author coverage.
---

An eval **fixture** is one task case a skill gets tested against. A
**risk map** is the authored coverage axis over a bundle's failure modes —
which risks exist, and which fixtures buy coverage for them.

## Fixture classes

Every fixture belongs to one of five inherited classes:

| Class | Purpose |
|---|---|
| `golden` | The skill should succeed cleanly |
| `refusal` | The skill should decline (e.g. input too thin to act on safely) |
| `empty` | Degenerate/empty input handling |
| `rerun` | Same input run again — checks for consistency, not just one-shot success |
| `hard-case` | Deliberately adversarial or edge-case input |

## Scaffolding a fixture

```sh
skillmaker fixture add my-first-skill golden-basic --class golden --risks IN-1
```

```text
skillmaker: created fixture my-first-skill/evals/fixtures/golden-basic/ (class: golden)
```

This creates `evals/fixtures/golden-basic/`:

```text
evals/fixtures/golden-basic/
  case.json               # classification: class, risks[]
  prompt.md                # the task prompt sent to the agent (prose)
  files/.gitkeep            # workspace inputs copied into the run
  expected/answer-key.md     # grading key -- never shown to the agent
```

`case.json`:

```jsonc
{
  "schemaVersion": 1,
  "case": "golden-basic",
  "class": "golden",
  "risks": ["IN-1"]
}
```

`--class` defaults to `golden` if omitted; `--risks` is a comma-separated
list of risk-map ids (e.g. `IN-1,RE-2`).

:::note[The prompt lives in `prompt.md`, not `case.json`]
Earlier drafts of the data model put the task prompt in a `case.json`
`"prompt"` field. That was superseded during Phase 7: the prompt is prose,
so it lives in a sibling `prompt.md` file, and `case.json` stays pure
classification data (`schemaVersion`, `case`, `class`, `risks`, optional
`setup`/`grading`). A `case.json` with a legacy `prompt` string field still
works but produces a warning suggesting the move to `prompt.md` — see
[reindex warnings](#reindex-warnings-not-hard-failures) below.
:::

### Optional fields

```jsonc
{
  "schemaVersion": 1,
  "case": "refusal-thin-input",
  "class": "refusal",
  "risks": ["RE-1", "IN-2"],
  "setup": {
    "files": "files/",            // copied into the run workspace
    "env": {}                      // env vars for the agent process
  },
  "grading": {
    "answerKey": "expected/answer-key.md",
    "checks": [
      "Declines to fabricate metrics",
      "Asks for the missing input instead of guessing"
    ]
  }
}
```

`grading.checks` is rendered as a checklist in the (planned) read-out UI —
see the [Roadmap](/roadmap/). The answer key is grading-only and is never
copied into the agent's run workspace; adversarial fixtures may plant
untrusted-input attacks under `files/`.

## Risk maps

`evals/risk-map.md` is the authored coverage axis for a bundle — a plain
markdown table, no results column:

```markdown
---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | refusal-thin-input |
| RE-1 | Invents metrics | ◐ partial | golden |
| ADV-1 | Prompt injection via pasted doc | ○ gap | — |
```

Every risk id must band into one of five families, checked at
`skillmaker reindex`:

| Family | Meaning |
|---|---|
| `IN` | Input risks |
| `RE` | Reasoning risks |
| `OUT` | Output risks |
| `ADV` | Adversarial risks |
| `CHN` | Chain risks |

There is deliberately **no results column** here — whether a risk is
actually validated is a separate, measured fact computed from graded runs
and joined at read time. See
[Coverage vs. validation](/evals/coverage-vs-validation/).

## Reindex warnings, not hard failures

Fixture and risk-map validation never blocks the workspace: an unknown
fixture class, an unbanded risk id, or a legacy `prompt` field in
`case.json` all surface as **warnings** (via `skillmaker reindex`, and
in the CLI/viewer), not hard failures. This was a deliberate ruling: hard
CI-style gates were right for the predecessor studio's monorepo, wrong for
a product where authoring should never be blocked by a typo.
