/**
 * `skillmaker run repair <slug> [runId]` -- Fix (Phase 20 Story 3 friction
 * log F2): terminal-states a "running" run whose driving process is gone
 * (a host crash, an operator Ctrl-C, or -- before the `copyPreservingPath`
 * ENOENT hardening landed alongside this fix -- an artifact-capture crash
 * mid-flight) so its transcript becomes gradeable instead of permanently
 * stuck at `status: "running"` with no `endedAt`.
 *
 * DESIGN NOTE: `run.json` never records a PID, so "the process is gone" is
 * not something this tool can verify against the OS process table -- a run
 * spawned by the CLI, the server, or a previous invocation of this repair
 * tool itself may be running in any process, on any host. `run repair` is
 * therefore an explicit operator action: it repairs every run matching
 * `status === "running"` for the given bundle (or a single `runId`) on the
 * assumption that a human (or `reindex`) is invoking it *because* they've
 * already established the run is stuck, not as an automatic background
 * sweep that could race a run that's still genuinely in flight. This is a
 * deliberate scope choice for this fix, not an oversight -- documented here
 * so a future PID-tracking fix has a clear "why not" to react to.
 *
 * Never promotes a stuck run to "completed" by assumption: only when the
 * run's own `transcript.jsonl` already shows a `session/prompt` response
 * with `stopReason: "end_turn"` (the same signal `RunEngine.ts`'s own
 * `classifyAcpError`/success path uses) does repair land on `"completed"`.
 * Otherwise it lands on `"failed"` with reason `"interrupted: artifact
 * capture"` -- a real terminal state, not a guess, matching the fix's
 * stated contract. Repaired runs are never claimed to be more complete than
 * their transcript proves; artifacts already captured under
 * `runs/<id>/artifacts/` before the interruption are left exactly as they
 * are (best-effort, never re-synthesized).
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { Actor } from "./Actor.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { Journal } from "./JournalService.ts";
import { RunRecord, type RunStatus } from "./Run.ts";
import type { WorkspaceConfig } from "./Workspace.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** No such bundle, or no matching "running" run(s) to repair. */
export class RunRepairNotFoundError extends Schema.TaggedErrorClass<RunRepairNotFoundError>()(
  "RunRepairNotFoundError",
  { message: Schema.String },
) {}

export interface RunRepairInput {
  readonly root: string;
  readonly config: WorkspaceConfig;
  readonly bundle: string;
  /** A single run id to repair; when omitted, every `status: "running"` run under this bundle is repaired. */
  readonly runId?: string;
  readonly actor: Actor;
}

export interface RepairedRun {
  readonly runId: string;
  readonly status: Extract<RunStatus, "completed" | "failed">;
  readonly reason: string;
  readonly endedAt: string;
}

const INTERRUPTED_REASON = "interrupted: artifact capture";

/**
 * Scans a `transcript.jsonl` (best-effort JSON-per-line, tolerant of a
 * truncated/malformed trailing line -- the same failure mode that leaves a
 * run stuck in the first place) for a "recv" entry whose JSON-RPC result
 * carries `stopReason: "end_turn"` (`AcpClient.ts`'s `prompt()` shape), and
 * the timestamp of the transcript's last well-formed entry (used as a
 * best-effort `endedAt` when the real one was never recorded).
 */
const scanTranscript = (raw: string): { readonly endTurn: boolean; readonly lastTimestamp?: string } => {
  let endTurn = false;
  let lastTimestamp: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let entry: { t?: unknown; dir?: unknown; message?: { result?: { stopReason?: unknown } } };
    try {
      entry = JSON.parse(trimmed) as typeof entry;
    } catch {
      // A truncated final line is exactly the crash signature this repair
      // exists for -- tolerate it and keep whatever was parsed so far.
      continue;
    }
    if (typeof entry.t === "string") {
      lastTimestamp = entry.t;
    }
    if (entry.dir === "recv" && entry.message?.result?.stopReason === "end_turn") {
      endTurn = true;
    }
  }
  return { endTurn, lastTimestamp };
};

