/**
 * Field reports (issue #67, `Vision - Board Lab Ship Receive.md` §HOW): the
 * return half of the checkout/return-record primitive. Records what the wild
 * said back about a skill -- appends `skill.field_report` verbatim, no
 * board-state effect, no automation, no fixture creation (that's #68).
 * Mirrors `Ship.ts`'s core-function-plus-thin-CLI layering (`shipBundle`,
 * `publishBundle`, `recordSkillVersion` all live here in core with tagged
 * errors), but is deliberately lighter than shipping: no receipts snapshot,
 * no drift check.
 *
 * Unlike `ship`, an *unset* version is not an error -- the reporter may not
 * know which version they ran, and the event's `versionHash` is optional for
 * exactly that reason. A version *prefix* that matches nothing is an error
 * (`FieldReportVersionNotFoundError`): a wrong guess should be corrected, not
 * silently dropped.
 */
import { Effect } from "effect";
import type { Actor } from "./Actor.ts";
import { FieldReportVersionNotFoundError } from "./Errors.ts";
import type { FieldReportOutcome } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { foldSkillVersions, resolveSkillVersion } from "./Versions.ts";

export interface RecordFieldReportInput {
  readonly bundle: string;
  readonly outcome: FieldReportOutcome;
  /** The report prose, verbatim from the reporter. */
  readonly report: string;
  readonly actor: Actor;
  /** A recorded version's hash or hash-prefix, when the reporter knows it. */
  readonly versionHashPrefix?: string;
  /** Where the skill was running, when the reporter knows it. */
  readonly destination?: string;
}

export interface RecordFieldReportResult {
  readonly outcome: FieldReportOutcome;
  readonly report: string;
  readonly versionHash?: string;
  readonly destination?: string;
}

/**
 * Records a field report: resolves the version prefix when one is given
 * (same left-anchored semantics as `ship`, via `resolveSkillVersion`) and
 * appends `skill.field_report` -- no idempotency key, repeat reports are
 * genuine repeat signal.
 */
export const recordFieldReport = Effect.fn("FieldReport.recordFieldReport")(function* (
  input: RecordFieldReportInput,
) {
  const journal = yield* Journal;

  let versionHash: string | undefined;
  if (input.versionHashPrefix !== undefined) {
    const events = yield* journal.readAll();
    const versions = foldSkillVersions(events).get(input.bundle) ?? [];
    const match = resolveSkillVersion(versions, input.versionHashPrefix);
    if (match === undefined) {
      return yield* Effect.fail(
        FieldReportVersionNotFoundError.make({ bundle: input.bundle, prefix: input.versionHashPrefix }),
      );
    }
    versionHash = match.hash;
  }

  const payload = {
    bundle: input.bundle,
    outcome: input.outcome,
    report: input.report,
    ...(versionHash !== undefined ? { versionHash } : {}),
    ...(input.destination !== undefined ? { destination: input.destination } : {}),
  };

  yield* journal.append({ type: "skill.field_report", actor: input.actor, payload });

  const result: RecordFieldReportResult = {
    outcome: input.outcome,
    report: input.report,
    ...(versionHash !== undefined ? { versionHash } : {}),
    ...(input.destination !== undefined ? { destination: input.destination } : {}),
  };
  return result;
});
