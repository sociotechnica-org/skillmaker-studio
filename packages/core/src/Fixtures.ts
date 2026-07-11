/**
 * Fixtures — `evals/fixtures/<case>/` (data-model.md §2.5, §2.11).
 *
 * PROMPT.MD CHANGE (director-ruled deviation from data-model.md §2.5): the
 * eval task prompt lives in a sibling `prompt.md` file (prose), NOT in
 * `case.json`'s `prompt` field. `case.json` keeps: schemaVersion, case,
 * class, risks[], setup? {files?, env?}, grading? {answerKey?, checks?[]}. A
 * `case.json` with a legacy `prompt` string field produces a warning
 * suggesting `prompt.md`, never a hard failure (Part 3 ruling I).
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

/** golden | refusal | empty | rerun | hard-case [inherited kit] (data-model.md §2.5). */
export const FIXTURE_CLASSES = ["golden", "refusal", "empty", "rerun", "hard-case"] as const;
export const FixtureClass = Schema.Literals(FIXTURE_CLASSES);
export type FixtureClass = typeof FixtureClass.Type;

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
}) {}

/** One scanned fixture case, tolerant of defects (data-model.md §2.11's `fixtures` table). */
export interface FixtureCaseRecord {
  readonly caseName: string;
  /** The raw `class` string as found on disk -- may be non-canonical; see the "unknown class" warning. */
  readonly class: string;
  readonly risks: ReadonlyArray<string>;
  /** Whether `prompt.md` exists next to `case.json` (PROMPT.MD CHANGE); the "prompt.md indicator" the Evals tab shows per fixture. */
  readonly hasPromptMd: boolean;
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

  for (const entry of entries) {
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
        `evals/fixtures/${entry}/case.json has unknown class "${klass}" (expected golden|refusal|empty|rerun|hard-case)`,
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

    cases.push({ caseName, class: klass ?? "unknown", risks, hasPromptMd: promptMdExists });
  }

  return { cases, warnings };
});
