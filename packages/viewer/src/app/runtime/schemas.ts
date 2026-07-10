/**
 * Response schemas for the `/api/*` surface served by `packages/cli`'s
 * server (see data-model.md §2.13 for the state/substate vocabulary). Kept
 * in lockstep with `@skillmaker/core`'s `BundleRecord` and `IndexService`
 * response shapes, but the viewer does not depend on `@skillmaker/core`
 * directly -- it decodes what the wire actually sends.
 */
import { Schema } from "effect";

export const BundleStage = Schema.Literals([
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
]);
export type BundleStage = typeof BundleStage.Type;

export const BundleSubstate = Schema.Literals(["working", "awaiting-review"]);
export type BundleSubstate = typeof BundleSubstate.Type;

export class BundleRecord extends Schema.Class<BundleRecord>("BundleRecord")({
  slug: Schema.String,
  name: Schema.String,
  oneLiner: Schema.String,
  tags: Schema.Array(Schema.String),
  created: Schema.String,
  stage: BundleStage,
  substate: BundleSubstate,
  archived: Schema.Boolean,
}) {}

export class BundlesResponse extends Schema.Class<BundlesResponse>("BundlesResponse")({
  bundles: Schema.Array(BundleRecord),
}) {}

export class WorkspaceSummary extends Schema.Class<WorkspaceSummary>("WorkspaceSummary")({
  path: Schema.String,
  name: Schema.String,
}) {}

export class ConfigSummary extends Schema.Class<ConfigSummary>("ConfigSummary")({
  skillsDir: Schema.String,
  viewerPort: Schema.Number,
}) {}

export class StateResponse extends Schema.Class<StateResponse>("StateResponse")({
  workspace: WorkspaceSummary,
  config: ConfigSummary,
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  ok: Schema.Boolean,
  version: Schema.String,
}) {}
