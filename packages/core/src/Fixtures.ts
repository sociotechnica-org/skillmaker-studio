/**
 * Fixtures — `evals/fixtures/<case>/` (data-model.md §2.5, §2.11).
 *
 * PROMPT.MD CHANGE (director-ruled deviation from data-model.md §2.5): the
 * eval task prompt lives in a sibling `prompt.md` file (prose), NOT in
 * `case.json`'s `prompt` field. `case.json` keeps: schemaVersion, case,
 * class, risks[], setup? {files?, env?}, grading? {answerKey?, checks?[]},
 * source? {kind, eventId, destination?}. A `case.json` with a legacy `prompt`
 * string field produces a warning suggesting `prompt.md`, never a hard
 * failure (Part 3 ruling I). `source` (issue #68) is optional provenance
 * `fixture harvest` stamps on a fixture pulled from a field report -- absent
 * on every hand-scaffolded (`fixture add`) case, so every pre-existing
 * `case.json` keeps validating unchanged.
 *
 * `scanFixtures` is deliberately NOT a strict `Schema.decodeUnknownEffect`
 * over `FixtureCase` the way `IndexService.scanBundleIdentities` decodes
 * `BundleIdentity`: several of its own defects (unknown class, unbanded risk
 * id, legacy prompt field) must be tolerated and reported as warnings rather
 * than dropping the whole fixture, so this reads fields defensively by hand.
 * `FixtureCase` (the schema class) still exists as the documented shape for
 * anything that DOES want a strict decode (e.g. a future `fixture add`
 * validator), and both agree on file layout.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { WorkspaceIOError } from "./Errors.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/**
 * golden | refusal | empty | rerun | hard-case [inherited kit] | trigger
 * (data-model.md §2.5; `trigger` added Phase 12, plan.md's trigger-rate
 * fold-in #2). A `trigger` fixture's `prompt.md` deliberately does NOT name
 * the skill by slug -- grading asks "did the skill activate on its own?"
 * (i.e. does the run's transcript contain a `Skill` tool_call for the
 * bundle), not "did the agent do the task correctly." `didSkillActivate`
 * below is the grading primitive; full trigger-rate aggregation across
 * fixtures is out of scope for this fold-in (measurements already work
 * per-fixture).
 */
export const FIXTURE_CLASSES = ["golden", "refusal", "empty", "rerun", "hard-case", "trigger"] as const;
export const FixtureClass = Schema.Literals(FIXTURE_CLASSES);
export type FixtureClass = typeof FixtureClass.Type;

/** Type guard for `class` values arriving as raw strings (CLI `--class`, scanned `case.json`). */
export const isFixtureClass = (value: string): value is FixtureClass =>
  (FIXTURE_CLASSES as ReadonlyArray<string>).includes(value);

/** The five inherited risk families a risk id must band into (data-model.md §2.6). */
export const RISK_FAMILIES = ["IN", "RE", "OUT", "ADV", "CHN"] as const;
export type RiskFamily = (typeof RISK_FAMILIES)[number];

/** The family prefix of a risk id, e.g. `"IN-2"` -> `"IN"`. Not validated against `RISK_FAMILIES` -- callers check membership themselves. */
export const riskFamily = (riskId: string): string => {
  const dash = riskId.indexOf("-");
  return dash === -1 ? riskId : riskId.slice(0, dash);
};

export const isKnownRiskFamily = (family: string): family is RiskFamily =>
  (RISK_FAMILIES as ReadonlyArray<string>).includes(family);

export class FixtureSetup extends Schema.Class<FixtureSetup>("FixtureSetup")({
  /** Copied into the run workspace, relative to the case directory. */
  files: Schema.optionalKey(Schema.String),
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}) {}

export class FixtureGrading extends Schema.Class<FixtureGrading>("FixtureGrading")({
  /** Grading-only; never enters the agent's workspace [inherited]. */
  answerKey: Schema.optionalKey(Schema.String),
  /** Rendered as a checklist in the read-out UI. */
  checks: Schema.optionalKey(Schema.Array(Schema.String)),
}) {}

/**
 * `case.json`'s optional provenance (issue #68, `fixture harvest`): which
 * `skill.field_report` event this fixture was harvested from. Optional at
 * every level so every `case.json` written before harvest existed still
 * validates.
 */
