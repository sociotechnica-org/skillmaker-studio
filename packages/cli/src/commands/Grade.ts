/**
 * `skillmaker grade <slug> <runId> --verdict pass|fail|partial [--notes <text>]`
 * -- the CLI door onto the same journal the viewer's grading panel writes
 * through ("two doors, one journal"): appends `run.graded` (data-model.md
 * §2.9). No `idempotencyKey` -- a regrade is a genuinely new event, latest
 * wins at fold time (IndexService.ts's `gradeByRunId` map). Grading a run
 * that is not `status: "completed"` (infra-error/running) is refused: those
 * runs carry no task-level verdict to grade.
 */
import { Journal, JournalLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

const USAGE =
  "Usage: skillmaker grade <slug> <runId> --verdict pass|fail|partial [--notes <text>]\n";

const VERDICTS = new Set(["pass", "fail", "partial"]);

export interface GradeOptions {
  readonly json: boolean;
  readonly verdict?: string;
  readonly notes?: string;
}

export const runGrade = Effect.fn("runGrade")(function* (
  cwd: string,
  slug: string | undefined,
  runId: string | undefined,
  options: GradeOptions,
) {
  if (slug === undefined || runId === undefined) {
    return usageError(`skillmaker grade: missing <slug> and/or <runId>\n\n${USAGE}`);
  }
  if (options.verdict === undefined) {
    return usageError(`skillmaker grade: missing --verdict\n\n${USAGE}`);
  }
  if (!VERDICTS.has(options.verdict)) {
    return usageError(
      `skillmaker grade: invalid --verdict "${options.verdict}" (must be pass|fail|partial)\n\n${USAGE}`,
    );
  }
  const verdict = options.verdict as "pass" | "fail" | "partial";

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker grade: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const runJsonPath = path.join(resolved.root, resolved.config.skillsDir, slug, "runs", runId, "run.json");

  const runJsonExists = yield* fs.exists(runJsonPath);
  if (!runJsonExists) {
    return expectedFailure(`skillmaker grade: no such run "${runId}" in bundle "${slug}"\n`);
  }

  const raw = yield* fs.readFileString(runJsonPath);
  const status = yield* Effect.try({
    try: () => (JSON.parse(raw) as { readonly status?: unknown }).status,
    catch: () => "unknown",
  });
  if (status !== "completed") {
    return expectedFailure(
      `skillmaker grade: run "${runId}" cannot be graded: status is "${String(status)}", not "completed" (infra-error/running runs are never graded)\n`,
    );
  }

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const result = yield* Journal.pipe(
    Effect.flatMap((journal) =>
      journal.append({
        type: "run.graded",
        actor,
        payload: {
          id: runId,
          verdict,
          ...(options.notes !== undefined ? { notes: options.notes } : {}),
        },
      }),
    ),
    Effect.provide(JournalLayer(journalPath)),
  );

  return summarize(slug, runId, verdict, result.status, options.json);
});

const summarize = (
  slug: string,
  runId: string,
  verdict: string,
  status: "appended" | "already_appended",
  json: boolean,
): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status, bundle: slug, runId, verdict })}\n`);
  }
  return ok(`skillmaker grade: recorded verdict "${verdict}" for run ${runId} (${slug})\n`);
};
