/** Domain types for the next shell (IA doc §A/§B/§C, ruled 2026-07-22). */

export const STAGES = ["Idea", "Research", "Drafting", "Evals", "Published"] as const;
export type Stage = (typeof STAGES)[number];

export type Skill = {
  readonly slug: string;
  readonly stage: Stage;
  readonly oneLiner: string;
  /** True when the bundle sits in the awaiting-review substate -- the sidebar's attention dot. Absent on placeholder data and pre-substate servers. */
  readonly awaitingReview?: boolean;
};

/** A project is a directory that contains skills (IA §A). */
export type Project = {
  readonly name: string;
  readonly path: string;
  readonly skills: ReadonlyArray<Skill>;
};

export type TaskState = "open" | "in-progress";

export type Task = {
  readonly title: string;
  /** Provenance: run · skill, gap · skill, or human. */
  readonly origin: string;
  readonly state: TaskState;
};

export type ClaimStatus = "proven" | "partial" | "unmeasured" | "gap";

/** A row of the claim-first evals tree (IA §C). */
export type Claim = {
  readonly id: string;
  readonly family: string;
  readonly sentence: string;
  readonly status: ClaimStatus;
  readonly fixtures: number;
  /** The fixture cases probing this claim (`case.json.risks` is the join, IA §C rule 2). */
  readonly fixtureCases: ReadonlyArray<string>;
};

export type RunVerdict = "pass" | "fail" | "partial";

/** One eval run row for the tree (wire: BundleDetailResponse.runs). `model` is already blurb-stripped for display (#141). */
export type EvalRun = {
  readonly id: string;
  readonly fixtureCase: string | null;
  readonly versionHash: string;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly status: string;
  readonly verdict: RunVerdict | null;
};

/** One measurement cell for the model-chip column (wire: BundleDetailResponse.measurements). `model` is blurb-stripped for display. */
export type EvalMeasurement = {
  readonly fixtureCase: string;
  readonly versionHash: string;
  readonly model: string;
  readonly n: number;
  readonly passes: number;
};

/**
 * The Evals tree's live data beyond the claim rows themselves -- all from
 * the one bundle-detail fetch. `null` when the shell runs on placeholders
 * (no server), in which case the tree renders claims-only, inert.
 */
export type EvalsData = {
  readonly slug: string;
  readonly latestVersionHash: string | null;
  readonly runs: ReadonlyArray<EvalRun>;
  readonly measurements: ReadonlyArray<EvalMeasurement>;
  /** Fixtures whose `risks` name no known claim -- evidence without a claim (IA §C rule 2). */
  readonly unclaimed: ReadonlyArray<string>;
};

/** Wire-vocabulary stage names (core's `BundleStage`), needed by the loop surfaces' payloads. */
export type WireStage = "idea" | "researching" | "drafting" | "evaluating" | "published";

/** The pending review, as the review card renders it (#130: named for the REQUESTING station's state, never the current stage). */
export type PendingReviewView = {
  /** The wire state that requested the review -- whose work this is. Undefined when the capped event window lost the request. */
  readonly requestedState: WireStage | undefined;
  readonly question: string | undefined;
  /** Produced-file paths named by the request, rendered as a plain list. */
  readonly artifacts: ReadonlyArray<string>;
};

/** The latest review outcome for the current stage's work -- stays visible after acting (#130). */
export type ReviewOutcomeView = {
  readonly decision: "approve" | "revise";
  /** ISO timestamp, verbatim from the journal -- formatted at render time. */
  readonly at: string;
  readonly notes: string | undefined;
};

/**
 * The Skill page's production-loop facts: wire stage/substate, the guard
 * bits, and the derived review views. `null` on placeholder data (plain
 * astro dev) -- the review card and advance controls are then hidden.
 */
export type SkillLoop = {
  readonly slug: string;
  readonly stage: WireStage;
  readonly substate: "working" | "awaiting-review";
  readonly approvedForForward: boolean;
  readonly gateApproved: boolean;
  readonly pending: PendingReviewView | undefined;
  readonly outcome: ReviewOutcomeView | undefined;
};

/** Everything the Skill page renders (wire: GET /api/bundles/:slug + instructions file). */
export type SkillPage = {
  /** Production-loop facts (review card + advance controls); `null` on placeholders. */
  readonly loop: SkillLoop | null;
  readonly instructions: string | null;
  readonly stage: Stage;
  readonly versionShort: string | null;
  readonly drift: string;
  readonly provenOn: string;
  readonly coverage: string;
  readonly claims: ReadonlyArray<Claim>;
  /** Live tree data (runs/measurements/versions); `null` on placeholders. */
  readonly evals: EvalsData | null;
  readonly events: ReadonlyArray<{ readonly type: string; readonly at: string }>;
};

/** What the center column is showing. */
export type CenterView =
  | { readonly kind: "board" }
  | { readonly kind: "tasks" }
  | { readonly kind: "skill"; readonly project: string; readonly slug: string }
  /** The chat-first new-skill launcher, centered in the center column (ruled 2026-07-23). */
  | { readonly kind: "new-skill"; readonly project: string };

/** One entry of a bundle's file tree (GET /api/bundles/:slug/files). */
export type BundleFile = {
  readonly path: string;
  readonly size: number;
};
