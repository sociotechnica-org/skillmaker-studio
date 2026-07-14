/**
 * The Overview panel's single source of truth for "what's the one thing to do
 * next?" -- so the UI guides the director instead of exposing the whole state
 * machine (todo: Overview surfaces the state machine instead of guiding).
 *
 * Pure and total: derived only from the bundle's stage, substate, and the
 * two guard booleans the detail payload already carries. Kept out of the
 * component so it can be unit-tested without React.
 */
import { STAGES, type BundleStage } from "./schemas.ts";

export interface GuardBits {
  readonly approvedForForward: boolean;
  readonly gateApproved: boolean;
}

export type NextAction =
  /** Terminal: published, nothing to advance to. */
  | { readonly kind: "terminal" }
  /** evaluating -> published: the deliberate publish-gate flow (PublishSection). */
  | { readonly kind: "gate" }
  /** A review was requested and is pending: approve-&-advance, or send back. */
  | { readonly kind: "review"; readonly nextStage: BundleStage }
  /** Already approved, just not moved yet: a plain one-click advance. */
  | { readonly kind: "advance"; readonly nextStage: BundleStage }
  /** Human-authored working state: approve own work and advance in one click. */
  | { readonly kind: "approve-advance"; readonly nextStage: BundleStage };

/** The stage after `stage`, or undefined at the end of the pipeline. */
export const nextStageOf = (stage: BundleStage): BundleStage | undefined =>
  STAGES[STAGES.indexOf(stage) + 1];

/**
 * The single recommended next step. Note the intentional collapse of the
 * review pair for human-authored work: from a `working` state that isn't yet
 * approved, the guided action is a one-click "approve & advance" that fires
 * the whole pair under the hood -- request, then approve, then the stage move
 * (`review.resolved` is only accepted while awaiting-review, so the request
 * must lead) -- so the solo self-approval theater becomes one click while the
 * journal still records the full pair. The explicit review UI (approve /
 * send-back) only appears once a review is actually pending -- i.e. after an
 * agent station requested one.
 */
export const nextAction = (stage: BundleStage, substate: string, guard: GuardBits): NextAction => {
  if (stage === "published") {
    return { kind: "terminal" };
  }
  if (stage === "evaluating") {
    return { kind: "gate" };
  }
  const next = nextStageOf(stage);
  if (next === undefined) {
    return { kind: "terminal" };
  }
  if (substate === "awaiting-review") {
    return { kind: "review", nextStage: next };
  }
  if (guard.approvedForForward) {
    return { kind: "advance", nextStage: next };
  }
  return { kind: "approve-advance", nextStage: next };
};
