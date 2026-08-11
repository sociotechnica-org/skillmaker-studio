/**
 * THE MERGE tranche 2: skill-activation detection moved to
 * `@skillmaker/runner` (the runner computes `skillInvoked` on every run's
 * transcript). Re-exported here so core's internal relative imports and
 * `@skillmaker/core`'s public API are unchanged.
 */
export { didSkillActivate } from "@skillmaker/runner";
