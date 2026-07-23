/**
 * The sidebar's Projects data source: `GET /api/projects` (an ARRAY of
 * projects -- one element today, the workspace itself; the machine-level
 * registry lands later without a client change), decoded defensively.
 * Any failure -- server absent (astro dev without the API), non-JSON,
 * unexpected shape -- resolves to `null` and the caller keeps rendering
 * `data.ts`'s placeholder PROJECTS.
 */
import { STAGES, type Project, type Skill, type Stage } from "./types.ts";

/** Server stage vocabulary (core's `BundleStage`) -> display stage labels. */
const STAGE_LABEL: Readonly<Record<string, Stage>> = {
  idea: "Idea",
  researching: "Research",
  drafting: "Drafting",
  evaluating: "Evals",
  published: "Published",
};

const isDisplayStage = (value: unknown): value is Stage =>
  typeof value === "string" && (STAGES as ReadonlyArray<string>).includes(value);

/**
 * A stage from the wire, tolerantly: the server's own vocabulary maps to
 * its display label; an already-display-shaped value passes through; any
 * future/unknown vocabulary lands on "Idea" (the ladder's floor) rather
 * than dropping the skill or blanking the sidebar.
 */
const decodeStage = (value: unknown): Stage => {
  if (typeof value === "string" && value in STAGE_LABEL) return STAGE_LABEL[value] as Stage;
  if (isDisplayStage(value)) return value;
  return "Idea";
};

const decodeSkill = (value: unknown): Skill | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as {
    readonly slug?: unknown;
    readonly stage?: unknown;
    readonly substate?: unknown;
    readonly oneLiner?: unknown;
  };
  if (typeof raw.slug !== "string" || raw.slug.length === 0) return null;
  return {
    slug: raw.slug,
    stage: decodeStage(raw.stage),
    oneLiner: typeof raw.oneLiner === "string" ? raw.oneLiner : "",
    // The attention dot: only an explicit awaiting-review earns one -- an
    // absent/unknown substate (older server) stays dotless, never invented.
    awaitingReview: raw.substate === "awaiting-review",
  };
};

const decodeProject = (value: unknown): Project | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { readonly name?: unknown; readonly path?: unknown; readonly skills?: unknown };
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  if (typeof raw.path !== "string") return null;
  const skills = Array.isArray(raw.skills)
    ? raw.skills.map(decodeSkill).filter((skill): skill is Skill => skill !== null)
    : [];
  return { name: raw.name, path: raw.path, skills };
};

/**
 * `{projects: [...]}` -> `Project[]`, or `null` when the payload isn't
 * that shape at all (the caller's signal to keep the placeholder).
 */
export const decodeProjectsResponse = (json: unknown): ReadonlyArray<Project> | null => {
  if (typeof json !== "object" || json === null) return null;
  const raw = (json as { readonly projects?: unknown }).projects;
  if (!Array.isArray(raw)) return null;
  return raw.map(decodeProject).filter((project): project is Project => project !== null);
};

/** Live projects, or `null` on any failure (server absent, bad payload). */
export const fetchProjects = async (): Promise<ReadonlyArray<Project> | null> => {
  try {
    const response = await fetch("/api/projects", { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return decodeProjectsResponse(await response.json());
  } catch {
    return null;
  }
};
