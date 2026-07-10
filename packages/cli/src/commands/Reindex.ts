/**
 * `skillmaker reindex` — rebuild `.skillmaker/studio.db` from files + the
 * journal and report what changed. The index is a rebuildable cache
 * (data-model.md §1.3), so this command is always safe to re-run and never
 * hard-fails on malformed input (Part 3 ruling I) — it surfaces warnings.
 */
import { IndexService, IndexServiceLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface ReindexOptions {
  readonly json: boolean;
}

export const runReindex = Effect.fn("runReindex")(function* (
  cwd: string,
  options: ReindexOptions,
) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker reindex: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      return yield* index.rebuild();
    }).pipe(Effect.provide(IndexServiceLayer(resolved.root))),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker reindex: ${outcome.failure.message}\n`);
  }

  return summarize(outcome.success, options.json);
});

const summarize = (
  result: { readonly bundles: number; readonly events: number; readonly warnings: ReadonlyArray<string> },
  json: boolean,
): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "reindexed", ...result })}\n`);
  }
  const lines = [
    `skillmaker: reindexed — ${result.bundles} bundle(s), ${result.events} event(s)`,
    ...result.warnings.map((warning) => `warning: ${warning}`),
  ];
  return ok(`${lines.join("\n")}\n`);
};
