/**
 * `skillmaker reindex` — rebuild `.skillmaker/studio.db` from files + the
 * journal and report what changed. The index is a rebuildable cache
 * (data-model.md §1.3), so this command is always safe to re-run and never
 * hard-fails on malformed input (Part 3 ruling I) — it surfaces warnings.
 */
import { IndexService, IndexServiceLayer, Workspace } from "@skillmaker/core";
import type { RebuildResult, WarningRecord } from "@skillmaker/core";
import { Effect } from "effect";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface ReindexOptions {
  readonly json: boolean;
}

interface ReindexView {
  readonly result: RebuildResult;
  readonly warnings: ReadonlyArray<WarningRecord>;
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
      const result = yield* index.rebuild();
      // `result.warnings` is flat messages; re-fetch the persisted,
      // bundle-tagged rows so the CLI can group warnings by bundle.
      const warnings = yield* index.listWarnings();
      const view: ReindexView = { result, warnings };
      return view;
    }).pipe(Effect.provide(IndexServiceLayer(resolved.root))),
  );

  if (outcome._tag === "Failure") {
    const failure = outcome.failure;
    // Fix F4: honor --json on the failure path too -- before this fix
    // `reindex --json` printed plain text on any rebuild failure, breaking
    // scripts/tooling that always expect JSON.
    if (options.json) {
      return expectedFailure(
        `${JSON.stringify({
          status: "error",
          message: failure.message,
          ...("eventId" in failure && failure.eventId !== undefined ? { eventId: failure.eventId } : {}),
          ...("lineNumber" in failure && failure.lineNumber !== undefined
            ? { lineNumber: failure.lineNumber }
            : {}),
        })}\n`,
      );
    }
    return expectedFailure(`skillmaker reindex: ${failure.message}\n`);
  }

  return summarize(outcome.success, options.json);
});

const summarize = (view: ReindexView, json: boolean): CliResult => {
  const { result, warnings } = view;
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "reindexed",
        bundles: result.bundles,
        todos: result.todos,
        events: result.events,
        warnings: warnings.map((w) => ({ bundle: w.bundle ?? null, source: w.source, message: w.message })),
      })}\n`,
    );
  }

  const lines = [`skillmaker: reindexed — ${result.bundles} bundle(s), ${result.events} event(s)`];

  const byBundle = new Map<string, WarningRecord[]>();
  const appLevel: WarningRecord[] = [];
  for (const warning of warnings) {
    if (warning.bundle === undefined) {
      appLevel.push(warning);
      continue;
    }
    const bucket = byBundle.get(warning.bundle) ?? [];
    bucket.push(warning);
    byBundle.set(warning.bundle, bucket);
  }

  for (const bundle of [...byBundle.keys()].sort()) {
    lines.push(`warnings for "${bundle}":`);
    for (const warning of byBundle.get(bundle) ?? []) {
      lines.push(`  [${warning.source}] ${warning.message}`);
    }
  }
  if (appLevel.length > 0) {
    lines.push("warnings:");
    for (const warning of appLevel) {
      lines.push(`  [${warning.source}] ${warning.message}`);
    }
  }

  return ok(`${lines.join("\n")}\n`);
};