export class FixtureSourceFieldReport extends Schema.Class<FixtureSourceFieldReport>(
  "FixtureSourceFieldReport",
)({
  kind: Schema.Literal("field-report"),
  /** The harvested `skill.field_report` event's id. */
  eventId: Schema.String,
  /** The report's `destination`, when the reporter gave one. */
  destination: Schema.optionalKey(Schema.String),
}) {}

/**
 * `case.json`'s other provenance kind (issue #91, `Mechanism - Receiving
 * Dock.md`): a fixture mined from a salvaged crate at the dock --
 * "salvage: no identity granted; diffs are mined into fixtures... the crate
 * stays at the dock, un-accessioned, retained as evidence." References the
 * `skill.received` event's `intake` id (an `in-<uuid>`), not a bundle -- the
 * crate never got one.
 */
export class FixtureSourceIntake extends Schema.Class<FixtureSourceIntake>("FixtureSourceIntake")({
  kind: Schema.Literal("intake"),
  /** The `skill.received` event's `intake` id the fixture was harvested from. */
  intake: Schema.String,
}) {}

/**
 * `case.json`'s optional provenance (issue #68's `field-report`, issue
 * #91's `intake`): a discriminated union, not a single shape with an
 * optional/generic ref field, because the two kinds key on genuinely
 * different things (a journal event id vs. an intake id) -- `field-report`'s
 * existing `eventId` field name is load-bearing (already-committed
 * `case.json` files use it) and stays untouched; `intake` is purely
 * additive.
 */
export const FixtureSource = Schema.Union([FixtureSourceFieldReport, FixtureSourceIntake]);
export type FixtureSource = typeof FixtureSource.Type;

/**
 * The plain-object form of `FixtureSource` -- the ONE shape every record
 * carrying fixture provenance references (`FixtureCaseRecord`,
 * `FixtureScaffoldInput`, `IndexService`'s `FixtureRecord`, harvest's
 * result), so a future provenance kind lands in one place instead of
 * structurally-compatible hand copies that can silently drift.
 */
export type FixtureSourceRecord =
  | { readonly kind: "field-report"; readonly eventId: string; readonly destination?: string }
  | { readonly kind: "intake"; readonly intake: string };

/**
 * The documented `case.json` shape (data-model.md §2.5, PROMPT.MD CHANGE).
 * `prompt` is a legacy field, kept here ONLY so a strict decode can still
 * recognize and report it -- the current model has no `prompt` field, the
 * task prompt lives in the sibling `prompt.md`.
 */
export class FixtureCase extends Schema.Class<FixtureCase>("FixtureCase")({
  schemaVersion: Schema.Literal(1),
  /** Equals the directory name. */
  case: Schema.String,
  class: FixtureClass,
  /** Risk-map ids this case buys coverage for. */
  risks: Schema.Array(Schema.String),
  setup: Schema.optionalKey(FixtureSetup),
  grading: Schema.optionalKey(FixtureGrading),
  /** Legacy scaffold-era field; tolerated, never required. */
  prompt: Schema.optionalKey(Schema.String),
  /** Set by `fixture harvest`; absent on every hand-scaffolded (`fixture add`) case. */
  source: Schema.optionalKey(FixtureSource),
}) {}

/** One scanned fixture case, tolerant of defects (data-model.md §2.11's `fixtures` table). */
export interface FixtureCaseRecord {
  readonly caseName: string;
  /** The raw `class` string as found on disk -- may be non-canonical; see the "unknown class" warning. */
  readonly class: string;
  readonly risks: ReadonlyArray<string>;
  /** Whether `prompt.md` exists next to `case.json` (PROMPT.MD CHANGE); the "prompt.md indicator" the Evals tab shows per fixture. */
  readonly hasPromptMd: boolean;
  /** Present only for a harvested fixture (issue #68); absent for a hand-scaffolded one. */
  readonly source?: FixtureSourceRecord;
}

