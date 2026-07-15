/**
 * `fixture harvest` (issue #68, `Vision - Board Lab Ship Receive.md` §WHY:
 * "a skill that fails in production *is* a new fixture"): turns one
 * `skill.field_report` event into one hand-reviewed `evals/fixtures/<case>/`
 * directory. Mirrors `FieldReport.ts`'s core-function-plus-thin-CLI layering,
 * but is the *files* side of that pair -- fixtures stay files, not events
 * (`FixtureAdd.ts`'s rule), so harvesting never touches the journal beyond
 * reading it to find the named report.
 *
 * Deliberately no grading inference from report text and no automation: the
 * human names the case, picks the class, and fills in `risks`/`grading`
 * afterward, same as `fixture add`. `prompt.md` is seeded verbatim from the
 * report's `report` prose -- the wild's own words, not a paraphrase.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import {
  HarvestCaseExistsError,
  HarvestEventNotFoundError,
  HarvestNotFieldReportError,
  HarvestWrongBundleError,
  WorkspaceIOError,
} from "./Errors.ts";
import { type FixtureClass, type FixtureSourceRecord, writeFixtureScaffold } from "./Fixtures.ts";
import { Journal } from "./JournalService.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

export interface HarvestFixtureInput {
  readonly bundle: string;
  /** `<workspaceRoot>/<skillsDir>/<slug>`. */
  readonly bundleDir: string;
  /** The new fixture's case name -- becomes the directory name. */
  readonly caseName: string;
  /** The `skill.field_report` event id to harvest, `--from-report`'s value. */
  readonly eventId: string;
  readonly klass: FixtureClass;
}

export interface HarvestFixtureResult {
  readonly caseName: string;
  readonly class: FixtureClass;
  readonly source: FixtureSourceRecord;
}

/**
 * Resolves `eventId` against the full journal (unknown id ->
 * `HarvestEventNotFoundError`; not a `skill.field_report` ->
 * `HarvestNotFieldReportError`; a report for a different bundle ->
 * `HarvestWrongBundleError`), guards the case-directory collision
 * (`HarvestCaseExistsError`, same rule `fixture add` enforces), then writes
 * the scaffold via `writeFixtureScaffold` with `prompt.md` seeded from the
 * report's prose and `case.json` stamped with `source: {kind: "field-
 * report", eventId, destination?}`. `risks` starts empty -- coverage is a
 * human call, same as `fixture add`.
 */
export const harvestFixture = Effect.fn("Harvest.harvestFixture")(function* (input: HarvestFixtureInput) {
  const journal = yield* Journal;
  const fs = yield* FileSystem;

  const events = yield* journal.readAll();
  const event = events.find((candidate) => candidate.id === input.eventId);
  if (event === undefined) {
    return yield* Effect.fail(HarvestEventNotFoundError.make({ eventId: input.eventId }));
  }
  if (event.type !== "skill.field_report") {
    return yield* Effect.fail(
      HarvestNotFieldReportError.make({ eventId: input.eventId, eventType: event.type }),
    );
  }
  if (event.payload.bundle !== input.bundle) {
    return yield* Effect.fail(
      HarvestWrongBundleError.make({
        eventId: input.eventId,
        bundle: input.bundle,
        reportBundle: event.payload.bundle,
      }),
    );
  }

  const caseDir = join(input.bundleDir, "evals", "fixtures", input.caseName);
  const caseDirExists = yield* fs
    .exists(caseDir)
    .pipe(Effect.mapError(toIOError(`could not check ${caseDir}`)));
  if (caseDirExists) {
    return yield* Effect.fail(HarvestCaseExistsError.make({ bundle: input.bundle, caseName: input.caseName }));
  }

  const source: FixtureSourceRecord = {
    kind: "field-report",
    eventId: input.eventId,
    ...(event.payload.destination !== undefined ? { destination: event.payload.destination } : {}),
  };

  yield* writeFixtureScaffold({
    caseDir,
    caseName: input.caseName,
    class: input.klass,
    risks: [],
    promptText: `${event.payload.report}\n`,
    source,
  });

  const result: HarvestFixtureResult = {
    caseName: input.caseName,
    class: input.klass,
    source,
  };
  return result;
});
