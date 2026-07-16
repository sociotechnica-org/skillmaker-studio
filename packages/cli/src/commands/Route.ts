/**
 * `skillmaker route <intake-id> --as return|new|upgrade|fork|salvage --reason
 * <text> [--bundle <slug>] [--parent <slug>] [--name <name>] [--stage
 * <stage>] [--json]` -- the Receiving Dock's five exit doors (issue #91,
 * `Mechanism - Receiving Dock.md` §HOW). Thin argument/output wrapper around
 * core's `routeCrate` (`Route.ts`), same layering `ship`/`receive` use:
 * this command only parses argv, resolves the workspace, and maps
 * `routeCrate`'s tagged errors to honest CLI failures.
 *
 * `--reason` is required on every disposition, no exceptions -- the
 * hypothesis (broken? evolved? forked?) IS the point (same house law
 * backward stage moves already demand). `--bundle` is required for
 * `return`/`upgrade` (the existing bundle being routed against); `--parent`
 * is required for `fork` (the existing bundle this one is forked from).
 */
import {
  DISPOSITIONS,
  routeCrate,
  isRouteDisposition,
  JournalLayer,
  STAGES,
  Workspace,
  type RouteCrateResult,
  type RouteDisposition,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";
import { resolveStage } from "../StageVocab.ts";

export interface RouteOptions {
  readonly json: boolean;
  readonly as?: string;
  readonly bundle?: string;
  readonly parent?: string;
  readonly name?: string;
  readonly stage?: string;
  readonly reason?: string;
}

const USAGE =
  "Usage: skillmaker route <intake-id> --as return|new|upgrade|fork|salvage --reason <text> [--bundle <slug>] [--parent <slug>] [--name <name>] [--stage <stage>]\n";

export const runRoute = Effect.fn("runRoute")(function* (
  cwd: string,
  intake: string | undefined,
  options: RouteOptions,
) {
  if (intake === undefined) {
    return usageError(`skillmaker route: missing <intake-id>\n\n${USAGE}`);
  }
  if (options.as === undefined || !isRouteDisposition(options.as)) {
    return usageError(
      `skillmaker route: missing or invalid --as (expected one of ${DISPOSITIONS.join(", ")})\n\n${USAGE}`,
    );
  }
  const disposition: RouteDisposition = options.as;

  if (options.reason === undefined || options.reason.trim().length === 0) {
    return usageError(`skillmaker route: missing --reason <text>\n\n${USAGE}`);
  }

  if ((disposition === "return" || disposition === "upgrade") && (options.bundle === undefined || options.bundle.trim().length === 0)) {
    return usageError(`skillmaker route: --as ${disposition} requires --bundle <slug>\n\n${USAGE}`);
  }
  if (disposition === "fork" && (options.parent === undefined || options.parent.trim().length === 0)) {
    return usageError(`skillmaker route: --as fork requires --parent <slug>\n\n${USAGE}`);
  }

  const stage = options.stage !== undefined ? resolveStage(options.stage) : undefined;
  if (options.stage !== undefined && stage === undefined) {
    return usageError(
      `skillmaker route: invalid --stage "${options.stage}" (expected one of ${STAGES.join(", ")})\n`,
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker route: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const outcome = yield* routeCrate({
    workspaceRoot: resolved.root,
    skillsDir: resolved.config.skillsDir,
    intake,
    disposition,
    reason: options.reason.trim(),
    actor,
    ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(stage !== undefined ? { stage } : {}),
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("RouteIntakeNotFoundError", (error) =>
      Effect.succeed({ kind: "intake_not_found" as const, intake: error.intake }),
    ),
    Effect.catchTag("RouteAlreadyRoutedError", (error) =>
      Effect.succeed({
        kind: "already_routed" as const,
        existingDisposition: error.existingDisposition,
        attemptedDisposition: error.attemptedDisposition,
      }),
    ),
    Effect.catchTag("RouteBundleNotFoundError", (error) =>
      Effect.succeed({ kind: "bundle_not_found" as const, bundle: error.bundle }),
    ),
    Effect.catchTag("RouteNoHashMatchError", (error) =>
      Effect.succeed({ kind: "no_hash_match" as const, bundle: error.bundle }),
    ),
    Effect.catchTag("RouteSlugCollisionError", (error) =>
      Effect.succeed({ kind: "slug_collision" as const, slug: error.slug }),
    ),
  );

  if (outcome.kind === "intake_not_found") {
    return expectedFailure(`skillmaker route: no such intake "${outcome.intake}"\n`);
  }
  if (outcome.kind === "already_routed") {
    return expectedFailure(
      `skillmaker route: intake "${intake}" was already routed as "${outcome.existingDisposition}" -- cannot also route it as "${outcome.attemptedDisposition}"\n`,
    );
  }
  if (outcome.kind === "bundle_not_found") {
    return expectedFailure(`skillmaker route: no such bundle "${outcome.bundle}"\n`);
  }
  if (outcome.kind === "no_hash_match") {
    return expectedFailure(
      `skillmaker route: intake "${intake}"'s content does not match any recorded version of "${outcome.bundle}" -- "return" requires a hash match\n`,
    );
  }
  if (outcome.kind === "slug_collision") {
    return expectedFailure(`skillmaker route: "${outcome.slug}" is already a bundle -- pick a different --bundle/--name\n`);
  }

  return summarize(intake, outcome.result, options.json);
});

const summarize = (intake: string, result: RouteCrateResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: result.alreadyRouted ? "already_routed" : "routed",
        intake,
        disposition: result.disposition,
        bundle: result.bundle ?? null,
        slug: result.slug ?? null,
        parent: result.parent ?? null,
        versionHash: result.versionHash ?? null,
      })}\n`,
    );
  }

  if (result.alreadyRouted) {
    return ok(`skillmaker: intake ${intake} was already routed as "${result.disposition}" (no-op)\n`);
  }

  const bundleText = result.bundle !== undefined ? ` -- bundle: ${result.bundle}` : "";
  const parentText = result.parent !== undefined ? ` (forked from ${result.parent})` : "";
  return ok(`skillmaker: routed intake ${intake} as "${result.disposition}"${bundleText}${parentText}\n`);
};
