/**
 * `skillmaker station run <slug> [--state <state>] [--provider claude-code]
 * [--timeout <s>]` -- drives one production-state-machine station's work end
 * to end via `StationEngine.runStation` (data-model.md §2.13, plan.md Phase
 * 10). `--state` defaults to the bundle's current folded stage. Exit codes
 * mirror `skillmaker run`: 0 completed, 1 failed, 2 usage, 3 infra-error.
 *
 * Same DEVIATION as `Run.ts`: writes minimal progress lines to stderr during
 * the run via `StationEngine`'s `onProgress` callback, since a real ACP
 * session can run for minutes.
 */
import {
  IndexService,
  IndexServiceLayer,
  JournalLayer,
  runStation,
  type BundleStage,
  type RunStationResult,
  Workspace,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, infraError, ok, usageError } from "../CliResult.ts";
import { modelDisplayName } from "../ModelDisplay.ts";

export interface StationRunOptions {
  readonly json: boolean;
  readonly state?: string;
  readonly provider?: string;
  readonly timeout?: string;
}

const DEFAULT_PROVIDER = "claude-code";

const isBundleStage = (value: string): value is BundleStage =>
  value === "idea" || value === "researching" || value === "drafting" || value === "evaluating" || value === "published";

export const runStationRun = Effect.fn("runStationRun")(function* (
  cwd: string,
  slug: string | undefined,
  options: StationRunOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker station run: missing <slug>\n\nUsage: skillmaker station run <slug> [--state <state>] [--provider <id>] [--timeout <seconds>]\n",
    );
  }
  let state: BundleStage | undefined;
  if (options.state !== undefined) {
    if (!isBundleStage(options.state)) {
      return usageError(
        `skillmaker station run: invalid --state "${options.state}" (expected one of idea, researching, drafting, evaluating, published)\n`,
      );
    }
    state = options.state;
  }

  let timeoutMs: number | undefined;
  if (options.timeout !== undefined) {
    const seconds = Number.parseFloat(options.timeout);
    if (Number.isNaN(seconds) || seconds <= 0) {
      return usageError(`skillmaker station run: invalid --timeout value "${options.timeout}"\n`);
    }
    timeoutMs = Math.round(seconds * 1000);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker station run: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const actor = yield* resolveUserActor();

  let updateCount = 0;
  const onProgress = (event: {
    readonly type: "sandbox-ready" | "session-update" | "permission-decision" | "install-warning" | "done";
    readonly status?: string;
    readonly message?: string;
    readonly skillInvoked?: boolean;
  }): void => {
    if (event.type === "sandbox-ready") {
      process.stderr.write(`skillmaker station run: sandbox ready, starting "${provider}" session...\n`);
    } else if (event.type === "session-update") {
      updateCount++;
      process.stderr.write(".");
    } else if (event.type === "permission-decision") {
      process.stderr.write("\nskillmaker station run: auto-approved a permission request\n");
    } else if (event.type === "install-warning") {
      process.stderr.write(`skillmaker station run: WARNING: ${String(event.message)}\n`);
    } else if (event.type === "done") {
      // Fix F7: surface didSkillActivate's signal on every station run's CLI
      // output.
      const invokedNote =
        event.skillInvoked === undefined ? "" : event.skillInvoked ? ", skill invoked" : ", skill NOT invoked";
      process.stderr.write(
        `\nskillmaker station run: ${String(event.status)} (${updateCount} session update(s)${invokedNote})\n`,
      );
    }
  };

  const outcome = yield* Effect.result(
    runStation({
      root: resolved.root,
      config: resolved.config,
      bundle: slug,
      ...(state !== undefined ? { state } : {}),
      provider,
      actor,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      onProgress,
    }).pipe(Effect.provide(JournalLayer(journalPath))),
  );

  if (outcome._tag === "Failure") {
    const err = outcome.failure;
    return expectedFailure(`skillmaker station run: ${err.message}\n`);
  }

  const result = outcome.success;

  // Best-effort: keep the index fresh, same rationale as Run.ts.
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

const summarize = (slug: string, result: RunStationResult, json: boolean): CliResult => {
  const payload = {
    status: result.status,
    bundle: slug,
    state: result.state,
    skill: result.skill,
    runId: result.runId,
    model: result.model || null,
    changedPaths: result.changedPaths,
    reviewRequested: result.reviewRequested,
    skillInstalled: result.skillInstalled,
    skillInvoked: result.skillInvoked,
  };

  const body = json
    ? `${JSON.stringify(payload)}\n`
    : [
        `skillmaker station run: ${result.status} (${slug}, station "${result.state}", run ${result.runId})`,
        `  skill:     ${result.skill}`,
        // Model NAME only (#141): the JSON payload above and run.json keep the full stored string.
        `  model:     ${result.model ? modelDisplayName(result.model) : "(unknown)"}`,
        `  installed: ${result.skillInstalled ? "yes" : "NO -- naked agent, see warning above"}`,
        `  invoked:   ${result.skillInvoked ? "yes (transcript shows the skill was used)" : "no (transcript shows no evidence the skill was used)"}`,
        `  changed:   ${result.changedPaths.length === 0 ? "(none)" : result.changedPaths.join(", ")}`,
        `  review:    ${result.reviewRequested ? "requested -- bundle is now awaiting-review" : "not requested"}`,
        `  run dir:   ${result.runDir}`,
        "",
      ].join("\n");

  if (result.status === "completed") {
    return ok(body);
  }
  if (result.status === "infra-error") {
    return infraError(body);
  }
  return expectedFailure(body);
};