/** Terminal-states every stuck ("running") run for a bundle, or one specific run id. */
export const repairRuns = Effect.fn("RunRepair.repairRuns")(function* (input: RunRepairInput) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const journal = yield* Journal;

  const bundleDir = path.join(input.root, input.config.skillsDir, input.bundle);
  const bundleJsonPath = path.join(bundleDir, "bundle.json");
  const bundleExists = yield* fs
    .exists(bundleJsonPath)
    .pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));
  if (!bundleExists) {
    return yield* Effect.fail(
      RunRepairNotFoundError.make({ message: `no such bundle "${input.bundle}"` }),
    );
  }

  const runsDir = path.join(bundleDir, "runs");
  const runsDirExists = yield* fs.exists(runsDir).pipe(Effect.mapError(toIOError(`could not check ${runsDir}`)));

  const candidateIds: string[] = [];
  if (input.runId !== undefined) {
    candidateIds.push(input.runId);
  } else if (runsDirExists) {
    const entries = yield* fs
      .readDirectory(runsDir)
      .pipe(Effect.mapError(toIOError(`could not read ${runsDir}`)));
    for (const name of entries) {
      // Tolerate non-directory entries under runs/ (e.g. a stray .gitkeep) --
      // same "scan is best-effort, never a hard failure" philosophy
      // IndexService.ts's own run-scanning uses.
      const isDir = yield* fs
        .stat(path.join(runsDir, name))
        .pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.orElseSucceed(() => false),
        );
      if (!isDir) continue;
      const runJsonPath = path.join(runsDir, name, "run.json");
      const exists = yield* fs.exists(runJsonPath).pipe(Effect.mapError(toIOError(`could not check ${runJsonPath}`)));
      if (exists) candidateIds.push(name);
    }
  }

  const repaired: RepairedRun[] = [];

  for (const runId of candidateIds) {
    const runDir = path.join(runsDir, runId);
    const runJsonPath = path.join(runDir, "run.json");

    const runJsonExists = yield* fs
      .exists(runJsonPath)
      .pipe(Effect.mapError(toIOError(`could not check ${runJsonPath}`)));
    if (!runJsonExists) {
      if (input.runId !== undefined) {
        return yield* Effect.fail(
          RunRepairNotFoundError.make({ message: `no such run "${runId}" for bundle "${input.bundle}"` }),
        );
      }
      continue;
    }

    const raw = yield* fs
      .readFileString(runJsonPath)
      .pipe(Effect.mapError(toIOError(`could not read ${runJsonPath}`)));
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: toIOError(`invalid JSON in ${runJsonPath}`),
    });
    const record = yield* Schema.decodeUnknownEffect(RunRecord)(parsed).pipe(
      Effect.mapError(toIOError(`invalid run record in ${runJsonPath}`)),
    );

    if (record.status !== "running") {
      if (input.runId !== undefined) {
        return yield* Effect.fail(
          RunRepairNotFoundError.make({
            message: `run "${runId}" is not stuck (status: "${record.status}"), nothing to repair`,
          }),
        );
      }
      continue;
    }

    const transcriptPath = path.join(runDir, "transcript.jsonl");
    const transcriptExists = yield* fs
      .exists(transcriptPath)
      .pipe(Effect.mapError(toIOError(`could not check ${transcriptPath}`)));
    const scanned = transcriptExists
      ? scanTranscript(
          yield* fs.readFileString(transcriptPath).pipe(Effect.mapError(toIOError(`could not read ${transcriptPath}`))),
        )
      : { endTurn: false, lastTimestamp: undefined };

    const status: Extract<RunStatus, "completed" | "failed"> = scanned.endTurn ? "completed" : "failed";
    const reason = scanned.endTurn
      ? `${INTERRUPTED_REASON} (transcript shows end_turn; artifacts best-effort)`
      : INTERRUPTED_REASON;
    const endedAt = scanned.lastTimestamp ?? new Date().toISOString();

    const finalRecord = RunRecord.make({
      ...record,
      status,
      endedAt,
      repaired: { at: new Date().toISOString(), reason },
    });

    // Atomic write (temp file + rename): a repair tool must never itself
    // leave run.json in a half-written state on a crash mid-write.
    const tmpPath = `${runJsonPath}.repair-tmp-${crypto.randomUUID()}`;
    yield* fs
      .writeFileString(tmpPath, `${JSON.stringify(finalRecord, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${tmpPath}`)));
    yield* fs
      .rename(tmpPath, runJsonPath)
      .pipe(Effect.mapError(toIOError(`could not finalize ${runJsonPath}`)));

    yield* journal.append({
      actor: input.actor,
      type: "run.repaired",
      payload: { id: runId, status, endedAt, reason },
    });

    repaired.push({ runId, status, reason, endedAt });
  }

  if (repaired.length === 0 && input.runId === undefined) {
    return yield* Effect.fail(
      RunRepairNotFoundError.make({ message: `no stuck ("running") runs found for bundle "${input.bundle}"` }),
    );
  }

  return repaired;
});
