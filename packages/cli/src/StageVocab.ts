/**
 * The CLI's human-facing pipeline vocabulary: the parallel-verb labels shown
 * in `status`/`list`, and an alias-aware resolver so `advance --to research`
 * works the same as the board's "Research" column.
 *
 * Display and argument layer ONLY -- the wire/state names (`idea`,
 * `researching`, …) and the journal format are untouched. `--json` output and
 * every recorded `bundle.stage_changed` still carry the canonical literals, so
 * existing journals and machine consumers are unaffected. Mirrors the viewer's
 * own `STAGE_LABEL` (runtime/schemas.ts), the same way `STAGES` is mirrored.
 */
import { STAGES, type BundleStage } from "@skillmaker/core";

export const STAGE_LABEL: Record<BundleStage, string> = {
  idea: "Frame",
  researching: "Research",
  drafting: "Draft",
  evaluating: "Evaluate",
  published: "Publish",
};

/** Verb alias -> canonical stage literal. The literal itself is always accepted too (see `resolveStage`). */
const ALIAS_TO_STAGE: Record<string, BundleStage> = {
  frame: "idea",
  research: "researching",
  draft: "drafting",
  evaluate: "evaluating",
  publish: "published",
};

/** Resolve a user-supplied stage to its canonical literal, accepting either the literal (`researching`) or its verb alias (`research`). `undefined` when neither. */
export const resolveStage = (input: string): BundleStage | undefined =>
  (STAGES as ReadonlyArray<string>).includes(input) ? (input as BundleStage) : ALIAS_TO_STAGE[input];