export interface ScanFixturesResult {
  readonly cases: ReadonlyArray<FixtureCaseRecord>;
  readonly warnings: ReadonlyArray<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Scans `evals/fixtures/*\/case.json` under a bundle directory, tolerating
 * and reporting malformed content as warnings rather than failing (Part 3
 * ruling I). `bundleDir` is `skills/<slug>/` (or wherever `config.skillsDir`
 * points) -- the caller (IndexService) already knows the bundle's slug and
 * attaches it when persisting.
 */
export const scanFixtures = Effect.fn("Fixtures.scanFixtures")(function* (bundleDir: string) {
  const fs = yield* FileSystem;
  const cases: FixtureCaseRecord[] = [];
  const warnings: string[] = [];

  const fixturesDir = join(bundleDir, "evals", "fixtures");
  const fixturesDirExists = yield* fs
    .exists(fixturesDir)
    .pipe(Effect.mapError(toIOError(`could not check ${fixturesDir}`)));
  if (!fixturesDirExists) {
    return { cases, warnings };
  }

  const entries = yield* fs
    .readDirectory(fixturesDir)
    .pipe(Effect.mapError(toIOError(`could not list ${fixturesDir}`)));

  // Raw readdir order is OS-dependent (ext4 hash order vs APFS alphabetical);
  // consumers rely on scan order being stable -- e.g. the server attributes a
  // field report to the FIRST fixture whose source.eventId matches.
  for (const entry of entries.slice().sort()) {
    const caseDir = join(fixturesDir, entry);
    const info = yield* fs.stat(caseDir).pipe(Effect.mapError(toIOError(`could not stat ${caseDir}`)));
    if (info.type !== "Directory") {
      continue;
    }

    const caseJsonPath = join(caseDir, "case.json");
    const caseJsonExists = yield* fs
      .exists(caseJsonPath)
      .pipe(Effect.mapError(toIOError(`could not check ${caseJsonPath}`)));
    if (!caseJsonExists) {
      warnings.push(`evals/fixtures/${entry}/case.json is missing`);
      continue;
    }

    const raw = yield* fs
      .readFileString(caseJsonPath)
      .pipe(Effect.mapError(toIOError(`could not read ${caseJsonPath}`)));
    const parseOutcome = yield* Effect.result(
      Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (cause) => cause }),
    );
    if (parseOutcome._tag === "Failure") {
      warnings.push(
        `evals/fixtures/${entry}/case.json is malformed JSON and was skipped: ${String(parseOutcome.failure)}`,
      );
      continue;
    }
    const parsed = parseOutcome.success;
    if (!isRecord(parsed)) {
      warnings.push(`evals/fixtures/${entry}/case.json must be a JSON object and was skipped`);
      continue;
    }

    const caseName = typeof parsed.case === "string" ? parsed.case : undefined;
    if (caseName === undefined) {
      warnings.push(`evals/fixtures/${entry}/case.json is missing required field "case" and was skipped`);
      continue;
    }
    if (caseName !== entry) {
      warnings.push(
        `evals/fixtures/${entry}/case.json: "case" field ("${caseName}") does not match its directory name ("${entry}")`,
      );
    }

    const klass = typeof parsed.class === "string" ? parsed.class : undefined;
    if (klass === undefined) {
      warnings.push(`evals/fixtures/${entry}/case.json is missing required field "class"`);
    } else if (!(FIXTURE_CLASSES as ReadonlyArray<string>).includes(klass)) {
      warnings.push(
        `evals/fixtures/${entry}/case.json has unknown class "${klass}" (expected golden|refusal|empty|rerun|hard-case|trigger)`,
      );
    }

    const risksRaw = parsed.risks;
    const risks: string[] = Array.isArray(risksRaw)
      ? risksRaw.filter((risk): risk is string => typeof risk === "string")
      : [];
    for (const riskId of risks) {
      const family = riskFamily(riskId);
      if (!isKnownRiskFamily(family)) {
        warnings.push(
          `evals/fixtures/${entry}/case.json: risk id "${riskId}" does not band into a known family (expected IN|RE|OUT|ADV|CHN prefix)`,
        );
      }
    }

    if (typeof parsed.prompt === "string") {
      warnings.push(
        `evals/fixtures/${entry}/case.json has a legacy "prompt" field; move the task prompt to evals/fixtures/${entry}/prompt.md instead`,
      );
    }

    // `source` (issue #68's `field-report`, issue #91's `intake`):
    // tolerantly read, same as every other field here -- a valid shape for
    // either kind is captured silently (no warning, it's expected on a
    // harvested fixture), a present-but-malformed shape is reported and
    // dropped, and an absent `source` (every hand-scaffolded fixture) is
    // silently fine.
    const sourceRaw = parsed.source;
    let source: FixtureCaseRecord["source"];
    if (sourceRaw !== undefined) {
      if (isRecord(sourceRaw) && sourceRaw.kind === "field-report" && typeof sourceRaw.eventId === "string") {
        source = {
          kind: "field-report",
          eventId: sourceRaw.eventId,
          ...(typeof sourceRaw.destination === "string" ? { destination: sourceRaw.destination } : {}),
        };
      } else if (isRecord(sourceRaw) && sourceRaw.kind === "intake" && typeof sourceRaw.intake === "string") {
        source = { kind: "intake", intake: sourceRaw.intake };
      } else {
        warnings.push(
          `evals/fixtures/${entry}/case.json has a malformed "source" field (expected {kind: "field-report", eventId: string} or {kind: "intake", intake: string})`,
        );
      }
    }

    const promptMdPath = join(caseDir, "prompt.md");
    const promptMdExists = yield* fs
      .exists(promptMdPath)
      .pipe(Effect.mapError(toIOError(`could not check ${promptMdPath}`)));
    if (!promptMdExists) {
      warnings.push(`evals/fixtures/${entry}/prompt.md is missing`);
    }

    const grading = parsed.grading;
    if (isRecord(grading) && typeof grading.answerKey === "string") {
      const answerKeyPath = join(caseDir, grading.answerKey);
      const answerKeyExists = yield* fs
        .exists(answerKeyPath)
        .pipe(Effect.mapError(toIOError(`could not check ${answerKeyPath}`)));
      if (!answerKeyExists) {
        warnings.push(
          `evals/fixtures/${entry}/case.json: grading.answerKey "${grading.answerKey}" does not exist`,
        );
      }
    }

    cases.push({
      caseName,
      class: klass ?? "unknown",
      risks,
      hasPromptMd: promptMdExists,
      ...(source !== undefined ? { source } : {}),
    });
  }

