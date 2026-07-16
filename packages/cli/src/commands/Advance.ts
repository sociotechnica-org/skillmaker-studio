/**
 * `skillmaker advance <slug> [--to <stage>] [--back <stage> --reason <text>]
 * [--override]` -- runs `checkTransition` (the same guard the server runs
 * for `POST /api/events`) against the bundle's current journal, then either
 * appends `bundle.stage_changed` or prints the rejection reason and exits 1.
 * One contract (`@skillmaker/core`'s `Machine`), two doors (this command and
 * the server).
 */
import {
  checkTransition,
  foldBundleStates,
  Journal,
  JournalLayer,
  STAGES,
  Workspace,
} from "@skillmaker/core";
import type { BundleStage } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";
import { resolveStage } from "../StageVocab.ts";

export interface AdvanceOptions {
  readonly json: boolean;
  readonly to?: string;
  readonly back?: string;
  readonly reason?: string;
  readonly override: boolean;
}

type AdvanceOutcome =
  | { readonly kind: "advanced"; readonly from: BundleStage; readonly to: BundleStage }
  | { readonly kind: "rejected"; readonly reason: string };

export const runAdvance = Effect.fn("runAdvance")(function* (
  cwd: string,
  slug: string | undefined,
  options: AdvanceOptions,
) {
  if (slug === undefined) {
    return usageError(
      "skillmaker advance: missing <slug>\n\nUsage: skillmaker advance <slug> [--to <stage>] [--back <stage> --reason <text>] [--override]\n",
    );
  }

  if (options.to !== undefined && options.back !== undefined) {
    return usageError("skillmaker advance: pass either --to or --back, not both\n");
  }

  const toStage: BundleStage | undefined = options.to !== undefined ? resolveStage(options.to) : undefined;
  if (options.to !== undefined && toStage === undefined) {
    return usageError(`skillmaker advance: invalid --to stage "${options.to}"\n`);
  }
  const backStage: BundleStage | undefined = options.back !== undefined ? resolveStage(options.back) : undefined;
  if (options.back !== undefined && backStage === undefined) {
    return usageError(`skillmaker advance: invalid --back stage "${options.back}"\n`);
  }
  if (options.back !== undefined && (options.reason === undefined || options.reason.trim().length === 0)) {
    return usageError("skillmaker advance: --back requires --reason <text>\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker advance: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome: AdvanceOutcome = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    const events = yield* journal.readAll();
    const states = foldBundleStates(events);
    const from = states.get(slug)?.stage ?? "idea";

    let to: BundleStage;
    if (backStage !== undefined) {
      to = backStage;
    } else if (toStage !== undefined) {
      to = toStage;
    } else {
      const nextIndex = STAGES.indexOf(from) + 1;
      const next = STAGES[nextIndex];
      if (next === undefined) {
        return { kind: "rejected" as const, reason: `bundle "${slug}" is already at the final stage "${from}"` };
      }
      to = next;
    }

    const verdict = checkTransition(events, {
      bundle: slug,
      from,
      to,
      reason: options.reason,
      override: options.override,
    });

    if (!verdict.allowed) {
      return { kind: "rejected" as const, reason: verdict.reason };
    }

    yield* journal.append({
      type: "bundle.stage_changed",
      actor,
      payload: {
        bundle: slug,
        from,
        to,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        ...(options.override ? { override: true } : {}),
      },
    });

    return { kind: "advanced" as const, from, to };
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  if (outcome.kind === "rejected") {
    if (options.json) {
      return expectedFailure(`${JSON.stringify({ status: "rejected", slug, reason: outcome.reason })}\n`);
    }
    return expectedFailure(`skillmaker advance: ${outcome.reason}\n`);
  }

  if (options.json) {
    return ok(
      `${JSON.stringify({ status: "advanced", slug, from: outcome.from, to: outcome.to })}\n`,
    );
  }
  return ok(`skillmaker: ${slug} moved from "${outcome.from}" to "${outcome.to}"\n`);
});
