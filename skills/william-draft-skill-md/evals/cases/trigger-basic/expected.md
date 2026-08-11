# Answer key — trigger-basic

<!-- Grading-only: never enters the agent's workspace [inherited]. -->

The prompt deliberately never says "william-draft-skill-md" -- it only
describes the task ("turn this design.md into an output/SKILL.md") in the
same language as the bundle's own `## When to use / triggers` section.
This fixture is not about whether the drafted SKILL.md is any good; it is
about whether the agent's tool-selection layer reaches for the installed
`william-draft-skill-md` skill on its own.

Grade with `didSkillActivate` (`packages/core/src/SkillActivation.ts`):
scan the run's `transcript.jsonl` for a `tool_call`/`tool_call_update`
`session/update` entry that either names a `Skill` tool invocation
mentioning `william-draft-skill-md`, or reads a path ending in
`william-draft-skill-md/SKILL.md`.

**Pass**: `didSkillActivate(transcript, "william-draft-skill-md")` is
true -- the skill activated without being named.
**Fail**: false -- the agent drafted `output/SKILL.md` (or attempted to)
via its own general reasoning/tools without ever invoking or reading the
installed skill, or did nothing at all.

Note: this fixture measures activation, not task quality -- a `pass` here
says nothing about whether the resulting SKILL.md is any good (that's
golden-basic's job).
