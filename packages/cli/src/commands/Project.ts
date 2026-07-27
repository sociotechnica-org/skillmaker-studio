/**
 * `skillmaker project add|list|remove` -- the CLI door onto the
 * machine-level project registry (director rulings 2026-07-27):
 * `~/.skillmaker-studio/config.json` (or `$SKILLMAKER_STUDIO_HOME`), a bare
 * list of project directories. `add` registers an EXISTING skillmaker
 * workspace (it never scaffolds -- `skillmaker init` in the directory
 * first); `remove` only unregisters, never touching the directory; `list`
 * shows each registered project with its URL slug and health, derived at
 * read time.
 */
import {
  addMachineProject,
  computeProjectSlugs,
  isSkillmakerProjectDir,
  MachineConfigMalformedError,
  machineHome,
  readMachineConfig,
  removeMachineProject,
} from "@skillmaker/core";
import { Effect } from "effect";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface ProjectOptions {
  readonly json: boolean;
}

const guardMalformed = (error: unknown): CliResult | undefined =>
  error instanceof MachineConfigMalformedError
    ? expectedFailure(`skillmaker project: ${error.message}\n`)
    : undefined;

export const runProjectAdd = Effect.fn("runProjectAdd")(function* (
  cwd: string,
  rawPath: string | undefined,
  options: ProjectOptions,
) {
  if (rawPath === undefined) {
    return usageError("skillmaker project add: missing <path>\n\nUsage: skillmaker project add <path>\n");
  }
  const path = resolve(cwd, rawPath);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return expectedFailure(`skillmaker project add: no such directory "${path}"\n`);
  }
  if (!isSkillmakerProjectDir(path)) {
    return expectedFailure(
      `skillmaker project add: "${path}" is not a skillmaker workspace (no skillmaker.config.json -- run \`skillmaker init\` there first)\n`,
    );
  }
  try {
    const result = addMachineProject(machineHome(), path);
    if (options.json) {
      return ok(`${JSON.stringify(result)}\n`);
    }
    return ok(
      result.status === "added"
        ? `skillmaker: registered ${result.path}\n`
        : `skillmaker: ${result.path} is already registered\n`,
    );
  } catch (error) {
    const guarded = guardMalformed(error);
    if (guarded !== undefined) return guarded;
    throw error;
  }
});

export const runProjectRemove = Effect.fn("runProjectRemove")(function* (
  cwd: string,
  rawPath: string | undefined,
  options: ProjectOptions,
) {
  if (rawPath === undefined) {
    return usageError("skillmaker project remove: missing <path>\n\nUsage: skillmaker project remove <path>\n");
  }
  // Resolve against cwd like `add` -- but NEVER require the directory to
  // still exist: unregistering a deleted/moved project is the main use.
  const path = resolve(cwd, rawPath);
  try {
    const result = removeMachineProject(machineHome(), path);
    if (options.json) {
      return ok(`${JSON.stringify(result)}\n`);
    }
    return result.status === "removed"
      ? ok(`skillmaker: unregistered ${result.path} (the directory itself is untouched)\n`)
      : expectedFailure(`skillmaker project remove: "${result.path}" is not registered\n`);
  } catch (error) {
    const guarded = guardMalformed(error);
    if (guarded !== undefined) return guarded;
    throw error;
  }
});

export const runProjectList = Effect.fn("runProjectList")(function* (
  _cwd: string,
  options: ProjectOptions,
) {
  try {
    const home = machineHome();
    const paths = readMachineConfig(home).projects.map((entry) => entry.path);
    const slugs = computeProjectSlugs(paths);
    const rows = paths.map((path) => ({
      slug: slugs.get(path) as string,
      path,
      ok: isSkillmakerProjectDir(path),
    }));
    if (options.json) {
      return ok(`${JSON.stringify({ home, projects: rows })}\n`);
    }
    if (rows.length === 0) {
      return ok("skillmaker: no projects registered (add one with `skillmaker project add <dir>`)\n");
    }
    const slugWidth = Math.max("SLUG".length, ...rows.map((row) => row.slug.length));
    const header = `${"SLUG".padEnd(slugWidth)}  STATUS   PATH`;
    const lines = rows.map(
      (row) => `${row.slug.padEnd(slugWidth)}  ${(row.ok ? "ok" : "broken").padEnd(7)}  ${row.path}`,
    );
    return ok(`${[header, ...lines].join("\n")}\n`);
  } catch (error) {
    const guarded = guardMalformed(error);
    if (guarded !== undefined) return guarded;
    throw error;
  }
});
