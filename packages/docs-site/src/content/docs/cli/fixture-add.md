---
title: skillmaker fixture add
description: Scaffold evals/fixtures/<case>/ for a bundle.
---

```text
skillmaker fixture add <slug> <case> [--class <class>] [--risks IN-1,RE-2]
```

Scaffolds `evals/fixtures/<case>/` for an existing bundle: `case.json`,
`prompt.md`, `files/.gitkeep`, and an `expected/answer-key.md` skeleton.
Fixtures are plain files — this command never appends anything to the
journal.

## Options

| Flag | Meaning |
|---|---|
| `--class <class>` | One of `golden \| refusal \| empty \| rerun \| hard-case \| trigger`; defaults to `golden` |
| `--risks <ids>` | Comma-separated risk-map ids this case buys coverage for, e.g. `IN-1,RE-2` |
| `--json` | Emit machine-readable JSON instead of text |

## Output

```text
skillmaker: created fixture my-first-skill/evals/fixtures/golden-basic/ (class: golden)
```

## Example

```sh
skillmaker fixture add my-first-skill golden-basic --class golden --risks IN-1
```

produces:

```jsonc
// skills/my-first-skill/evals/fixtures/golden-basic/case.json
{
  "schemaVersion": 1,
  "case": "golden-basic",
  "class": "golden",
  "risks": ["IN-1"]
}
```

with the task prompt itself written into the sibling `prompt.md`.

## See also

[Fixtures and risk maps](/evals/fixtures-and-risk-maps/) for the full
fixture kit and file layout.
