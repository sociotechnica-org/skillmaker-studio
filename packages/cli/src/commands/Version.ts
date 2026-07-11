/**
 * `skillmaker version record <slug> [--label <text>]` -- computes the live
 * `design.md`/`output/` hashes (data-model.md §2.7) and appends
 * `skill.version_recorded`. Idempotent on content: recording the exact same
 * hash+label twice is a no-op (`already_appended`, exit 0); recording the
 * same hash with a *different* label is an idempotency conflict, reported
 * clearly and exits 1 rather than silently overwriting the earlier label.
 */
import {
  computeBundleHashes,
  Journal,
  JournalLayer,
  shortHash,
  Workspace,
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

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker version record: no such bundle "${slug}"\n`);
  }

  const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome: RecordOutcome = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    const result = yield* journal.append({
      type: "skill.version_recorded",
      actor,
      // Keyed on BOTH hashes, not just outputHash: "same content" means the
      // whole recorded version (design.md AND output/), so a design-only
      // change (output/ untouched) must NOT collide with the idempotency key
      // of the prior version -- it's new content and should append.
      idempotencyKey: `skill.version_recorded:${slug}:${designHash}:${outputHash}`,
      payload: {
        bundle: slug,
        hash: outputHash,
        designHash,
        ...(options.label !== undefined ? { label: options.label } : {}),
      },
    });
    return { kind: result.status, hash: outputHash, designHash, label: options.label } as const;
  }).pipe(
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
