/**
 * `skillmaker review request <slug> [--question <text>]` -- appends
 * `review.requested` for the bundle's current stage (data-model.md §2.13,
 * §2.9). Rejects if the bundle is already `awaiting-review`.
 */
import { foldBundleStates, Journal, JournalLayer, Workspace } from "@skillmaker/core";
import type { BundleStage } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface ReviewRequestOptions {
  readonly json: boolean;
  readonly question?: string;
}

interface RequestOutcome {
  readonly status: "requested" | "already_awaiting_review";
  readonly stage: BundleStage;
}

export const runReviewRequest = Effect.fn("runReviewRequest")(function* (
  cwd: string,
  slug: string | undefined,
  options: ReviewRequestOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker review request: missing <slug>\n\nUsage: skillmaker review request <slug> [--question <text>]\n",
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker review request: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome: RequestOutcome = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    const events = yield* journal.readAll();
    const states = foldBundleStates(events);
    const state = states.get(slug);
    const stage: BundleStage = state?.stage ?? "idea";

    if (state?.substate === "awaiting-review") {
      return { status: "already_awaiting_review" as const, stage };
    }

    yield* journal.append({
      type: "review.requested",
      actor,
      payload: {
        bundle: slug,
        state: stage,
        ...(options.question !== undefined ? { question: options.question } : {}),
      },
    });

    return { status: "requested" as const, stage };
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  if (outcome.status === "already_awaiting_review") {
    return expectedFailure(
      `skillmaker review request: bundle "${slug}" is already awaiting review (stage "${outcome.stage}")\n`,
    );
  }

  return summarize(slug, outcome, options.json);
});

const summarize = (slug: string, outcome: RequestOutcome, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: outcome.status, slug, stage: outcome.stage })}\n`);
  }
  return ok(`skillmaker: requested review for ${slug} at stage "${outcome.stage}"\n`);
};
