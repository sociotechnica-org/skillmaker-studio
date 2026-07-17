/**
 * `skillmaker receive <path> [--source <text>] [--ref <ref>] [--claimed-name
 * <name>] [--claimed-version <label-or-hash>] [--rights
 * ours|licensed|unclear] [--stakes aside|load-bearing] [--hurts <text>]
 * [--notes <text>] [--json]` -- the Receiving Dock's
 * CLI door (issue #90, `Mechanism - Receiving Dock.md` §HOW): a single
 * directory, required (ruling: "facts are per-crate; no sweep"). Copies
 * `<path>` (never moves it -- the maker's file stays untouched) to
 * `receiving/<intake-id>/`, appends `skill.received`, and prints the dock
 * verdict computed at receive time. Domain logic (validation, the copy, the
 * hash, the verdict, the append) lives in core (`receiveCrate`); this
 * command is the thin argument/output wrapper, same layering as
 * `ship`/`report`.
 *
 * `--source` defaults to the given `<path>` verbatim when omitted -- the
 * most honest fact available when the human doesn't say where a crate came
 * from, and `source` is a required field on `skill.received` (unlike the
 * CLI's own bracketed-optional usage line for it).
 */
import {
  Actor,
  isTriageStakes,
  receiveCrate,
  JournalLayer,
  Workspace,
  TRIAGE_STAKES_VALUES,
  type IntakeRights,
  type IntakeStakes,
  type ReceiveCrateResult,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

const RIGHTS_VALUES: ReadonlyArray<IntakeRights> = ["ours", "licensed", "unclear"];

const isRights = (value: string): value is IntakeRights =>
  (RIGHTS_VALUES as ReadonlyArray<string>).includes(value);

export interface ReceiveOptions {
  readonly json: boolean;
  readonly source?: string;
  readonly ref?: string;
  readonly claimedName?: string;
  readonly claimedVersion?: string;
  readonly rights?: string;
  /** Structured usage-stakes testimony (issue #108): aside | load-bearing -- recorded, never enforced; never moves a stage, never clears the badge. */
  readonly stakes?: string;
  /** Structured "what hurt" testimony (issue #108) -- free text on its own field, never flattened into --notes. */
  readonly hurts?: string;
  readonly notes?: string;
}

export const runReceive = Effect.fn("runReceive")(function* (
  cwd: string,
  targetPath: string | undefined,
  options: ReceiveOptions,
) {
  const usage =
    "Usage: skillmaker receive <path> [--source <text>] [--ref <ref>] [--claimed-name <name>] [--claimed-version <label-or-hash>] [--rights ours|licensed|unclear] [--stakes aside|load-bearing] [--hurts <text>] [--notes <text>]\n";

  if (targetPath === undefined) {
    return usageError(`skillmaker receive: missing <path>\n\n${usage}`);
  }
  if (options.rights !== undefined && !isRights(options.rights)) {
    return usageError(
      `skillmaker receive: invalid --rights "${options.rights}" (expected one of ${RIGHTS_VALUES.join(", ")})\n\n${usage}`,
    );
  }
  if (options.stakes !== undefined && !isTriageStakes(options.stakes)) {
    return usageError(
      `skillmaker receive: invalid --stakes "${options.stakes}" (expected one of ${TRIAGE_STAKES_VALUES.join(", ")})\n\n${usage}`,
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker receive: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const sourcePath = path.resolve(cwd, targetPath);
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor: Actor = yield* resolveUserActor();
  // Already validated above (usageError'd out otherwise) -- narrow casts, not re-checks.
  const rights = options.rights as IntakeRights | undefined;
  const stakes = options.stakes as IntakeStakes | undefined;

  const outcome = yield* receiveCrate({
    workspaceRoot: resolved.root,
    sourcePath,
    source: options.source !== undefined && options.source.trim().length > 0 ? options.source.trim() : targetPath,
    actor,
    ...(options.ref !== undefined ? { ref: options.ref } : {}),
    ...(options.claimedName !== undefined ? { claimedName: options.claimedName } : {}),
    ...(options.claimedVersion !== undefined ? { claimedVersionHash: options.claimedVersion } : {}),
    ...(rights !== undefined ? { rights } : {}),
    ...(stakes !== undefined ? { stakes } : {}),
    ...(options.hurts !== undefined ? { hurts: options.hurts } : {}),
    ...(options.notes !== undefined ? { notes: options.notes } : {}),
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("ReceivePathNotFoundError", (error) =>
      Effect.succeed({ kind: "not_found" as const, path: error.path }),
    ),
    Effect.catchTag("ReceivePathNotDirectoryError", (error) =>
      Effect.succeed({ kind: "not_directory" as const, path: error.path }),
    ),
    Effect.catchTag("ReceiveNotASkillError", (error) =>
      Effect.succeed({ kind: "not_a_skill" as const, path: error.path }),
    ),
  );

  if (outcome.kind === "not_found") {
    return expectedFailure(`skillmaker receive: path "${outcome.path}" does not exist\n`);
  }
  if (outcome.kind === "not_directory") {
    return expectedFailure(`skillmaker receive: path "${outcome.path}" is not a directory\n`);
  }
  if (outcome.kind === "not_a_skill") {
    return expectedFailure(
      `skillmaker receive: "${outcome.path}" has no SKILL.md -- the dock takes skills, not arbitrary directories\n`,
    );
  }

  return summarize(outcome.result, options.json);
});

const summarize = (result: ReceiveCrateResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "received",
        intake: result.intake,
        verdict: result.verdict,
        receivedDir: result.receivedDir,
      })}\n`,
    );
  }

  return ok(
    `skillmaker: received crate ${result.intake} -- verdict: ${result.verdict}\n  copied to ${result.receivedDir}\n`,
  );
};
