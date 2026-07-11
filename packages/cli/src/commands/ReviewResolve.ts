/**
 * `skillmaker review resolve <slug> --decision approve|revise [--notes <text>]`
 * -- appends `review.resolved` for the bundle's current stage (data-model.md
 * §2.13, §2.9), the same journal path `POST /api/events` uses from the
 * viewer's review panel (Server.ts's `review.resolved` guard). Two doors,
 * one guard: a solo publisher must never *need* the browser to resolve a
 * review -- see docs/phase20/story-4-friction-log.md finding #3. Rejects if
 * the bundle isn't currently `awaiting-review` at the given stage, same as
 * the server-side check.
 */
import { foldBundleStates, Journal, JournalLayer, Workspace } from "@skillmaker/core";
import type { BundleStage } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface ReviewResolveOptions {
  readonly json: boolean;
  readonly decision?: string;
  readonly notes?: string;
}

type Decision = "approve" | "revise";

const isDecision = (value: string): value is Decision => value === "approve" || value === "revise";

interface ResolveOutcome {
  readonly status: "resolved" | "not_awaiting_review";
  readonly stage: BundleStage;
  readonly substate?: string;
}

export const runReviewResolve = Effect.fn("runReviewResolve")(function* (
  cwd: string,
  slug: string | undefined,
  options: ReviewResolveOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker review resolve: missing <slug>\n\nUsage: skillmaker review resolve <slug> --decision approve|revise [--notes <text>]\n",
    );
  }

  if (options.decision === undefined) {
    return usageError(
      "skillmaker review resolve: missing --decision\n\nUsage: skillmaker review resolve <slug> --decision approve|revise [--notes <text>]\n",
    );
  }

  if (!isDecision(options.decision)) {
    return usageError(
      `skillmaker review resolve: invalid --decision "${options.decision}" (expected "approve" or "revise")\n\nUsage: skillmaker review resolve <slug> --decision approve|revise [--notes <text>]\n`,
    );
  }
  const decision = options.decision;

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker review resolve: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome: ResolveOutcome = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    const events = yield* journal.readAll();
    const states = foldBundleStates(events);
    const state = states.get(slug);
    const stage: BundleStage = state?.stage ?? "idea";

    if (state === undefined || state.substate !== "awaiting-review") {
      return { status: "not_awaiting_review" as const, stage, substate: state?.substate };
    }

    yield* journal.append({
      type: "review.resolved",
      actor,
      payload: {
        bundle: slug,
        state: stage,
        decision,
        ...(options.notes !== undefined ? { notes: options.notes } : {}),
      },
    });

    return { status: "resolved" as const, stage };
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  if (outcome.status === "not_awaiting_review") {
    return expectedFailure(
      `skillmaker review resolve: bundle "${slug}" is not awaiting review (currently "${outcome.substate ?? "unknown"}" at stage "${outcome.stage}")\n`,
    );
  }

  return summarize(slug, decision, outcome, options.json);
});

const summarize = (
  slug: string,
  decision: Decision,
  outcome: ResolveOutcome,
  json: boolean,
): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({ status: outcome.status, slug, stage: outcome.stage, decision })}\n`,
    );
  }
  return ok(
    `skillmaker: resolved review for ${slug} at stage "${outcome.stage}" (${decision})\n`,
  );
};
