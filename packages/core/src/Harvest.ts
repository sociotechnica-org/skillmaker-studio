/**
 * `fixture harvest` (issue #68, `Vision - Board Lab Ship Receive.md` §WHY:
 * "a skill that fails in production *is* a new fixture"): turns one
 * `skill.field_report` event into one hand-reviewed eval case — on a
 * skill.json bundle a `skill.json` case entry + `evals/cases/<case>/`
 * materials, on a legacy bundle the pre-merge `evals/fixtures/<case>/`
 * shape (THE MERGE write-side tranche; `SkillJsonWrite.
 * scaffoldCaseForBundle` is the one generation-aware door).
 * Mirrors `FieldReport.ts`'s core-function-plus-thin-CLI layering,
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
import { join } from "node:path";
import {
  HarvestCaseExistsError,
  HarvestEventNotFoundError,
  HarvestIntakeNotFoundError,
  HarvestNotFieldReportError,
  HarvestWrongBundleError,
  WorkspaceIOError,
} from "./Errors.ts";
import { type FixtureClass, type FixtureSourceRecord } from "./Fixtures.ts";
import { Journal } from "./JournalService.ts";
import { findReceivedEvent } from "./Receive.ts";
import { scaffoldCaseForBundle, type ScaffoldCaseInput } from "./SkillJsonWrite.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/**
 * The one scaffold call both harvest doors share (write-side tranche):
 * generation-aware via `scaffoldCaseForBundle` -- on a skill.json bundle
 * the case entry (with its `source` provenance) lands in `skill.json` and
 * the materials in `evals/cases/<name>/`; on a legacy bundle, today's
 * `evals/fixtures/<name>/case.json` shape, exactly as before. Maps the
 * directory collision onto `HarvestCaseExistsError` (same rule
 * `fixture add` enforces, its own door phrases it as a usage error).
 */
const scaffoldHarvestedCase = Effect.fn("Harvest.scaffoldHarvestedCase")(function* (
  bundle: string,
  bundleDir: string,
  input: ScaffoldCaseInput,
) {
  const outcome = yield* scaffoldCaseForBundle(bundleDir, input);
  if (outcome.kind === "case-dir-exists") {
    return yield* Effect.fail(HarvestCaseExistsError.make({ bundle, caseName: input.caseName }));
  }
  if (outcome.kind === "dangling-risks") {
    return yield* Effect.fail(
      WorkspaceIOError.make({
        message: `harvest named claim ids with no skill.json hypothesis: ${outcome.missing.join(", ")}`,
        cause: undefined,
      }),
    );
  }
  if (outcome.kind === "unusable-skill-json") {
    return yield* Effect.fail(
      WorkspaceIOError.make({
        message: `${join(bundleDir, "skill.json")} is not a usable JSON object; fix it before harvesting`,
        cause: undefined,
      }),
    );
  }
  return outcome;
});

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
  readonly source: Extract<FixtureSourceRecord, { readonly kind: "field-report" }>;
  /** Bundle-relative case directory the scaffold landed in (`evals/cases/<name>` on a skill.json bundle, `evals/fixtures/<name>` legacy). */
  readonly caseDirRel: string;
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

  const source: HarvestFixtureResult["source"] = {
    kind: "field-report",
    eventId: input.eventId,
    ...(event.payload.destination !== undefined ? { destination: event.payload.destination } : {}),
  };

  const scaffolded = yield* scaffoldHarvestedCase(input.bundle, input.bundleDir, {
    caseName: input.caseName,
    klass: input.klass,
    risks: [],
    promptText: `${event.payload.report}\n`,
    source,
  });

  const result: HarvestFixtureResult = {
    caseName: input.caseName,
    class: input.klass,
    source,
    caseDirRel: scaffolded.caseDirRel,
  };
  return result;
});

export interface HarvestFixtureFromIntakeInput {
  readonly bundle: string;
  /** `<workspaceRoot>/<skillsDir>/<slug>`. */
  readonly bundleDir: string;
  /** The new fixture's case name -- becomes the directory name. */
  readonly caseName: string;
  /** The `skill.received` event's intake id to harvest, `--from-intake`'s value. */
  readonly intake: string;
  readonly klass: FixtureClass;
}

export interface HarvestFixtureFromIntakeResult {
  readonly caseName: string;
  readonly class: FixtureClass;
  readonly source: Extract<FixtureSourceRecord, { readonly kind: "intake" }>;
  /** Bundle-relative case directory the scaffold landed in (`evals/cases/<name>` on a skill.json bundle, `evals/fixtures/<name>` legacy). */
  readonly caseDirRel: string;
}

/**
 * The dock's harvest door (issue #91, `Mechanism - Receiving Dock.md` §HOW,
 * salvage disposition): "diffs are mined into fixtures... the crate stays
 * at the dock, un-accessioned, retained as evidence." Mirrors
 * `harvestFixture` exactly (unknown intake id -> `HarvestIntakeNotFoundError`,
 * the same `HarvestCaseExistsError` collision guard, the same
 * `writeFixtureScaffold` write), but resolves a `skill.received` event by
 * `intake` id instead of a `skill.field_report` by event id, and stamps
 * `source: {kind: "intake", intake}` instead. No `HarvestWrongBundleError`-
 * equivalent guard: an intake crate carries no `bundle` at all (identity is
 * decided by routing, not by this read), so there is no bundle to disagree
 * with -- this deliberately never checks (nor requires) the crate's routing
 * state either, matching house law (no gate anywhere): harvesting from an
 * intake is a generically useful, ungated capability regardless of whether
 * -- or how -- that intake has been routed. `prompt.md` seeds the ordinary
 * empty-task-prompt skeleton (`writeFixtureScaffold`'s default): unlike a
 * field report's prose, a crate has no single "what happened" narrative to
 * seed it from -- the mining stays manual, as designed.
 */
export const harvestFixtureFromIntake = Effect.fn("Harvest.harvestFixtureFromIntake")(function* (
  input: HarvestFixtureFromIntakeInput,
) {
  const journal = yield* Journal;

  const events = yield* journal.readAll();
  const received = findReceivedEvent(events, input.intake);
  if (received === undefined) {
    return yield* Effect.fail(HarvestIntakeNotFoundError.make({ intake: input.intake }));
  }

  const source: HarvestFixtureFromIntakeResult["source"] = { kind: "intake", intake: input.intake };

  const scaffolded = yield* scaffoldHarvestedCase(input.bundle, input.bundleDir, {
    caseName: input.caseName,
    klass: input.klass,
    risks: [],
    source,
  });

  const result: HarvestFixtureFromIntakeResult = {
    caseName: input.caseName,
    class: input.klass,
    source,
    caseDirRel: scaffolded.caseDirRel,
  };
  return result;
});
