---
type: Entity
prefLabel: Design Doc
context: authoring
status: migrated
links:
  contains:
    - "../evals/Reference - Untrusted-Input Rule"
  related_to:
    - "./Role - Director"
    - "./Role - Grader"
    - "../evals/Entity - Fixture"
    - "../evals/Entity - Risk Map"
    - "../outputs/Mechanism - Drift Hint"
---

## WHAT
`design.md` — the source of a Skill Bundle's logic. It is the bundle-owner's
(Director's) artifact: agent-drafted from clarified intent, holding the
*why* and the workflow logic, while `output/SKILL.md` holds only the task
instructions an agent runs with. Direct rename of the old Brief, minus the
move-graph grammar.

`design.md` has a light frontmatter (`bundle: <slug>`) and a
**recommended, not enforced** section skeleton:

- `## Intent` — what outcome the skill produces and for whom.
- `## When to use / triggers` — the situations that should activate it
  (seeds `SKILL.md`'s `description`).
- `## The workflow` — step-by-step logic in prose: numbered steps,
  decision points, what the agent must never do.
- `## Failure hypotheses` — a table: `# | How it could fail | Risk family`.
  The risk family column ties directly into `../evals/Entity - Risk Map`'s
  IN/RE/OUT/ADV/CHN bands — each hypothesis is meant to buy fixture
  coverage against a named risk.
- `## Proof spec` — which fixture cases the failure hypotheses demand,
  seeding `evals/`.

## WHY
The old Brief's §4 move graph (doers, consumes/emits contracts, bounce
edges) required a graph-authoring model that no longer exists — there is no
move-graph authoring in v1 (`Component - Move Graph`, `Component - Move`,
`Component - Node Prompt` all retire; SKILL.md is a single flat output, not
a set of per-move nodes). What survives is the underlying discipline: the
Director-owned document carries the logic and the reasoning about failure,
while the shipped skill body stays lean. The section skeleton is
recommended rather than enforced because there is no compiler or lint step
validating it — a `design.md` that is missing a section is still a valid,
usable `design.md`.

## HOW
`design.md` lives at `skills/<slug>/design.md`. The studio's "draft
SKILL.md from design" generation (the `drafting` station's skill) reads
this file directly; the drift hint (`../outputs/Mechanism - Drift Hint`)
hashes it against the last recorded `output/` version to compute
`in-sync` / `design-changed` / `output-hand-edited` / `both`.

The `## Failure hypotheses` table is not decorative: a station-drafting
agent is expected to carry every "must never" / "always stop and ask"
constraint listed there into the shipped `SKILL.md` body verbatim, and the
`## Proof spec` section is expected to name the fixture cases under
`evals/fixtures/<case>/` that exercise each hypothesis.

Verified: read the actual shipped `skills/william-draft-skill-md/design.md`
in the worktree. It has all five recommended sections in the documented
order (`## Intent`, `## When to use / triggers`, `## The workflow`,
`## Failure hypotheses`, `## Proof spec`), with a `# | How it could fail |
Risk family` table using real risk-family codes (IN/OUT/ADV) and a proof
spec naming fixture case ids (`golden-basic`, `refusal-empty-design`,
`revise-round`) that trace back to specific hypothesis numbers — matching
data-model.md §2.4's skeleton exactly. This confirms the skeleton is
followed in practice even though nothing enforces it; per the brief's
verification note, partial real examples missing a section would also be
expected and fine — this one simply happens to be complete.
