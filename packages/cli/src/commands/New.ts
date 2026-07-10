/**
 * `skillmaker new <slug>` — scaffold a Skill Bundle and journal its creation
 * (data-model.md §2.1, §2.3, §2.13; plan.md Phase 1).
 */
import { Journal, JournalLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface NewOptions {
  readonly json: boolean;
  readonly name?: string;
}

export const runNew = Effect.fn("runNew")(function* (
  cwd: string,
  slug: string | undefined,
  options: NewOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker new: missing <slug>\n\nUsage: skillmaker new <slug> [--name <name>]\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace.resolve(cwd).pipe(
    Effect.catchTag("WorkspaceNotFoundError", () =>
      Effect.succeed(undefined),
    ),
  );

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker new: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const created = yield* workspace.createBundle(resolved.root, { slug, name: options.name }).pipe(
    Effect.catchTag("InvalidSlugError", (error) =>
      Effect.succeed({ status: "invalid_slug" as const, slug: error.slug }),
    ),
  );

  if (created.status === "invalid_slug") {
    return usageError(
      `skillmaker new: "${slug}" is not a valid slug (expected ^[a-z0-9]+(-[a-z0-9]+)*$)\n`,
    );
  }

  if (created.status === "already_exists") {
    return summarize(slug, "already_exists", options.json);
  }

  // The journal path depends on the resolved workspace root, which is only
  // known at this point in the command — build and provide its layer here
  // rather than threading it through the program's top-level layer graph.
  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();
  yield* Effect.gen(function* () {
    const journal = yield* Journal;
    yield* journal.append({
      type: "bundle.created",
      actor,
      idempotencyKey: `bundle.created:${slug}`,
      payload: { bundle: slug },
    });
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  return summarize(slug, "created", options.json);
});

const summarize = (
  slug: string,
  status: "created" | "already_exists",
  json: boolean,
): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status, slug })}\n`);
  }
  if (status === "already_exists") {
    return ok(`skillmaker: bundle already exists: ${slug}\n`);
  }
  return ok(`skillmaker: created bundle ${slug}\n`);
};
