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
  readonly family: "Input" | "Reasoning" | "Output" | "Adversarial" | "Chain";
  readonly sentence: string;
  readonly status: ClaimStatus;
  readonly fixtures: number;
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
