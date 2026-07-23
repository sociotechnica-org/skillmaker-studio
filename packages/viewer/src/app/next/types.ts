/** Domain types for the next shell (IA doc §A/§B/§C, ruled 2026-07-22). */

export const STAGES = ["Idea", "Research", "Drafting", "Evals", "Published"] as const;
export type Stage = (typeof STAGES)[number];

export type Skill = {
  readonly slug: string;
  readonly stage: Stage;
  readonly oneLiner: string;
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

/** Everything the Skill page renders (wire: GET /api/bundles/:slug + instructions file). */
export type SkillPage = {
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
  | { readonly kind: "skill"; readonly project: string; readonly slug: string };

/** One entry of a bundle's file tree (GET /api/bundles/:slug/files). */
export type BundleFile = {
  readonly path: string;
  readonly size: number;
};
