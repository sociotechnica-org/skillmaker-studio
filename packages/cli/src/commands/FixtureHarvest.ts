/**
 * `skillmaker fixture harvest <slug> <case> (--from-report <event-id> |
 * --from-intake <intake-id>) [--class <class>] [--json]` -- closes the
 * field-report loop (issue #68, `Vision - Board Lab Ship Receive.md` §WHY:
 * "a skill that fails in production *is* a new fixture") and the dock's
 * salvage door (issue #91, `Mechanism - Receiving Dock.md` §HOW: "diffs are
 * mined into fixtures"). Thin argument/output wrapper around core's
 * `harvestFixture`/`harvestFixtureFromIntake` (`Harvest.ts`), same layering
 * `report`/`ship` use: this command only parses argv, resolves the
 * workspace, and maps the tagged errors to honest CLI failures. Default
 * fixture class `hard-case` (the wild's specialty) -- `--class` overrides to
 * any of `FIXTURE_CLASSES`. Fixtures stay files, not events -- harvest never
 * appends to the journal (`FixtureAdd.ts`'s rule, unchanged); the journal is
 * only read, to resolve `--from-report`/`--from-intake`.
 */
import {
  FIXTURE_CLASSES,
  harvestFixture,
  harvestFixtureFromIntake,
  isFixtureClass,
  JournalLayer,
  Workspace,
  type HarvestFixtureFromIntakeResult,
  type HarvestFixtureResult,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface FixtureHarvestOptions {
  readonly json: boolean;
  readonly klass?: string;
  readonly fromReport?: string;
  readonly fromIntake?: string;
}

export const runFixtureHarvest = Effect.fn("runFixtureHarvest")(function* (
  cwd: string,
  slug: string | undefined,
  caseName: string | undefined,
  options: FixtureHarvestOptions,
) {
  const usage = `Usage: skillmaker fixture harvest <slug> <case> (--from-report <event-id> | --from-intake <intake-id>) [--class ${FIXTURE_CLASSES.join("|")}]\n`;

  if (slug === undefined || caseName === undefined) {
    return usageError(`skillmaker fixture harvest: missing <slug> <case>\n\n${usage}`);
  }
  const fromReport = options.fromReport !== undefined && options.fromReport.trim().length > 0 ? options.fromReport.trim() : undefined;
  const fromIntake = options.fromIntake !== undefined && options.fromIntake.trim().length > 0 ? options.fromIntake.trim() : undefined;
  if (fromReport === undefined && fromIntake === undefined) {
    return usageError(`skillmaker fixture harvest: missing --from-report <event-id> or --from-intake <intake-id>\n\n${usage}`);
  }
  if (fromReport !== undefined && fromIntake !== undefined) {
    return usageError(`skillmaker fixture harvest: pass either --from-report or --from-intake, not both\n\n${usage}`);
  }

  const klass = options.klass ?? "hard-case";
  if (!isFixtureClass(klass)) {
    return usageError(
      `skillmaker fixture harvest: invalid --class "${klass}" (expected ${FIXTURE_CLASSES.join("|")})\n`,
    );
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker fixture harvest: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker fixture harvest: no such bundle "${slug}"\n`);
  }

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");

  if (fromIntake !== undefined) {
    const outcome = yield* harvestFixtureFromIntake({
      bundle: slug,
      bundleDir,
      caseName,
      intake: fromIntake,
      klass,
    }).pipe(
      Effect.provide(JournalLayer(journalPath)),
      Effect.map((result) => ({ kind: "ok" as const, result })),
      Effect.catchTag("HarvestIntakeNotFoundError", (error) =>
        Effect.succeed({ kind: "intake_not_found" as const, intake: error.intake }),
      ),
      Effect.catchTag("HarvestCaseExistsError", () => Effect.succeed({ kind: "case_exists" as const })),
    );

    if (outcome.kind === "intake_not_found") {
      return expectedFailure(`skillmaker fixture harvest: no such intake "${outcome.intake}"\n`);
    }
    if (outcome.kind === "case_exists") {
      return expectedFailure(`skillmaker fixture harvest: evals/fixtures/${caseName}/ already exists for "${slug}"\n`);
    }

    return summarizeFromIntake(slug, outcome.result, options.json);
  }

  // `fromReport !== undefined` -- the earlier guard already ruled out both being undefined or both being set.
  const eventId = fromReport as string;

  const outcome = yield* harvestFixture({
    bundle: slug,
    bundleDir,
    caseName,
    eventId,
    klass,
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("HarvestEventNotFoundError", (error) =>
      Effect.succeed({ kind: "event_not_found" as const, eventId: error.eventId }),
    ),
    Effect.catchTag("HarvestNotFieldReportError", (error) =>
      Effect.succeed({
        kind: "not_field_report" as const,
        eventId: error.eventId,
        eventType: error.eventType,
      }),
    ),
    Effect.catchTag("HarvestWrongBundleError", (error) =>
      Effect.succeed({
        kind: "wrong_bundle" as const,
        eventId: error.eventId,
        reportBundle: error.reportBundle,
      }),
    ),
    Effect.catchTag("HarvestCaseExistsError", () => Effect.succeed({ kind: "case_exists" as const })),
  );

  if (outcome.kind === "event_not_found") {
    return expectedFailure(`skillmaker fixture harvest: no such event "${outcome.eventId}"\n`);
  }
  if (outcome.kind === "not_field_report") {
    return expectedFailure(
      `skillmaker fixture harvest: event "${outcome.eventId}" is a "${outcome.eventType}" event, not a skill.field_report\n`,
    );
  }
  if (outcome.kind === "wrong_bundle") {
    return expectedFailure(
      `skillmaker fixture harvest: event "${outcome.eventId}" is a field report for "${outcome.reportBundle}", not "${slug}"\n`,
    );
  }
  if (outcome.kind === "case_exists") {
    return expectedFailure(`skillmaker fixture harvest: evals/fixtures/${caseName}/ already exists for "${slug}"\n`);
  }

  return summarize(slug, outcome.result, options.json);
});

const summarize = (slug: string, result: HarvestFixtureResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "harvested",
        bundle: slug,
        case: result.caseName,
        class: result.class,
        source: result.source,
      })}\n`,
    );
  }
  return ok(
    `skillmaker: harvested field report ${result.source.eventId} into ${slug}/evals/fixtures/${result.caseName}/ (class: ${result.class})\n`,
  );
};

const summarizeFromIntake = (slug: string, result: HarvestFixtureFromIntakeResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "harvested",
        bundle: slug,
        case: result.caseName,
        class: result.class,
        source: result.source,
      })}\n`,
    );
  }
  return ok(
    `skillmaker: harvested intake ${result.source.intake} into ${slug}/evals/fixtures/${result.caseName}/ (class: ${result.class})\n`,
  );
};
