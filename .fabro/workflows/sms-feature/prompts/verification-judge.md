# Verification Judge

Judge whether the verification stage proved that the requested feature
works. This is a rubric stage. Do not perform implementation work unless
you need a tiny inspection command to understand evidence that already
exists.

Read:

- The goal from the workflow context.
- The checked-in plan under `docs/proposals/` named by the scope stage.
- The implementation diff and changed files.
- The verify node's final response and touched files from workflow
  context when available.
- `verification-artifacts/verification-plan.md`.
- `verification-artifacts/report.md`.
- Any CLI transcripts, JSON snapshots, screenshots, videos, or other
  artifacts under `verification-artifacts/`.

Assess the gates first:

- Did the repo gates run on the final diff: typecheck core and cli,
  `bun test packages`, `bun test test/e2e`, and `bun run build:viewer`
  when `packages/viewer` changed? A missing or failed gate is
  disqualifying regardless of other evidence.

Assess both verification plans:

- Was the technical plan's verification section sufficient for the
  feature? Did the verifier identify gaps or weak assumptions in it?
- Was the verifier's independent verification plan sufficient, and did
  the verifier execute both the plan's relevant steps and its own
  additional steps?

Assess the evidence against the scope:

- Does the diff actually match the scoped plan — nothing planned left
  unimplemented, nothing significant implemented outside the plan?
- Do CLI transcripts support the claimed behavior, including exit codes
  and important output fields?
- Do JSON snapshots show the expected machine-readable contract?
- Do screenshots or videos support viewer or browser behavior?
- Did the verifier use a realistic sample project when the feature can
  be exercised outside the repository?
- Are skipped checks justified and low risk? Are failures product
  defects, harness limitations, or acceptable residual risks?

Assess stage boundaries:

- Verification may create artifacts under `verification-artifacts/`, but
  it must not change checked-in source, tests, prompts, workflow
  configuration, package metadata, plans, or other tracked repository
  files outside `verification-artifacts/`.
- Treat any verification-stage tracked file change outside
  `verification-artifacts/` as implementation work that happened after
  validation and review. Route to `Fix implementation` for that boundary
  violation even when the change is tiny, test-only, or described as
  harness hardening. The fix must happen in implementation so validation
  and review rerun on the final diff.

Reject weak verification. Do not approve only because tests passed.

Route based on the smallest next step:

- Route to `Re-verify` when the implementation appears plausible but the
  verifier skipped important checks, failed to create an independent
  verification plan, omitted required artifacts, or made claims that the
  evidence does not support.
- Route to `Fix implementation` only when the evidence points to a
  product defect, an implementation gap, a diff/scope mismatch, a failed
  or skipped repo gate, or a verification-stage tracked-file boundary
  violation.
- Route to `Verified` only when the evidence is sufficient.

When verification is satisfactory, explain why the evidence is enough.
When it is not satisfactory, explain the smallest implementation or
verification work needed next.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Verified","context_updates":{"verification_ready":true,"verification_route":"handoff"}}
```

or:

```json
{"preferred_next_label":"Re-verify","context_updates":{"verification_ready":false,"verification_route":"verify"}}
```

or:

```json
{"preferred_next_label":"Fix implementation","context_updates":{"verification_ready":false,"verification_route":"implement"}}
```
