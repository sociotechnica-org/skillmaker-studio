/**
 * THE MERGE tranche 2: `Actor` moved to `@skillmaker/runner` (a contract
 * type — the runner stamps it on `run.json`). Re-exported here so core's
 * internal relative imports and `@skillmaker/core`'s public API are
 * unchanged.
 */
export { Actor, type ActorEncoded } from "@skillmaker/runner";
