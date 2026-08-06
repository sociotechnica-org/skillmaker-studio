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
    readonly tags?: unknown;
  };
  if (typeof raw.slug !== "string" || raw.slug.length === 0) return null;
  return {
    slug: raw.slug,
    stage: decodeStage(raw.stage),
    oneLiner: typeof raw.oneLiner === "string" ? raw.oneLiner : "",
    // The attention dot: only an explicit awaiting-review earns one -- an
    // absent/unknown substate (older server) stays dotless, never invented.
    awaitingReview: raw.substate === "awaiting-review",
    ...(Array.isArray(raw.tags)
      ? { tags: raw.tags.filter((t): t is string => typeof t === "string") }
      : {}),
  };
};

const decodeProject = (value: unknown): Project | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as {
    readonly slug?: unknown;
    readonly name?: unknown;
    readonly path?: unknown;
    readonly skills?: unknown;
    readonly ok?: unknown;
    readonly error?: unknown;
  };
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  if (typeof raw.path !== "string") return null;
  const skills = Array.isArray(raw.skills)
    ? raw.skills.map(decodeSkill).filter((skill): skill is Skill => skill !== null)
    : [];
  return {
    // The registry's URL identifier (machine-registry rulings 2026-07-27);
    // a pre-registry payload without one falls back to the name so the
    // placeholder path keeps rendering.
    slug: typeof raw.slug === "string" && raw.slug.length > 0 ? raw.slug : raw.name,
    name: raw.name,
    path: raw.path,
    skills,
    // Absent `ok` (older payloads) reads as healthy -- never invent a broken row.
    ok: raw.ok !== false,
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
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

// -- New-project dialog wiring (machine-registry rulings 2026-07-27 #3) ------
// The server reads the disk: a browser cannot yield absolute paths from
// native dialogs, so browsing/validation/creation all go through `/api/fs/*`
// and registration through `POST /api/projects`.

export interface FsDirEntry {
  readonly name: string;
  readonly path: string;
  readonly isProject: boolean;
}

export interface FsListing {
  readonly path: string;
  readonly parent: string | null;
  readonly home: string;
  readonly isProject: boolean;
  readonly dirs: ReadonlyArray<FsDirEntry>;
}

/** `GET /api/fs/list?path=` -- one directory level (dirs only). Omit `path` to start at the server's home dir. `null` on any failure. */
export const fetchDirListing = async (path?: string): Promise<FsListing | null> => {
  try {
    const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
    const response = await fetch(`/api/fs/list${query}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const raw = (await response.json()) as Partial<FsListing>;
    if (typeof raw.path !== "string" || !Array.isArray(raw.dirs)) return null;
    return {
      path: raw.path,
      parent: typeof raw.parent === "string" ? raw.parent : null,
      home: typeof raw.home === "string" ? raw.home : "/",
      isProject: raw.isProject === true,
      dirs: raw.dirs.filter(
        (d): d is FsDirEntry =>
          typeof d === "object" && d !== null && typeof (d as FsDirEntry).name === "string" && typeof (d as FsDirEntry).path === "string",
      ),
    };
  } catch {
    return null;
  }
};

export interface PathValidation {
  readonly path: string;
  readonly valid: boolean;
  readonly reason?: string;
  readonly isProject?: boolean;
  readonly registered?: boolean;
  readonly creatable?: boolean;
}

/** `GET /api/fs/validate?path=` -- the typed-path field's live validation. `null` on any failure. */
export const validatePath = async (path: string): Promise<PathValidation | null> => {
  try {
    const response = await fetch(`/api/fs/validate?path=${encodeURIComponent(path)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as Partial<PathValidation>;
    if (typeof raw.path !== "string") return null;
    return { ...raw, path: raw.path, valid: raw.valid === true };
  } catch {
    return null;
  }
};

/** `POST /api/fs/mkdir {path}` -- the dialog's "create new folder here" action. Returns an error message, or `null` on success. */
export const createDirectory = async (path: string): Promise<string | null> => {
  try {
    const response = await fetch("/api/fs/mkdir", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ path }),
    });
    if (response.ok) return null;
    const body = (await response.json()) as { readonly error?: unknown };
    return typeof body.error === "string" ? body.error : `mkdir failed (${response.status})`;
  } catch (cause) {
    return String(cause);
  }
};

export type RegisterProjectResult =
  | { readonly kind: "registered"; readonly slug: string | null; readonly initialized: boolean }
  | { readonly kind: "needs_init" }
  | { readonly kind: "error"; readonly message: string };

/**
 * `POST /api/projects {path, create?, init?}` -- register (and optionally
 * create/scaffold) a project. `needs_init` is the dialog's confirm step:
 * the directory exists but is not a skillmaker workspace yet.
 */
export const registerProject = async (
  path: string,
  options: { readonly create?: boolean; readonly init?: boolean } = {},
): Promise<RegisterProjectResult> => {
  try {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ path, ...options }),
    });
    const body = (await response.json()) as {
      readonly status?: unknown;
      readonly initialized?: unknown;
      readonly error?: unknown;
      readonly project?: { readonly slug?: unknown } | null;
    };
    if (response.ok) {
      return {
        kind: "registered",
        slug: typeof body.project?.slug === "string" ? body.project.slug : null,
        initialized: body.initialized === true,
      };
    }
    if (body.status === "needs_init") return { kind: "needs_init" };
    return { kind: "error", message: typeof body.error === "string" ? body.error : `register failed (${response.status})` };
  } catch (cause) {
    return { kind: "error", message: String(cause) };
  }
};
