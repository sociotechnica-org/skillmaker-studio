/**
 * The machine-level project registry (director rulings 2026-07-27, building
 * the IA doc's §A "machine-level project registry"). ONE file:
 * `~/.skillmaker-studio/config.json`, shape `{ "projects": [{"path": ...}] }`.
 *
 * Invariants (the IA doc's, kept on purpose):
 * - The registry is ONLY a list of directories. A project's name, skills,
 *   journal, bundles all stay IN the project directory -- the registry never
 *   duplicates them (a name is derived from the project's own config or its
 *   basename at read time).
 * - `~/.skillmaker-studio` may later hold more machine state (app/window
 *   state, system skills); nothing else lives there today.
 * - `SKILLMAKER_STUDIO_HOME` overrides the home directory so tests (and
 *   parallel servers) never touch the real `~/.skillmaker-studio`.
 *
 * Deliberately synchronous `node:fs` (the same style the server module uses
 * for its own per-request reads): the registry is one tiny JSON file, and the
 * writers (CLI `project add/remove`, the server's registry endpoints) are
 * single-shot operations. Writes are atomic: temp file + rename in the same
 * directory.
 */
import { Schema } from "effect";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { slugify } from "./Adopt.ts";
import { DEFAULT_CONFIG_FILENAME } from "./Workspace.ts";

export const MACHINE_HOME_ENV_VAR = "SKILLMAKER_STUDIO_HOME";
export const MACHINE_CONFIG_FILENAME = "config.json";

/** One registered project: a directory on this machine. Nothing else -- names and skills are derived from the directory itself at read time. */
export class MachineProjectEntry extends Schema.Class<MachineProjectEntry>("MachineProjectEntry")({
  path: Schema.String,
}) {}

export class MachineConfig extends Schema.Class<MachineConfig>("MachineConfig")({
  projects: Schema.Array(MachineProjectEntry),
}) {}

export const emptyMachineConfig = (): MachineConfig => MachineConfig.make({ projects: [] });

/** The machine home: `$SKILLMAKER_STUDIO_HOME` when set (tests, parallel instances), else `~/.skillmaker-studio`. */
export const machineHome = (env: Readonly<Record<string, string | undefined>> = process.env): string => {
  const override = env[MACHINE_HOME_ENV_VAR];
  return override !== undefined && override.length > 0 ? override : join(homedir(), ".skillmaker-studio");
};

export const machineConfigPath = (home: string): string => join(home, MACHINE_CONFIG_FILENAME);

export class MachineConfigMalformedError extends Error {
  override readonly name = "MachineConfigMalformedError";
  constructor(readonly path: string, detail: string) {
    super(`machine config at ${path} is malformed: ${detail}`);
  }
}

/**
 * Reads the registry. A missing file is an empty registry (first run); a
 * malformed one is a loud typed error -- silently treating a corrupt registry
 * as empty could "lose" every registered project on the next write.
 */
export const readMachineConfig = (home: string): MachineConfig => {
  const path = machineConfigPath(home);
  if (!existsSync(path)) {
    return emptyMachineConfig();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new MachineConfigMalformedError(path, `not valid JSON (${String(cause)})`);
  }
  try {
    return Schema.decodeUnknownSync(MachineConfig)(parsed);
  } catch (cause) {
    throw new MachineConfigMalformedError(path, String(cause));
  }
};

/** Atomic write: temp file in the same directory, then rename over the target. */
export const writeMachineConfig = (home: string, config: MachineConfig): void => {
  mkdirSync(home, { recursive: true });
  const path = machineConfigPath(home);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify({ projects: config.projects.map((p) => ({ path: p.path })) }, null, 2)}\n`);
  try {
    renameSync(tmp, path);
  } catch (cause) {
    rmSync(tmp, { force: true });
    throw cause;
  }
};

export type AddProjectResult =
  | { readonly status: "added"; readonly path: string }
  | { readonly status: "already_registered"; readonly path: string };

/** Registers a directory. Paths are stored resolved-absolute; re-adding is a no-op, honestly reported. */
export const addMachineProject = (home: string, rawPath: string): AddProjectResult => {
  const path = resolve(rawPath);
  const config = readMachineConfig(home);
  if (config.projects.some((entry) => entry.path === path)) {
    return { status: "already_registered", path };
  }
  writeMachineConfig(
    home,
    MachineConfig.make({ projects: [...config.projects, MachineProjectEntry.make({ path })] }),
  );
  return { status: "added", path };
};

export type RemoveProjectResult =
  | { readonly status: "removed"; readonly path: string }
  | { readonly status: "not_registered"; readonly path: string };

/** Unregisters a directory. NEVER touches the directory itself -- remove is forgetting, not deleting. */
export const removeMachineProject = (home: string, rawPath: string): RemoveProjectResult => {
  const path = resolve(rawPath);
  const config = readMachineConfig(home);
  if (!config.projects.some((entry) => entry.path === path)) {
    return { status: "not_registered", path };
  }
  writeMachineConfig(
    home,
    MachineConfig.make({ projects: config.projects.filter((entry) => entry.path !== path) }),
  );
  return { status: "removed", path };
};

/** Whether a directory looks like a skillmaker workspace: it carries a `skillmaker.config.json`. */
export const isSkillmakerProjectDir = (dir: string): boolean =>
  isAbsolute(dir) && existsSync(join(dir, DEFAULT_CONFIG_FILENAME));

/**
 * URL slugs for the registered projects, deterministic and ORDER-INDEPENDENT:
 * each path's base slug is its slugified basename; when two registered paths
 * would share a base slug, EVERY collider gets `-<first 8 hex of
 * sha256(absolute path)>` appended. Order-independence matters: appending
 * `-2` by registration order would let adding a project silently rename
 * another project's URLs. The hash is stable per absolute path, so a
 * project's slug never changes unless a same-named sibling appears.
 */
export const computeProjectSlugs = (paths: ReadonlyArray<string>): ReadonlyMap<string, string> => {
  const baseCounts = new Map<string, number>();
  const bases = new Map<string, string>();
  for (const path of paths) {
    const base = slugify(basename(path));
    bases.set(path, base);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const slugs = new Map<string, string>();
  for (const path of paths) {
    const base = bases.get(path) as string;
    if ((baseCounts.get(base) ?? 0) > 1) {
      const hash = createHash("sha256").update(path).digest("hex").slice(0, 8);
      slugs.set(path, `${base}-${hash}`);
    } else {
      slugs.set(path, base);
    }
  }
  return slugs;
};
