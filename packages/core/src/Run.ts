/**
 * THE MERGE tranche 2: the run record schema (`runs/<id>/run.json`,
 * data-model.md §2.8) moved to `@skillmaker/runner` — it is the runner
 * contract's output shape, written by whichever runner executed the case.
 * Re-exported here so core's internal relative imports and
 * `@skillmaker/core`'s public API are unchanged.
 */
export { RunIsolation, RunKind, RunRecord, RunStatus } from "@skillmaker/runner";
