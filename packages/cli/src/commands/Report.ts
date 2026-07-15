/**
 * `skillmaker report <slug> --outcome <worked|failed|surprise> --note <text>
 * [--version <hash-prefix>] [--from <destination>] [--json]` -- the inbound
 * half of the checkout/return-record primitive (issue #67, `Vision - Board
 * Lab Ship Receive.md` §HOW): "a dumb inbound channel. Even a manually
 * pasted field report proves the loop closes once, by hand, before
 * automating it." Appends `skill.field_report` verbatim -- no board-state
 * effect, no automation, no fixture creation (that's #68). Deliberately
 * lighter than `ship`: no receipts snapshot, no drift check.
 *
 * `--version`, when given, resolves through the same left-anchored-prefix
 * semantics `ship` uses, erroring only when it fails to match a recorded
 * version. Unlike `ship`, an *unset* `--version` is not an error -- the
 * reporter may not know which version they ran, and the event's
 * `versionHash` is optional for exactly that reason. The domain logic lives
 * in core (`recordFieldReport`), same layering as `shipBundle`; this command
 * is the thin argument/output wrapper.
 */
import {
  Actor,
  recordFieldReport,
  shortHash,
  JournalLayer,
  Workspace,
  type FieldReportOutcome,
  type RecordFieldReportResult,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

const OUTCOMES: ReadonlyArray<FieldReportOutcome> = ["worked", "failed", "surprise"];

const isOutcome = (value: string): value is FieldReportOutcome =>
  (OUTCOMES as ReadonlyArray<string>).includes(value);

export interface ReportOptions {
  readonly json: boolean;
  readonly outcome?: string;
  readonly note?: string;
  readonly version?: string;
  readonly from?: string;
}


export const runReport = Effect.fn("runReport")(function* (
  cwd: string,
  slug: string | undefined,
  options: ReportOptions,
) {
  const usage =
    "Usage: skillmaker report <slug> --outcome worked|failed|surprise --note <text> [--version <hash-prefix>] [--from <destination>]\n";

  if (slug === undefined) {
    return usageError(`skillmaker report: missing <slug>\n\n${usage}`);
  }
  if (options.outcome === undefined || options.outcome.length === 0) {
    return usageError(`skillmaker report: missing --outcome <worked|failed|surprise>\n\n${usage}`);
  }
  if (!isOutcome(options.outcome)) {
    return usageError(
      `skillmaker report: invalid --outcome "${options.outcome}" (expected one of ${OUTCOMES.join(", ")})\n\n${usage}`,
    );
  }
  if (options.note === undefined || options.note.trim().length === 0) {
    return usageError(`skillmaker report: missing --note <text>\n\n${usage}`);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker report: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker report: no such bundle "${slug}"\n`);
  }

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor: Actor = yield* resolveUserActor();
  const outcome: FieldReportOutcome = options.outcome;
  const destination = options.from !== undefined && options.from.trim().length > 0 ? options.from.trim() : undefined;

  const outcomeResult = yield* recordFieldReport({
    bundle: slug,
    outcome,
    report: options.note.trim(),
    actor,
    ...(options.version !== undefined ? { versionHashPrefix: options.version } : {}),
    ...(destination !== undefined ? { destination } : {}),
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("FieldReportVersionNotFoundError", (error) =>
      Effect.succeed({ kind: "version_not_found" as const, prefix: error.prefix }),
    ),
  );

  if (outcomeResult.kind === "version_not_found") {
    return expectedFailure(
      `skillmaker report: no recorded version of "${slug}" matches --version "${outcomeResult.prefix}"\n`,
    );
  }

  return summarize(slug, outcomeResult.result, options.json);
});

const summarize = (slug: string, summary: RecordFieldReportResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "reported",
        slug,
        outcome: summary.outcome,
        report: summary.report,
        versionHash: summary.versionHash ?? null,
        destination: summary.destination ?? null,
      })}\n`,
    );
  }

  const versionText = summary.versionHash !== undefined ? ` (version ${shortHash(summary.versionHash)})` : "";
  const fromText = summary.destination !== undefined ? ` from "${summary.destination}"` : "";
  return ok(`skillmaker: recorded field report for ${slug} — ${summary.outcome}${versionText}${fromText}\n`);
};
