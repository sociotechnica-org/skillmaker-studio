/**
 * The production state machine (data-model.md §2.13): pure guard logic over
 * a journal replay. This module never appends to the journal and never
 * touches I/O -- callers (the CLI's `advance`/`review request` commands and
 * the server's `POST /api/events`) decide the transition, call
 * `checkTransition` against the current event log, and only append
 * `bundle.stage_changed` when the verdict says `allowed: true`. One
 * contract, two doors.
 *
 * Guard table (data-model.md §2.13):
 *   - forward one state:        `review.resolved: approve` for the current
 *                                state's work, recorded after the last
 *                                `bundle.stage_changed` for the bundle.
 *   - evaluating -> published:  additionally `bundle.gate_decided: approved`
 *                                (the publish gate), recorded after the last
 *                                `bundle.stage_changed`.
 *   - backward (any -> earlier): always legal, but must be journaled with a
 *                                non-empty reason -- regression is a modeled
 *                                fact, not an embarrassment.
 *   - `override: true`:          always allowed (journaled as a manual
 *                                override) -- the escape hatch for
 *                                station-less bundles (imported skills,
 *                                quick captures).
 *   - stale `from`:              rejected -- `from` must equal the bundle's
 *                                current folded stage.
 */
import type { BundleStage } from "./Bundle.ts";
import { foldBundleStates } from "./Fold.ts";
import type { JournalEvent } from "./Journal.ts";

/** The stage ladder in order (ruling F, data-model.md §1.2 / §2.13). */
export const STAGES: ReadonlyArray<BundleStage> = [
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
];

export type TransitionVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export interface CheckTransitionInput {
  readonly bundle: string;
  readonly from: BundleStage;
  readonly to: BundleStage;
  readonly reason?: string;
  readonly override?: boolean;
}

export interface GuardStatus {
  /** The bundle's current folded stage. */
  readonly stage: BundleStage;
  /**
   * Whether a forward move one stage past `stage` is currently guard-legal:
   * an approved review of `stage`'s work, recorded after the last
   * `bundle.stage_changed` for the bundle.
   */
  readonly approvedForForward: boolean;
  /**
   * Whether the publish gate has been approved since the last stage change
   * -- only meaningful when `stage` is `"evaluating"`, but computed
   * unconditionally so the UI can show it as a fact regardless of stage.
   */
  readonly gateApproved: boolean;
}

const stageIndex = (stage: BundleStage): number => STAGES.indexOf(stage);

const currentStageOf = (events: ReadonlyArray<JournalEvent>, bundle: string): BundleStage =>
  foldBundleStates(events).get(bundle)?.stage ?? "idea";

/**
 * Index (in event order, not wall-clock time -- the journal is append-only
 * so array order already is chronological order) of the last
 * `bundle.stage_changed` for `bundle`, or -1 if there has never been one.
 */
const lastStageChangedIndex = (events: ReadonlyArray<JournalEvent>, bundle: string): number => {
  let index = -1;
  events.forEach((event, i) => {
    if (event.type === "bundle.stage_changed" && event.payload.bundle === bundle) {
      index = i;
    }
  });
  return index;
};

/** An approved review of `state`'s work, recorded strictly after `afterIndex`. */
const hasApprovedReviewAfter = (
  events: ReadonlyArray<JournalEvent>,
  bundle: string,
  state: BundleStage,
  afterIndex: number,
): boolean =>
  events.some(
    (event, i) =>
      i > afterIndex &&
      event.type === "review.resolved" &&
      event.payload.bundle === bundle &&
      event.payload.state === state &&
      event.payload.decision === "approve",
  );

/** An approved publish-gate decision, recorded strictly after `afterIndex`. */
const hasApprovedGateAfter = (
  events: ReadonlyArray<JournalEvent>,
  bundle: string,
  afterIndex: number,
): boolean =>
  events.some(
    (event, i) =>
      i > afterIndex &&
      event.type === "bundle.gate_decided" &&
      event.payload.bundle === bundle &&
      event.payload.gate === "publish" &&
      event.payload.decision === "approved",
  );

/**
 * Checks whether `input` is a guard-legal `bundle.stage_changed` transition
 * against the current state of `events` (data-model.md §2.13). Pure and
 * total: never throws, never mutates, never appends.
 */
export const checkTransition = (
  events: ReadonlyArray<JournalEvent>,
  input: CheckTransitionInput,
): TransitionVerdict => {
  if (input.override === true) {
    return { allowed: true };
  }

  const currentStage = currentStageOf(events, input.bundle);
  if (input.from !== currentStage) {
    return {
      allowed: false,
      reason: `stale "from": bundle "${input.bundle}" is currently at "${currentStage}", not "${input.from}"`,
    };
  }

  const fromIndex = stageIndex(input.from);
  const toIndex = stageIndex(input.to);

  if (toIndex === fromIndex) {
    return { allowed: false, reason: `"to" ("${input.to}") equals "from" -- not a transition` };
  }

  if (toIndex < fromIndex) {
    // Backward: always legal, but requires a non-empty reason.
    if (input.reason === undefined || input.reason.trim().length === 0) {
      return {
        allowed: false,
        reason: `backward transitions (from "${input.from}" to "${input.to}") require a non-empty reason`,
      };
    }
    return { allowed: true };
  }

  // Forward: only one stage at a time.
  if (toIndex - fromIndex !== 1) {
    return {
      allowed: false,
      reason: `forward transitions must move one stage at a time (from "${input.from}", the next stage is "${STAGES[fromIndex + 1]}", not "${input.to}")`,
    };
  }

  const lastChangeIndex = lastStageChangedIndex(events, input.bundle);
  const approved = hasApprovedReviewAfter(events, input.bundle, input.from, lastChangeIndex);
  if (!approved) {
    return {
      allowed: false,
      reason: `forward transition from "${input.from}" requires an approved review ("review.resolved" with decision "approve" for state "${input.from}") recorded since the last stage change`,
    };
  }

  if (input.from === "evaluating" && input.to === "published") {
    const gateApproved = hasApprovedGateAfter(events, input.bundle, lastChangeIndex);
    if (!gateApproved) {
      return {
        allowed: false,
        reason: `publishing requires an approved publish gate decision ("bundle.gate_decided" with gate "publish", decision "approved") recorded since the last stage change`,
      };
    }
  }

  return { allowed: true };
};

/**
 * UI hints for the bundle-detail/review panel: whether a forward move is
 * currently guard-legal, and whether the publish gate has been approved.
 * Does not itself decide what "the next stage" is -- callers combine this
 * with `STAGES` to compute a concrete `to`.
 */
export const guardStatus = (events: ReadonlyArray<JournalEvent>, bundle: string): GuardStatus => {
  const stage = currentStageOf(events, bundle);
  const lastChangeIndex = lastStageChangedIndex(events, bundle);
  return {
    stage,
    approvedForForward: hasApprovedReviewAfter(events, bundle, stage, lastChangeIndex),
    gateApproved: hasApprovedGateAfter(events, bundle, lastChangeIndex),
  };
};
