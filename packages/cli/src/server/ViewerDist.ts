/**
 * Locates the built viewer (`astro build`'s `dist/`) relative to the CLI
 * module itself, so `skillmaker start` works whether the CLI is run from
 * the monorepo checkout (`packages/viewer/dist`) or installed standalone
 * with the viewer vendored alongside it (`viewer/dist`).
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
        "Run `bun run build:viewer` (from the repo root) to build it.",
      ].join("\n"),
    );
    this.name = "ViewerDistNotFoundError";
    this.checked = checked;
  }
}

/**
 * Walks ancestor directories of `fromModuleUrl` (pass the CLI module's own
 * `import.meta.url`), checking each for `packages/viewer/dist` or
 * `viewer/dist`. Throws `ViewerDistNotFoundError` listing every path
 * checked if none is found.
 */
export const locateViewerDist = (fromModuleUrl: string): string => {
  const checked: string[] = [];
  let dir = dirname(fileURLToPath(fromModuleUrl));

  while (true) {
    for (const candidate of [join(dir, "packages", "viewer", "dist"), join(dir, "viewer", "dist")]) {
      checked.push(candidate);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new ViewerDistNotFoundError(checked);
};