  return { cases, warnings };
});

const promptSkeleton = (caseName: string): string =>
  `<!-- The eval task prompt for "${caseName}" (prose, sent to the agent as-is). -->
`;

const answerKeySkeleton = (caseName: string): string =>
  `# Answer key — ${caseName}

<!-- Grading-only: never enters the agent's workspace [inherited]. -->
`;

export interface FixtureScaffoldInput {
  /** `<bundleDir>/evals/fixtures/<case>`. */
  readonly caseDir: string;
  /** Equals the directory name (`case.json`'s `case` field). */
  readonly caseName: string;
  readonly class: FixtureClass;
  readonly risks: ReadonlyArray<string>;
  /** Seeds `prompt.md` verbatim instead of the empty-task-prompt skeleton comment (`fixture harvest`, issue #68: seeded from a field report's `report` text). */
  readonly promptText?: string;
  /** Provenance to stamp onto `case.json` (`fixture harvest`, issue #68); absent for a hand-scaffolded `fixture add` case. */
  readonly source?: FixtureSourceRecord;
}

/**
 * Writes one `evals/fixtures/<case>/` directory: `case.json`, `prompt.md`
 * (the PROMPT.MD CHANGE), `files/.gitkeep`, `expected/answer-key.md`
 * skeleton -- the scaffolding both `fixture add` (`FixtureAdd.ts`) and
 * `fixture harvest` (`Harvest.ts`, issue #68) write, factored out here so
 * harvesting isn't a copy-paste of add's file-writing. Does not check
 * whether `caseDir` already exists -- callers guard that themselves (`fixture
 * add`'s "already exists" check, `fixture harvest`'s `HarvestCaseExistsError`)
 * since what to do about a collision differs (a usage error vs. a tagged
 * domain error). Fixtures are files, not events -- writes here never touch
 * the journal.
 */
export const writeFixtureScaffold = Effect.fn("Fixtures.writeFixtureScaffold")(function* (
  input: FixtureScaffoldInput,
) {
  const fs = yield* FileSystem;

  yield* fs
    .makeDirectory(join(input.caseDir, "files"), { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${join(input.caseDir, "files")}`)));
  yield* fs
    .makeDirectory(join(input.caseDir, "expected"), { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${join(input.caseDir, "expected")}`)));

  yield* fs
    .writeFileString(
      join(input.caseDir, "case.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          case: input.caseName,
          class: input.class,
          risks: input.risks,
          ...(input.source !== undefined ? { source: input.source } : {}),
        },
        null,
        2,
      )}\n`,
    )
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "case.json")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, "prompt.md"), input.promptText ?? promptSkeleton(input.caseName))
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "prompt.md")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, "files", ".gitkeep"), "")
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "files", ".gitkeep")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, "expected", "answer-key.md"), answerKeySkeleton(input.caseName))
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "expected", "answer-key.md")}`)));
});
