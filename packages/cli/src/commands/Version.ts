/**
 * `skillmaker version record <slug> [--label <text>]` -- computes the live
 * `design.md`/`output/` hashes (data-model.md §2.7), appends
 * `skill.version_recorded`, and (director ruling 2026-07-25) snapshots the
 * version's content into `<bundle>/.skillmaker/versions/<bare-hash>/` via
 * the shared core path (`Versions.recordSkillVersion`). Idempotent on
 * content: recording the exact same hash+label twice is a no-op
 * (`already_appended`, exit 0, snapshot overwritten identically); recording
 * the same hash with a *different* label is an idempotency conflict,
 * reported clearly and exits 1 rather than silently overwriting the earlier
 * label.
 *
 * `skillmaker version show <slug> <hash>` -- lists a recorded version's
 * snapshot files (CLI parity D6 with `GET
 * /api/bundles/:slug/versions/:hash/files`). The hash may be bare or
 * `sha256:`-prefixed, full or a left-anchored prefix. A receipt recorded
 * before snapshots existed gets an honest error: its content was never
 * kept.
 */
import {
  computeBundleHashes,
  detectBundleLayout,
  foldSkillVersions,
  Journal,
  JournalLayer,
  listVersionSnapshotFiles,
  recordSkillVersion,
  resolveSkillVersion,
  shortHash,
  Workspace,
  bundleMarkerExists,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface VersionRecordOptions {
  readonly json: boolean;
  readonly label?: string;
}

type RecordOutcome =
  | { readonly kind: "appended"; readonly hash: string; readonly designHash: string; readonly label: string | undefined }
  | { readonly kind: "already_appended"; readonly hash: string; readonly designHash: string; readonly label: string | undefined }
  | { readonly kind: "conflict"; readonly message: string };

export const runVersionRecord = Effect.fn("runVersionRecord")(function* (
  cwd: string,
  slug: string | undefined,
  options: VersionRecordOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker version record: missing <slug>\n\nUsage: skillmaker version record <slug> [--label <text>]\n",
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker version record: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* bundleMarkerExists(bundleDir);
  if (!bundleExists) {
    return expectedFailure(`skillmaker version record: no such bundle "${slug}"\n`);
  }

  const layout = yield* detectBundleLayout(bundleDir);
  const { designHash, outputHash } = yield* computeBundleHashes(bundleDir, layout);

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome: RecordOutcome = yield* recordSkillVersion(
    slug,
    actor,
    designHash,
    outputHash,
    { bundleDir, layout },
    options.label !== undefined ? { label: options.label } : undefined,
  ).pipe(
    Effect.map((result) => ({ kind: result.status, hash: result.hash, designHash: result.designHash, label: options.label }) as const),
    Effect.provide(JournalLayer(journalPath)),
    Effect.catchTag("JournalIdempotencyConflictError", (error) =>
      Effect.succeed({ kind: "conflict" as const, message: error.message }),
    ),
  );

  if (outcome.kind === "conflict") {
    return expectedFailure(
      `skillmaker version record: a version was already recorded for this exact content ("${slug}", ${shortHash(outputHash)}) under a different label -- content is unchanged, so no new version was recorded. ${outcome.message}\n`,
    );
  }

  return summarize(slug, outcome, options.json);
});

export interface VersionShowOptions {
  readonly json: boolean;
}

export const runVersionShow = Effect.fn("runVersionShow")(function* (
  cwd: string,
  slug: string | undefined,
  hash: string | undefined,
  options: VersionShowOptions,
) {
  if (slug === undefined || hash === undefined) {
    return usageError(
      "skillmaker version show: missing arguments\n\nUsage: skillmaker version show <slug> <hash>\n",
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker version show: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  // Same bundle-location convention as `version record` above: the
  // `<skillsDir>/<slug>` bundle. (Both commands share this limitation for
  // in-place-adopted bundles, which live elsewhere -- the server endpoints
  // resolve the real directory.)
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* bundleMarkerExists(bundleDir);
  if (!bundleExists) {
    return expectedFailure(`skillmaker version show: no such bundle "${slug}"\n`);
  }

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const events = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    return yield* journal.readAll();
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  const versions = foldSkillVersions(events).get(slug) ?? [];
  const normalized = hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
  const version = resolveSkillVersion(versions, normalized);
  if (version === undefined) {
    return expectedFailure(
      `skillmaker version show: no recorded version matching "${hash}" for "${slug}"\n`,
    );
  }

  const files = yield* listVersionSnapshotFiles(bundleDir, version.hash);
  if (files === undefined) {
    return expectedFailure(
      `skillmaker version show: no snapshot for version ${shortHash(version.hash)} -- it was recorded before snapshots existed, so its content was not kept\n`,
    );
  }

  if (options.json) {
    return ok(
      `${JSON.stringify({
        slug,
        hash: version.hash,
        designHash: version.designHash,
        label: version.label ?? null,
        recordedAt: version.recordedAt,
        files,
      })}\n`,
    );
  }

  const labelSuffix = version.label !== undefined ? ` "${version.label}"` : "";
  const header = `skillmaker: version ${shortHash(version.hash)}${labelSuffix} for ${slug} (recorded ${version.recordedAt}) -- ${files.length} file${files.length === 1 ? "" : "s"}\n`;
  return ok(header + files.map((file) => `  ${file}\n`).join(""));
});

const summarize = (
  slug: string,
  outcome: Extract<RecordOutcome, { readonly kind: "appended" | "already_appended" }>,
  json: boolean,
): CliResult => {
  const label = outcome.label ?? null;
  if (json) {
    return ok(
      `${JSON.stringify({
        status: outcome.kind,
        slug,
        hash: outcome.hash,
        designHash: outcome.designHash,
        label,
      })}\n`,
    );
  }

  const noun = outcome.kind === "already_appended" ? "already recorded" : "recorded";
  const labelSuffix = outcome.label !== undefined ? ` "${outcome.label}"` : "";
  return ok(`skillmaker: ${noun} version ${shortHash(outcome.hash)}${labelSuffix} for ${slug}\n`);
};
