/**
 * Locates the built viewer (`astro build`'s `dist/`) relative to the CLI
 * module itself, so `skillmaker start` works whether the CLI is run from
 * the monorepo checkout (`packages/viewer/dist`), installed standalone
 * with the viewer vendored alongside it (`viewer/dist`), or run as a
 * `bun build --compile` binary with `viewer-dist/` copied next to it
 * (Phase 12a `scripts/build-dist.sh` layout: `dist/skillmaker` +
 * `dist/viewer-dist/`).
 *
 * Inside a compiled binary, `import.meta.url` resolves to a virtual
 * `/$bunfs/...` path with no relationship to the real filesystem, so the
 * ancestor walk from the CLI module can never find a real `viewer-dist`
 * directory there. `process.execPath`, by contrast, is always the real
 * on-disk path to the running executable (the `bun` binary in dev, the
 * compiled `skillmaker` binary once compiled) -- it is the correct anchor
 * for binary-relative discovery. This is layered on top of, not instead of,
 * the module-relative walk: the module-relative walk runs first, so
 * repo-checkout and standalone-with-vendored-viewer behavior is unchanged;
 * the execPath-relative walk only matters when the module-relative walk
 * can't find anything real to walk from (i.e. inside a compiled binary).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export class ViewerDistNotFoundError extends Error {
  readonly _tag = "ViewerDistNotFoundError";
  readonly checked: ReadonlyArray<string>;

  constructor(checked: ReadonlyArray<string>) {
    super(
      [
        "viewer dist/ not found. Checked:",
        ...checked.map((path) => `  - ${path}`),
        "",
        "Run `bun run build:viewer` (from the repo root) to build it, or " +
          "`bun run build:dist` to build the compiled binary + viewer-dist/.",
      ].join("\n"),
    );
    this.name = "ViewerDistNotFoundError";
    this.checked = checked;
  }
}

/**
 * Walks ancestor directories of `startDir`, checking each for the given
 * relative candidate paths. Pushes every checked path onto `checked` (for
 * the eventual not-found error) and returns the first one that exists.
 */
const walkAncestors = (
  startDir: string,
  relativeCandidates: ReadonlyArray<string>,
  checked: string[],
): string | undefined => {
  let dir = startDir;
  while (true) {
    for (const relative of relativeCandidates) {
      const candidate = join(dir, relative);
      checked.push(candidate);
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
 * Locates the viewer's built `dist/` directory. Tries, in order:
 *
 * 1. Ancestor walk from `fromModuleUrl` (pass the CLI module's own
 *    `import.meta.url`), checking each ancestor for `packages/viewer/dist`
 *    or `viewer/dist`. This is real inside the monorepo checkout and a
 *    standalone (non-compiled) install with the viewer vendored alongside
 *    the CLI source; it is a no-op walk over virtual `/$bunfs/...`
 *    segments inside a compiled binary (never matches, but is cheap).
 * 2. Ancestor walk from `dirname(execPath)` (pass `process.execPath`),
 *    checking each ancestor for `viewer-dist`. `execPath` is always a real
 *    on-disk path -- the `bun` binary in dev, the compiled `skillmaker`
 *    binary once compiled -- so this is what actually resolves the
 *    `dist/skillmaker` + `dist/viewer-dist/` layout produced by
 *    `scripts/build-dist.sh`, wherever the two are copied together on
 *    install.
 *
 * Throws `ViewerDistNotFoundError` listing every path checked across both
 * walks if neither finds anything.
 */
export const locateViewerDist = (
  fromModuleUrl: string,
  execPath: string = process.execPath,
): string => {
  const checked: string[] = [];

  const fromModule = walkAncestors(
    dirname(fileURLToPath(fromModuleUrl)),
    [join("packages", "viewer", "dist"), join("viewer", "dist")],
    checked,
  );
  if (fromModule !== undefined) {
    return fromModule;
  }

  const fromExecPath = walkAncestors(
    dirname(execPath),
    ["viewer-dist"],
    checked,
  );
  if (fromExecPath !== undefined) {
    return fromExecPath;
  }

  throw new ViewerDistNotFoundError(checked);
};
