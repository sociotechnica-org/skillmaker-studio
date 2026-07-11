/**
 * Output versions + drift (data-model.md §2.7). Version = a content hash of
 * the output tree: sha256 over the sorted `(path, file-sha256)` list under
 * `output/`. Recording one is explicit (`skillmaker version record`, or the
 * server's `POST /api/bundles/:slug/record-version`) and lands on the
 * journal as `skill.version_recorded` -- there is no version file in the
 * bundle. This module hashes files/trees (I/O) and computes drift (pure);
 * the CLI and server both call the same `computeBundleHashes` so hashing
 * logic lives in exactly one place.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { createHash } from "node:crypto";
import { basename, join, sep } from "node:path";
import { WorkspaceIOError } from "./Errors.ts";
import type { JournalEvent } from "./Journal.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** The adopt-time marker filename (`Adopt.ts`, strategy-skills-repo-mode.md §3B.8). */
export const ADOPT_MARKER_FILENAME = ".skillmaker-adopt.json";

/**
 * Top-level entries excluded when hashing an in-place-adopted bundle's
 * output tree: the studio-owned files `Adopt.ts` writes into the discovered
 * directory (mirroring the names `WorkspaceService.createBundle` scaffolds
 * for an in-workspace bundle), never the brownfield repo's own content.
 */
export const ADOPT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  "bundle.json",
  ADOPT_MARKER_FILENAME,
  "design.md",
  "research",
  "evals",
  "runs",
]);

/** sha256 of one file's bytes, as `sha256:<hex>`. */
export const hashFile = Effect.fn("Versions.hashFile")(function* (filePath: string) {
  const fs = yield* FileSystem;
  const bytes = yield* fs.readFile(filePath).pipe(Effect.mapError(toIOError(`could not read ${filePath}`)));
  return `sha256:${sha256Hex(bytes)}`;
});

/**
 * sha256 over the sorted `(relative-path, file-sha256)` list of every file
 * under `dir`, recursively, excluding `.gitkeep` (data-model.md §2.7).
 * Deterministic and independent of directory-scan order: paths are
 * normalized to forward slashes and sorted before hashing. The empty tree
 * (missing dir, or a dir with only `.gitkeep`) hashes the canonical empty
 * list `"[]"` -- a well-defined value, not a special-cased sentinel.
 */
export interface HashOutputTreeOptions {
  /**
   * Top-level entry names (matched against the first path segment under
   * `dir`) to exclude entirely — used for in-place-adopted bundles, whose
   * "output" is the discovered directory itself minus the studio-owned files
   * `Adopt.ts` added (`ADOPT_EXCLUDED_NAMES`).
   */
  readonly excludeTopLevel?: ReadonlySet<string>;
}

