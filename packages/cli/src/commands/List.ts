/**
 * `skillmaker list` — the bundle table (plan.md Phase 2). Always folds
 * fresh (rebuild then read) — at this scale correctness beats caching.
 */
import { type BundleRecord, IndexService, IndexServiceLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface ListOptions {
  readonly json: boolean;
}

export const runList = Effect.fn("runList")(function* (cwd: string, options: ListOptions) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker list: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listBundles();
    }).pipe(Effect.provide(IndexServiceLayer(resolved.root))),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker list: ${outcome.failure.message}\n`);
  }

  return summarize(outcome.success, options.json);
});

const summarize = (bundles: ReadonlyArray<BundleRecord>, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ bundles })}\n`);
  }

  if (bundles.length === 0) {
    return ok("skillmaker: no skill bundles yet (run `skillmaker new <slug>`)\n");
  }

  const rows = bundles.map((bundle) => ({
    slug: bundle.slug,
    stage: bundle.stage,
    substate: bundle.archived ? `${bundle.substate} (archived)` : bundle.substate,
  }));

  const slugWidth = Math.max("SLUG".length, ...rows.map((row) => row.slug.length));
  const stageWidth = Math.max("STAGE".length, ...rows.map((row) => row.stage.length));

  const header = `${"SLUG".padEnd(slugWidth)}  ${"STAGE".padEnd(stageWidth)}  SUBSTATE`;
  const lines = rows.map(
    (row) => `${row.slug.padEnd(slugWidth)}  ${row.stage.padEnd(stageWidth)}  ${row.substate}`,
  );

  return ok(`${[header, ...lines].join("\n")}\n`);
};
