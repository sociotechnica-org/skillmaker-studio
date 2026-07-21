/**
 * Pure derivations for the card's review surface (friction log 2026-07-21,
 * entries #13/#15/#18): what review is actually pending, whose work it is,
 * and what the most recent review outcome was.
 *
 * - #18: a pending review is labeled by the state that REQUESTED it (the
 *   `review.requested` event's `state`), never by the bundle's current
 *   stage -- a stage advance does not change whose work is under review.
 * - #13: after approve/send-back the outcome (decision · timestamp · notes)
 *   must stay visible on the card, with the next step said out loud. The
 *   data already exists in `review.resolved`; this module reads it back.
 * - #15: approve may carry notes; the outcome rendering treats them as
 *   for-the-record commentary (core's `latestReviseNotes` only injects
 *   `revise` notes into the next station prompt -- approve notes never
 *   become agent instructions, and the next-step line must not claim so).
 *
 * Kept out of the component (same reason as `nextAction.ts`) so it can be
 * unit-tested without React. All functions take the bundle-detail `events`
 * array AS SERVED: newest first (Server.ts reverses before responding).
 */
import { STAGE_LABEL, type BundleStage, type EventView } from "./schemas.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (payload: unknown, key: string): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

const stringArrayField = (payload: unknown, key: string): ReadonlyArray<string> => {
  if (!isRecord(payload)) {
    return [];
  }
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

/** The display word for a wire state: the stage label when known, the raw wire word otherwise (never invents). */
const stageWord = (state: string): string => STAGE_LABEL[state as BundleStage] ?? state;

export interface PendingReview {
  /** The wire state that requested the review -- whose work this is. */
  readonly requestedState: string | undefined;
  /** "Review the <requesting state>-stage work" -- named for the work, never the current stage (#18). */
  readonly title: string;
  /**
   * Present only when the bundle's stage moved on after the request: says
   * plainly that the current stage has no work under review here.
   */
  readonly staleNote: string | undefined;
  readonly question: string | undefined;
  readonly artifacts: ReadonlyArray<string>;
}

/**
 * The unresolved `review.requested`, if any: scanning newest-first, the
 * first review-family event decides -- a `review.resolved` on top means the
 * latest request was already answered. Returns `undefined` when nothing is
 * pending (callers additionally gate on `substate === "awaiting-review"`;
 * when the substate says a review is pending but the capped event window
 * no longer contains the request, callers fall back to a generic label).
 */
export const pendingReview = (
  events: ReadonlyArray<EventView>,
  currentStage: BundleStage,
): PendingReview | undefined => {
  for (const event of events) {
    if (event.type === "review.resolved") {
      return undefined;
    }
    if (event.type !== "review.requested") {
      continue;
    }
    const requestedState = stringField(event.payload, "state");
    const title =
      requestedState === undefined
        ? "Review the submitted work"
        : `Review the ${stageWord(requestedState)}-stage work`;
    const staleNote =
      requestedState !== undefined && requestedState !== currentStage
        ? `This review was requested by the ${stageWord(requestedState)} station; this skill has since moved to ${stageWord(currentStage)}. No ${stageWord(currentStage)}-stage work exists to approve yet.`
        : undefined;
    return {
      requestedState,
      title,
      staleNote,
      question: stringField(event.payload, "question"),
      artifacts: stringArrayField(event.payload, "artifacts"),
    };
  }
  return undefined;
};

export interface ReviewOutcome {
  readonly decision: "approve" | "revise";
  /** "Approved" / "Sent back" -- the panel heading's verdict word. */
  readonly headline: string;
  /** The event's ISO timestamp, verbatim -- callers format for display. */
  readonly at: string;
  readonly notes: string | undefined;
  /** The next step, said out loud (#13/#17: no more silent label swaps). */
  readonly nextStep: string;
}

/**
 * The most recent `review.resolved` for the CURRENT stage's work (#13):
 * after "Send back with notes" the card shows the decision, when, the
 * submitted notes, and what happens to them next. Scoped to the current
 * stage so a stage advance retires the old outcome instead of misfiling it
 * under work it never judged.
 */
export const latestReviewOutcome = (
  events: ReadonlyArray<EventView>,
  currentStage: BundleStage,
): ReviewOutcome | undefined => {
  for (const event of events) {
    if (event.type !== "review.resolved") {
      continue;
    }
    if (stringField(event.payload, "state") !== currentStage) {
      continue;
    }
    const decision = stringField(event.payload, "decision");
    if (decision !== "approve" && decision !== "revise") {
      continue;
    }
    const notes = stringField(event.payload, "notes");
    return {
      decision,
      headline: decision === "approve" ? "Approved" : "Sent back",
      at: event.at,
      notes,
      nextStep:
        decision === "revise"
          ? "Notes were recorded and will be given to the agent on the next station run."
          : notes !== undefined
            ? "Approval recorded; the notes are kept in the journal for the record."
            : "Approval recorded — this stage can move forward.",
    };
  }
  return undefined;
};
