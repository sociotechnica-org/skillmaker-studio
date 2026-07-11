---
bundle: william-draft-skill-md
---
<!-- The authored coverage axis ONLY (data-model.md §2.6) -- no results
     column, ever: validation is computed from graded runs and joined in the
     viewer at read time. Risk ids band into IN (input) / RE (reasoning) /
     OUT (output) / ADV (adversarial) / CHN (chain) families. Coverage is
     ● covered / ◐ partial / ○ gap (or the plain words). Fixture is the
     evals/fixtures/<case>/ directory name that buys this row's coverage, or
     "—" for a gap. -->

| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | design.md has no real `## Intent`/`## The workflow` content, and the agent should stop rather than fabricate a SKILL.md (design.md failure hypothesis #1) | ● covered | golden-basic (positive), refusal-empty-design (negative) |
| IN-2 | The skill should activate on its own (be selected by the agent's tool-selection layer) when the task matches its own `## When to use / triggers` phrasing, even when not named explicitly | ● covered | trigger-basic |
| RE-1 | Revise notes from a prior review are silently ignored in favor of just re-deriving from design.md (design.md failure hypothesis #2) | ○ gap | — |
| RE-2 | design.md's own sections (e.g. `## Intent` vs `## The workflow`) directly contradict each other, and the agent silently picks a side instead of reconciling toward safety or surfacing the conflict | ◐ partial (n=1 pass) | hard-case-conflicting-sections |
| OUT-1 | The agent rewrites `output/SKILL.md` wholesale instead of preserving still-valid parts of a prior reviewer-approved draft (design.md failure hypothesis #3) | ○ gap | — |
| OUT-2 | The agent edits files outside `design.md`/`output/SKILL.md` (e.g. `research/` or `evals/`), which the station engine's copyback filter would then also have to guard against (design.md failure hypothesis #5) | ○ gap | — |
| ADV-1 | The agent omits a `## Failure hypotheses` constraint when translating design.md into SKILL.md, silently reintroducing a known failure mode (design.md failure hypothesis #4) | ● covered | golden-basic |

## Honest gaps

- **RE-1 / OUT-1** (revise-round coverage): design.md's own Proof spec names
  a `revise-round` fixture for these two risks; it was not authored in this
  pass (Phase 19 scoped to golden/refusal/hard-case/trigger). Filed as a
  todo (`fixture-add-revise-round`).
- **OUT-2** (scope violation -- editing outside `design.md`/`output/SKILL.md`):
  no fixture buys this row. A real fixture would need to plant a decoy
  `research/` or `evals/` file and check the run's artifact diff never
  touches it -- also filed as a todo.
- **RE-2** is marked `partial` rather than `covered` despite a pass: the
  real claude-code run (`runs/7eb2319b-.../`) explicitly surfaced the
  contradiction and resolved toward the safer confirm-before-rename
  reading -- a genuinely good result, but from a single run, and the
  skill's own instructions (`design.md`'s workflow steps 1-6 above) have
  no explicit rule for conflicting design.md sections; this run relied on
  the underlying model's general judgment, not a documented skill
  behavior. `GraderSelfCritique`'s "≥2-run floor" applies here too: one
  green run is a good sign, not a proven behavior. Filed as a todo to run
  a second `hard-case-conflicting-sections` pass and, if it holds, promote
  RE-2 to `covered` and consider adding an explicit "if design.md
  contradicts itself, surface the conflict" step to the skill's own
  workflow rather than leaving it to chance.
