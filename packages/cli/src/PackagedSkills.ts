/**
 * Locates the product-packaged station skills (D6,
 * docs/proposals/2026-07-21-simplification.md: "William and a starter set of
 * research/drafting skills ship inside the product") relative to the CLI
 * module itself, so `station.skill` slugs like "william-draft-skill-md"
 * resolve without every workspace hand-carrying the William bundles.
 *
 * Same two-walk shape as `server/ViewerDist.ts` (see that file's doc comment
 * for WHY execPath is the right anchor inside a `bun build --compile`
 * binary, where `import.meta.url` is a virtual `/$bunfs/...` path):
 *
 * 1. Ancestor walk from this module's URL, looking for `packages/cli/skills`
 *    -- real in the monorepo checkout (the checked-in copies live there; a
 *    drift test keeps them in lockstep with the repo's own self-hosted
 *    `skills/` workspace).
 * 2. Ancestor walk from `dirname(execPath)`, looking for `packaged-skills`
 *    -- the directory `scripts/build-dist.sh` copies next to the compiled
 *    binary (and the npm platform packages / desktop sidecar ship alongside
 *    it, exactly like `viewer-dist`).
 *
 * Unlike the viewer, missing packaged skills are NOT an error here: a
 * workspace whose stations only reference its own skills never needs them,
 * and `StationEngine.runStation`'s precondition error already names the
 * missing packaged fallback when a skill resolves nowhere. So this returns
 * `undefined` instead of throwing.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The directory name shipped next to the compiled binary (build-dist.sh layout: `dist/skillmaker` + `dist/packaged-skills/`). Load-bearing, like `viewer-dist` -- don't rename without updating build-dist.sh, build-npm-packages.sh, the npm platform packages' `files` arrays, and prepare-desktop-sidecar.sh. */
export const PACKAGED_SKILLS_DIRNAME = "packaged-skills";

const walkAncestors = (startDir: string, relativeCandidates: ReadonlyArray<string>): string | undefined => {
  let dir = startDir;
  while (true) {
    for (const relative of relativeCandidates) {
      const candidate = join(dir, relative);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

/**
 * Locates the packaged-skills directory, or `undefined` if this build ships
 * none. Pass this module's (or the caller's) `import.meta.url`; `execPath`
 * defaults to the running executable.
 */
export const locatePackagedSkillsDir = (
  fromModuleUrl: string = import.meta.url,
  execPath: string = process.execPath,
): string | undefined => {
  const fromModule = walkAncestors(dirname(fileURLToPath(fromModuleUrl)), [
    join("packages", "cli", "skills"),
  ]);
  if (fromModule !== undefined) {
    return fromModule;
  }

  return walkAncestors(dirname(execPath), [PACKAGED_SKILLS_DIRNAME]);
};
