# Prepare PR

Prepare the final pull request context.

Fabro's configured `[run.pull_request]` finalization creates the pull
request after this node. Write the PR title and body to these files:

- `/tmp/fabro-pr-title.txt`
- `/tmp/fabro-pr-body.md`

The body must be honest reviewer context, not a sales pitch. Include:

- Suggested PR title.
- What changed and why, tied to the plan in `docs/proposals/`.
- Validation: which gates ran (typecheck core/cli, `bun test packages`,
  `bun test test/e2e`, `bun run build:viewer` if the viewer changed) and
  their actual results.
- What verification proved, with pointers to the run's
  `verification-artifacts/` evidence.
- Any remaining risks, known gaps, skipped checks, or manual follow-up —
  stated plainly. If something was not verified, say so; do not imply
  coverage that does not exist.

Keep the summary concise and specific to Skillmaker Studio. Do not
describe this as a handoff to a human; write it as PR-ready reviewer
context.

The title file must contain exactly one line. The body file must contain
Markdown suitable for a draft pull request body.