export const hashOutputTree = Effect.fn("Versions.hashOutputTree")(function* (
  dir: string,
  options?: HashOutputTreeOptions,
) {
  const fs = yield* FileSystem;

  const dirExists = yield* fs.exists(dir).pipe(Effect.mapError(toIOError(`could not check ${dir}`)));
  const entries = dirExists
    ? yield* fs
        .readDirectory(dir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not list ${dir}`)))
    : [];

  const pairs: Array<readonly [string, string]> = [];
  for (const entry of entries) {
    if (basename(entry) === ".gitkeep") {
      continue;
    }
    if (options?.excludeTopLevel !== undefined) {
      const [firstSegment] = entry.split(sep);
      if (firstSegment !== undefined && options.excludeTopLevel.has(firstSegment)) {
        continue;
      }
    }
    const fullPath = join(dir, entry);
    const info = yield* fs.stat(fullPath).pipe(Effect.mapError(toIOError(`could not stat ${fullPath}`)));
    if (info.type !== "File") {
      continue;
    }
    const fileHash = yield* hashFile(fullPath);
    const normalizedPath = entry.split(sep).join("/");
    pairs.push([normalizedPath, fileHash]);
  }

  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `sha256:${sha256Hex(JSON.stringify(pairs))}`;
});

/** sha256 of `design.md`'s content, as `sha256:<hex>`. Missing file hashes the empty string. */
export const hashDesign = Effect.fn("Versions.hashDesign")(function* (designPath: string) {
  const fs = yield* FileSystem;
  const exists = yield* fs.exists(designPath).pipe(Effect.mapError(toIOError(`could not check ${designPath}`)));
  const content = exists
    ? yield* fs
        .readFileString(designPath)
        .pipe(Effect.mapError(toIOError(`could not read ${designPath}`)))
    : "";
  return `sha256:${sha256Hex(content)}`;
});

export interface BundleHashes {
  readonly designHash: string;
  readonly outputHash: string;
}

/** `"output-dir"` (default): the normal `output/` subdirectory. `"in-place"`: an adopted bundle (`Adopt.ts`) whose output IS the bundle directory itself, minus `ADOPT_EXCLUDED_NAMES`. */
export type BundleLayout = "output-dir" | "in-place";

/**
 * Detects a bundle's layout by checking for the adopt marker
 * (`ADOPT_MARKER_FILENAME`) directly in `bundleDir` -- the same test
 * `IndexService.ts`'s `scanBundleIdentities` uses. Shared here so every
 * caller that needs to decide "does this bundle's skill payload live at
 * `output/` or is the bundle directory itself the payload" (`RunEngine.ts`,
 * `StationEngine.ts`, `Publish.ts`) makes that call the same way, instead of
 * each reimplementing the marker check.
 */
export const detectBundleLayout = Effect.fn("Versions.detectBundleLayout")(function* (bundleDir: string) {
  const fs = yield* FileSystem;
  const markerPath = join(bundleDir, ADOPT_MARKER_FILENAME);
  const markerExists = yield* fs.exists(markerPath).pipe(Effect.mapError(toIOError(`could not check ${markerPath}`)));
  return (markerExists ? "in-place" : "output-dir") as BundleLayout;
});

/**
 * The shared hashing entry point: given a bundle directory
 * (`skills/<slug>/`, or an adopted bundle's discovered directory), computes
 * the live `design.md` hash and output-tree hash. Called by both the CLI's
 * `version record` command and the server's `POST
 * /api/bundles/:slug/record-version` -- one function, two doors, hashing
 * stays I/O (server-side), never a client computation.
 */
export const computeBundleHashes = Effect.fn("Versions.computeBundleHashes")(function* (
  bundleDir: string,
  layout: BundleLayout = "output-dir",
) {
  const designHash = yield* hashDesign(join(bundleDir, "design.md"));
  const outputHash =
    layout === "in-place"
      ? yield* hashOutputTree(bundleDir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES })
      : yield* hashOutputTree(join(bundleDir, "output"));
  return { designHash, outputHash };
});

/**
 * Drift hint (data-model.md §2.7): compares the live `design.md`/`output/`
 * hashes against the latest recorded version. Displayed, never enforced.
 *
 * `"no-version"` is a fifth state added beyond the doc's four
 * (`in-sync`/`design-changed`/`output-hand-edited`/`both`) -- a deliberate
 * deviation, not an oversight. The doc's drift table assumes a version has
 * already been recorded; a bundle that has never had `skill.version_recorded`
 * appended has no "latest" to compare against, and collapsing that into
 * `"in-sync"` (a hollow comparison against nothing) or `"both"` (implying
 * change from a baseline that never existed) would both be dishonest. Report
 * this as a design choice, not a silent extension of the model.
 */
export type Drift = "no-version" | "in-sync" | "design-changed" | "output-hand-edited" | "both";

export const computeDrift = (
  current: BundleHashes,
  latest: { readonly designHash: string; readonly hash: string } | undefined,
): Drift => {
  if (latest === undefined) {
    return "no-version";
  }
  const designChanged = current.designHash !== latest.designHash;
  const outputChanged = current.outputHash !== latest.hash;
  if (designChanged && outputChanged) {
    return "both";
  }
  if (designChanged) {
    return "design-changed";
  }
  if (outputChanged) {
    return "output-hand-edited";
  }
  return "in-sync";
};

/** One recorded `skill.version_recorded` event, folded to a plain record. */
export interface SkillVersion {
  readonly hash: string;
  readonly designHash: string;
  readonly label?: string;
  /** The event's `at` timestamp -- when the version was recorded. */
  readonly recordedAt: string;
}

/**
 * Folds `skill.version_recorded` events into per-bundle chronological lists
 * (data-model.md §2.7, §2.11): "latest + all". Pure and total, mirroring
 * `Fold.ts`/`FoldTodos.ts`'s shape -- events are already in append order, so
 * the last element of each bundle's list is the latest.
 */
export const foldSkillVersions = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlyMap<string, ReadonlyArray<SkillVersion>> => {
  const versions = new Map<string, SkillVersion[]>();

  for (const event of events) {
    if (event.type !== "skill.version_recorded") {
      continue;
    }
    const list = versions.get(event.payload.bundle) ?? [];
    list.push({
      hash: event.payload.hash,
      designHash: event.payload.designHash,
      ...(event.payload.label !== undefined ? { label: event.payload.label } : {}),
      recordedAt: event.at,
    });
    versions.set(event.payload.bundle, list);
  }

  return versions;
};

/** The most recently recorded version for a bundle, or `undefined` if none. */
export const latestSkillVersion = (
  versions: ReadonlyArray<SkillVersion> | undefined,
): SkillVersion | undefined => (versions === undefined || versions.length === 0 ? undefined : versions.at(-1));

/** A short, human-friendly form of a `"sha256:<hex>"` hash for CLI/viewer display. */
export const shortHash = (hash: string, length = 12): string => {
  const prefix = "sha256:";
  if (!hash.startsWith(prefix)) {
    return hash.length > length ? hash.slice(0, length) : hash;
  }
  const hex = hash.slice(prefix.length);
  return `${prefix}${hex.length > length ? hex.slice(0, length) : hex}`;
};
