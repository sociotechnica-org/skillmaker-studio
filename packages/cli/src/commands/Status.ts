/**
 * `skillmaker status <slug>` — identity + fold state for one bundle, plus
 * its event history summary (plan.md Phase 2).
 */
import {
  type BundleRecord,
  bundleForEvent,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  Workspace,
} from "@skillmaker/core";
import { Effect, Layer } from "effect";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface StatusOptions {
  readonly json: boolean;
}

interface StatusView {
  readonly bundle: BundleRecord;
  readonly eventCount: number;
  readonly lastEventType: string | undefined;
  readonly lastEventAt: string | undefined;
}

export const runStatus = Effect.fn("runStatus")(function* (
  cwd: string,
  slug: string | undefined,
  options: StatusOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker status: missing <slug>\n\nUsage: skillmaker status <slug>\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker status: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");

  const layers = Layer.mergeAll(IndexServiceLayer(resolved.root), JournalLayer(journalPath));

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      const journal = yield* Journal;

      const bundle = yield* index.getBundle(slug);
      if (bundle === undefined) {
        return undefined;
      }

      const events = yield* journal.readAll();
      const bundleEvents = events.filter((event) => bundleForEvent(event) === slug);
      const lastEvent = bundleEvents.at(-1);

      const view: StatusView = {
        bundle,
        eventCount: bundleEvents.length,
        lastEventType: lastEvent?.type,
        lastEventAt: lastEvent?.at,
      };
      return view;
    }).pipe(Effect.provide(layers)),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker status: ${outcome.failure.message}\n`);
  }

  if (outcome.success === undefined) {
    return expectedFailure(`skillmaker status: no such bundle "${slug}"\n`);
  }

  return summarize(outcome.success, options.json);
});

const summarize = (view: StatusView, json: boolean): CliResult => {
  const { bundle } = view;
  if (json) {
    return ok(
      `${JSON.stringify({
        slug: bundle.slug,
        name: bundle.name,
        oneLiner: bundle.oneLiner,
        tags: bundle.tags,
        created: bundle.created,
        stage: bundle.stage,
        substate: bundle.substate,
        archived: bundle.archived,
        eventCount: view.eventCount,
        lastEventType: view.lastEventType ?? null,
        lastEventAt: view.lastEventAt ?? null,
      })}\n`,
    );
  }

  const lines = [
    `slug:        ${bundle.slug}`,
    `name:        ${bundle.name}`,
    `one-liner:   ${bundle.oneLiner}`,
    `tags:        ${bundle.tags.join(", ")}`,
    `created:     ${bundle.created}`,
    `stage:       ${bundle.stage}`,
    `substate:    ${bundle.substate}`,
    `archived:    ${bundle.archived}`,
    `events:      ${view.eventCount}`,
    `last event:  ${view.lastEventType !== undefined ? `${view.lastEventType} at ${view.lastEventAt}` : "(none)"}`,
  ];
  return ok(`${lines.join("\n")}\n`);
};
