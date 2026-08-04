# Verify

Verify that the implemented feature works. This is an execution stage,
but it is not an implementation stage.

Before running checks:

- Read the goal from the workflow context.
- Read the checked-in plan under `docs/proposals/` named by the scope
  stage.
- Inspect the implementation diff and changed files.
- Read package-local README and guidance files for every package changed
  by the implementation.

Do not assume the plan's verification section is sufficient. First write
an independent verification plan to:

```text
verification-artifacts/verification-plan.md
```

That plan must include:

- A short assessment of the technical plan's verification instructions.
- Any gaps or weak assumptions in those instructions.
- The checks from the technical plan that you will execute.
- Additional checks needed to prove the feature works.
- The artifacts you expect to capture as evidence.
- Confirmation that the repo gates ran: typecheck core and cli,
  `bun test packages`, `bun test test/e2e`, and `bun run build:viewer`
  when the diff touches `packages/viewer`. If any gate did not run or
  did not pass, that is a finding, not something to fix here.

Then execute the verification plan. Prefer black-box, user-level
verification over implementation inspection alone. When applicable:

- Create a throwaway sample project under `/tmp/fabro-verify-*` when the
  feature can be exercised outside this repository (Skillmaker operates
  on any directory of skills, so this is usually possible). If the
  sandbox does not permit that, use another scratch location and
  document the fallback.
- Invoke the CLI the way a user would (`bun packages/cli/src/main.ts …`
  or the packaged bin) when CLI behavior is part of the feature.
- Run the implemented feature through its CLI, server, or viewer
  surfaces.
- Capture CLI output transcripts and JSON output snapshots.
- Use browser verification for viewer behavior; capture screenshots, and
  video when practical.

Repository write boundary:

- Do not edit implementation source, checked-in tests, prompts, workflow
  configuration, package metadata, plans, or other tracked repository
  files outside `verification-artifacts/`.
- Create verification-only helper scripts, notes, transcripts,
  screenshots, videos, and JSON snapshots under
  `verification-artifacts/`.
- If verification uncovers a product defect, missing implementation
  change, or checked-in test/harness issue, do not patch it in this
  stage. Document the required change in
  `verification-artifacts/report.md` and in your final response so the
  Verification Judge can route back to implementation.
- Before finishing, inspect tracked changes outside
  `verification-artifacts/` and report any such changes explicitly as a
  verification-stage boundary violation.

Store evidence under `verification-artifacts/`:

```text
verification-artifacts/
  verification-plan.md
  report.md
  cli/
  json/
  screenshots/
  videos/
```

Write the final verification report to
`verification-artifacts/report.md`. The report must include:

- What feature behavior was verified.
- Which repo gates ran and their results.
- What plan verification steps were executed, and what additional steps
  were executed.
- Commands run and where their full output was saved.
- Artifact paths for screenshots, videos, JSON snapshots, and CLI
  transcripts.
- Any failures, gaps, skipped checks, or residual risk.

Do not claim the feature is ready unless the evidence supports that
claim. Do not route the workflow with `verification_ready`; the
Verification Judge owns that decision.

Your final response must summarize the executed verification and list
the artifact paths you created.
