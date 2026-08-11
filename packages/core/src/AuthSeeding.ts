/**
 * THE MERGE tranche 2: auth seeding moved to `@skillmaker/runner` (it seeds
 * the runner's isolated provider config dir). Re-exported here so core's
 * internal relative imports and `@skillmaker/core`'s public API are
 * unchanged.
 */
export { type AuthSeedResult, seedProviderAuth } from "@skillmaker/runner";
