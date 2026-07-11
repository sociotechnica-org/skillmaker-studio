/**
 * `skillmaker run repair <slug> [runId]` -- Fix (Phase 20 Story 3 friction
 * log F2): terminal-states "running" run(s) whose driving process is gone,
 * so a stuck run's transcript becomes gradeable instead of permanently
 * stuck. See `RunRepair.ts`'s module doc for the "why every stuck run, not
 * a PID check" design note. Repairs every stuck run for `<slug>` when
 * `runId` is omitted, or exactly one when given.
 */
import { repairRuns, type RepairedRun, RunRepairNotFoundError, JournalLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface RunRepairOptions {
  readonly json: boolean;
}

export const runRunRepair = Effect.fn("runRunRepair")(function* (
  cwd: string,
  slug: string | undefined,
  runId: string | undefined,
  options: RunRepairOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker run repair: missing <slug>\n\nUsage: skillmaker run repair <slug> [runId]\n",
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker run repair: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome = yield* Effect.result(
    repairRuns({
      root: resolved.root,
      config: resolved.config,
      bundle: slug,
      ...(runId !== undefined ? { runId } : {}),
      actor,
    }).pipe(Effect.provide(JournalLayer(journalPath))),
  );

  if (outcome._tag === "Failure") {
    const err = outcome.failure;
    if (err instanceof RunRepairNotFoundError) {
      return expectedFailure(`skillmaker run repair: ${err.message}\n`);
    }
    return expectedFailure(`skillmaker run repair: ${err.message}\n`);
  }

  return summarize(slug, outcome.success, options.json);
});

const summarize = (slug: string, repaired: ReadonlyArray<RepairedRun>, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ bundle: slug, repaired })}\n`);
  }

  const lines = [
    `skillmaker run repair: repaired ${repaired.length} run(s) for "${slug}"`,
    ...repaired.map((r) => `  ${r.runId}: -> ${r.status} (${r.reason})`),
    "",
  ];
  return ok(lines.join("\n"));
};
