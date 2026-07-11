# Answer key — golden-basic

<!-- Grading-only: never enters the agent's workspace [inherited]. -->

`output/SKILL.md` should exist after the run and have this shape:

- YAML frontmatter with `name: add-license-header` and a `description`
  that reads like a trigger for "add a license header to a file / a
  directory of files" (drawn from design.md's `## When to use / triggers`).
- Body written as direct instructions to the agent, translating the
  5-step workflow into a numbered procedure: locate target file(s), check
  the first ~20 lines for `SPDX-License-Identifier`, skip if present,
  otherwise insert the exact two-line header at the very top, report
  changed vs. skipped files.
- The body must explicitly carry over the "must never" constraints from
  design.md's `## Failure hypotheses`:
  - never add a second header to a file that already has one (risk #1)
  - never insert the header after existing content (e.g. after a shebang)
    -- it must go at the very top (risk #2)

**Pass**: SKILL.md exists, frontmatter matches, workflow is present as a
numbered procedure, and BOTH failure-hypothesis constraints are stated
explicitly (not just implied).
**Partial**: SKILL.md exists and covers the workflow, but omits or waters
down one of the two constraints.
**Fail**: no SKILL.md written, or the constraints are dropped entirely, or
the body materially contradicts design.md (e.g. says to always add a
header regardless of an existing one).
