/**
 * `skillmaker publish <slug> [--target <id>]` -- publishes a Skill Bundle to
 * its configured `publishTargets` (default: all of them; data-model.md
 * §2.14, §2.2). Runs the same `@skillmaker/core` `publishBundle` the
 * server's `POST /api/bundles/:slug/publish` runs -- one contract, two
 * doors, same as `advance`/`version record`.
 */
import { JournalLayer, publishBundle, Workspace, type PublishBundleResult } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface PublishOptions {
  readonly json: boolean;
  readonly target?: string;
}

export const runPublish = Effect.fn("runPublish")(function* (
  cwd: string,
  slug: string | undefined,
  options: PublishOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker publish: missing <slug>\n\nUsage: skillmaker publish <slug> [--target <id>]\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker publish: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  if (resolved.config.publishTargets.length === 0) {
    return expectedFailure(
      "skillmaker publish: no publishTargets configured in skillmaker.config.json -- nothing to publish to\n",
    );
  }

  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome = yield* publishBundle({
    workspaceRoot: resolved.root,
    bundleDir,
    bundle: slug,
    workspaceName: resolved.config.name,
    targets: resolved.config.publishTargets,
    targetIds: options.target === undefined ? undefined : [options.target],
    actor,
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("PublishGuardError", (error) =>
      Effect.succeed({ kind: "guard" as const, reason: error.reason }),
    ),
    Effect.catchTag("PublishTargetNotFoundError", (error) =>
      Effect.succeed({ kind: "not_found" as const, target: error.target }),
    ),
    Effect.catchTag("UnknownPublishTargetKindError", (error) =>
      Effect.succeed({ kind: "unknown_kind" as const, target: error.target, targetKind: error.kind }),
    ),
  );

  if (outcome.kind === "guard") {
    if (options.json) {
      return expectedFailure(`${JSON.stringify({ status: "rejected", slug, reason: outcome.reason })}\n`);
    }
    return expectedFailure(`skillmaker publish: ${outcome.reason}\n`);
  }
  if (outcome.kind === "not_found") {
    return usageError(
      `skillmaker publish: no publish target "${outcome.target}" in skillmaker.config.json's publishTargets\n`,
    );
  }
  if (outcome.kind === "unknown_kind") {
    return expectedFailure(
      `skillmaker publish: publish target "${outcome.target}" has unrecognized kind "${outcome.targetKind}" (known kinds: git-dir, claude-marketplace, codex-marketplace)\n`,
    );
  }

  return summarize(slug, outcome.result, options.json);
});

const summarize = (slug: string, result: PublishBundleResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({ status: "published", slug, versionHash: result.versionHash, results: result.results })}\n`,
    );
  }
  const lines = result.results.map((entry) => {
    const noun = entry.status === "already_published" ? "already published" : "published";
    const urlSuffix = entry.url !== undefined ? ` -> ${entry.url}` : "";
    return `  ${entry.target} (${entry.kind}): ${noun}${urlSuffix}`;
  });
  return ok(
    `skillmaker: ${slug} publish results for version ${result.versionHash.slice(0, 19)}...\n${lines.join("\n")}\n`,
  );
};
