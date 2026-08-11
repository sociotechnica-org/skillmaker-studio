/**
 * @skillmaker/runner — the bundled execution adapter behind the runner
 * contract (docs/proposals/2026-08-11-architecture-review-runner.md §2).
 *
 * A runner is a standalone executable: `sms-runner` (bin.ts) reads the
 * SMS_* env-var contract, materializes a case into a sandbox, drives one
 * ACP session, and fills a run dir (run.json / transcript.jsonl /
 * response.md / artifacts/), exiting 0 completed · 1 task-failed · 2 usage ·
 * 3 infra-error. `runCase` is the same implementation as a library API —
 * lifecycle core's dispatch wrapper calls it, wrapping journal events and
 * run-id allocation AROUND it; the runner never knows the journal exists.
 *
 * This package depends on `effect` only — no lifecycle-core imports
 * (workspace/journal/index). Contract types (`RunRecord`, `Actor`) and the
 * ACP client live here; core re-exports them.
 */
export * from "./Actor.ts";
export * from "./Run.ts";
export * from "./AcpClient.ts";
export * from "./ProviderProfile.ts";
export * from "./AuthSeeding.ts";
export * from "./RunResponse.ts";
export * from "./SkillActivation.ts";
export * from "./Runner.ts";
