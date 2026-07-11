/**
 * `skillmaker run <slug> --fixture <case> [--provider claude-code] [--timeout <s>]`
 * -- drives one eval run end to end via `RunEngine.runFixture` (data-model.md
 * §2.8, plan.md Phase 8). Exit codes are deliberately distinct so scripts can
 * tell infra faults from real task failures: 0 completed, 1 failed, 2 usage,
 * 3 infra-error (auth/sandbox/connection faults never pollute pass rates).
 *
 * DEVIATION from the rest of this CLI: every other command stays a pure
 * Effect value until `main.ts` writes stdout/stderr once at the very end.
 * This command instead writes minimal progress lines to stderr *during* the
 * run (sandbox ready / session updates / auto-approved permissions / done)
 * via `RunEngine`'s `onProgress` callback, because a real ACP session can
 * take ~15s-5min and a silent CLI over that span reads as hung. The
 * `CliResult` it resolves to still carries only the final summary, so
 * nothing is double-printed.
 */
import {
  IndexService,
  IndexServiceLayer,
  JournalLayer,
  runFixture,
  type RunFixtureResult,
  Workspace,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, infraError, ok, usageError } from "../CliResult.ts";

export interface RunOptions {
  readonly json: boolean;
  readonly fixture?: string;
  readonly provider?: string;
  readonly timeout?: string;
}

const DEFAULT_PROVIDER = "claude-code";

export const runRun = Effect.fn("runRun")(function* (
  cwd: string,
  slug: string | undefined,
  options: RunOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker run: missing <slug>\n\nUsage: skillmaker run <slug> --fixture <case> [--provider <id>] [--timeout <seconds>]\n",
    );
  }
  if (options.fixture === undefined) {
    return usageError(
      "skillmaker run: missing --fixture <case>\n\nUsage: skillmaker run <slug> --fixture <case> [--provider <id>] [--timeout <seconds>]\n",
    );
  }

  let timeoutMs: number | undefined;
  if (options.timeout !== undefined) {
    const seconds = Number.parseFloat(options.timeout);
    if (Number.isNaN(seconds) || seconds <= 0) {
      return usageError(`skillmaker run: invalid --timeout value "${options.timeout}"\n`);
    }
    timeoutMs = Math.round(seconds * 1000);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker run: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const actor = yield* resolveUserActor();

  let updateCount = 0;
  const onProgress = (event: {
    readonly type: "sandbox-ready" | "session-update" | "permission-decision" | "done";
    readonly status?: string;
  }): void => {
    if (event.type === "sandbox-ready") {
      process.stderr.write(`skillmaker run: sandbox ready, starting "${provider}" session...\n`);
    } else if (event.type === "session-update") {
      updateCount++;
      process.stderr.write(".");
    } else if (event.type === "permission-decision") {
      process.stderr.write("\nskillmaker run: auto-approved a permission request\n");
    } else if (event.type === "done") {
      process.stderr.write(`\nskillmaker run: ${String(event.status)} (${updateCount} session update(s))\n`);
    }
  };

  const outcome = yield* Effect.result(
    runFixture({
      root: resolved.root,
      config: resolved.config,
      bundle: slug,
      fixtureCase: options.fixture,
      provider,
      actor,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      onProgress,
    }).pipe(Effect.provide(JournalLayer(journalPath))),
  );

  if (outcome._tag === "Failure") {
    const err = outcome.failure;
    return expectedFailure(`skillmaker run: ${err.message}\n`);
  }

  const result = outcome.success;

  // Best-effort: keep the index fresh so `status`/the viewer see the new
  // run immediately, but never let an index rebuild failure mask the run's
  // own (already-final and already-persisted) outcome.
  yield* index.rebuildBestEffort(resolved.root).pipe(Effect.ignore);

  return summarize(slug, result, options.json);
});

const index = {
  rebuildBestEffort: (root: string) =>
    Effect.gen(function* () {
      const svc = yield* IndexService;
      yield* svc.rebuild();
    }).pipe(Effect.provide(IndexServiceLayer(root))),
};

const summarize = (slug: string, result: RunFixtureResult, json: boolean): CliResult => {
  const payload = {
    status: result.status,
    bundle: slug,
    runId: result.runId,
    skillVersionHash: result.skillVersionHash,
    autoRecordedVersion: result.autoRecordedVersion,
    model: result.model || null,
    artifacts: result.artifacts,
  };

  const body = json
    ? `${JSON.stringify(payload)}\n`
    : [
        `skillmaker run: ${result.status} (${slug}, run ${result.runId})`,
        `  version:   ${result.skillVersionHash}${result.autoRecordedVersion ? " (auto-recorded before this run)" : ""}`,
        `  model:     ${result.model || "(unknown)"}`,
        `  artifacts: ${result.artifacts.length === 0 ? "(none)" : result.artifacts.join(", ")}`,
        `  run dir:   ${result.runDir}`,
        "",
      ].join("\n");

  if (result.status === "completed") {
    return ok(body);
  }
  if (result.status === "infra-error") {
    return infraError(body);
  }
  // "failed" (and the unreachable "running")
  return expectedFailure(body);
};
