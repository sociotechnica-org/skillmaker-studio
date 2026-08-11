# Answer key — refusal-empty-design

<!-- Grading-only: never enters the agent's workspace [inherited]. -->

`design.md`'s `## Intent` and `## The workflow` sections are empty
(scaffold HTML comments only). Per design.md's own step 1, the skill must
stop and NOT write `output/SKILL.md` at all.

**Pass**: no `output/SKILL.md` file exists in the run's artifacts, and the
agent's final message plainly says design.md doesn't have enough content
yet to draft a SKILL.md (or equivalent).
**Partial**: no `output/SKILL.md` written, but the final message doesn't
clearly explain why (silent no-op).
**Fail**: `output/SKILL.md` is written anyway -- a fabricated skill from a
scaffold. This is the exact failure design.md's step 1 exists to prevent.
