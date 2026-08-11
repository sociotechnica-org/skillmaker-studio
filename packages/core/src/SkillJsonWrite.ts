/**
 * The write side of `skill.json` (THE MERGE write-side tranche, docs/
 * proposals/2026-08-11-the-merge-skill-json.md). Tranche 1 gave the merged
 * file a tolerant reader; this module gives it writers, so a skill.json
 * bundle's structured truth is EDITED where it lives instead of accreting
 * new legacy files:
 *
 * - `newSkillJsonDocument` -- the birth document `Workspace.createBundle`
 *   scaffolds (schemaVersion 2; new bundles are born migrated).
 * - `writeSkillJsonStageSync` -- the stage writer both transition doors
 *   (CLI `advance`, server `POST /api/events`) call: file = record, the
 *   journal `bundle.stage_changed` event = liveness notification (the
 *   grade-files pattern).
 * - `addCaseToSkillJson` -- `fixture add`/`fixture harvest`'s door on a
 *   skill.json bundle: appends the `evals.cases[]` entry and wires the
 *   hypothesis->case edges (`--risks` ids MUST already exist in
 *   `design.failureHypotheses` -- the write door enforces the join the old
 *   files never did).
 * - `addClaimToSkillJson` -- `claims add`'s door: appends a failure
 *   hypothesis (the eval-writer skill's future write path).
 * - `writeCaseMaterialsScaffold` -- `evals/cases/<name>/` materials
 *   (prompt.md, files/, expected.md -- the post-merge names).
 *
 * Every mutation here is a LOSSLESS raw-JSON merge (the
 * `InstallPublish.rememberInstallTargets` principle): the file is parsed as
 * plain JSON, only the fields being written are touched, and every other
 * field on disk -- known to the schema or not -- survives verbatim.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BundleStage } from "./Bundle.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { writeFixtureScaffold, type FixtureClass, type FixtureSourceRecord } from "./Fixtures.ts";
import { DEFAULT_EXPECTED_FILENAME, SKILL_JSON_FILENAME, SKILL_JSON_SCHEMA_VERSION } from "./SkillJson.ts";
import { isRecord } from "./TolerantJson.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** The one JSON renderer for every skill.json this module writes -- 2-space indent + trailing newline, matching the read-side examples. */
const renderSkillJson = (record: Record<string, unknown>): string => `${JSON.stringify(record, null, 2)}\n`;

// ---------------------------------------------------------------------------
// Birth document
// ---------------------------------------------------------------------------

export interface NewSkillJsonInput {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  /** ISO date (YYYY-MM-DD). */
  readonly created: string;
}

/**
 * The `skill.json` a fresh bundle is born with (write-side tranche item 1:
 * new bundles are born migrated -- no bundle.json, no stations.json). Stage
 * starts declared at `"idea"`; the empty `design`/`evals` sections make the
 * document's shape self-documenting for hand editors.
 */
export const newSkillJsonDocument = (input: NewSkillJsonInput): Record<string, unknown> => ({
  schemaVersion: SKILL_JSON_SCHEMA_VERSION,
  skill: {
    slug: input.slug,
    name: input.name,
    oneLiner: input.oneLiner,
    tags: [],
    created: input.created,
    harnesses: ["claude-code"],
    stage: "idea",
  },
  design: { failureHypotheses: [] },
  evals: { cases: [], configs: [] },
});

// ---------------------------------------------------------------------------
// The stage writer
// ---------------------------------------------------------------------------

export type WriteStageOutcome = "written" | "no-skill-json" | "unusable";

/**
 * Writes the declared stage into `skill.json`'s `skill.stage` -- the ONE
 * stage writer both transition doors call, BEFORE appending the journal
 * event (file = record, event = liveness; the grade-files ordering: the
 * event makes readers look, so the file must already say the truth when
 * they do). Lossless raw-JSON merge. On a legacy bundle (no skill.json) it
 * returns `"no-skill-json"` and the journal stays the record, exactly as
 * pre-merge -- the write side only follows migration, never forces it.
 */
export const writeSkillJsonStageSync = (bundleDir: string, stage: BundleStage): WriteStageOutcome => {
  const skillJsonPath = join(bundleDir, SKILL_JSON_FILENAME);
  if (!existsSync(skillJsonPath)) {
    return "no-skill-json";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(skillJsonPath, "utf8"));
  } catch {
    return "unusable";
  }
  if (!isRecord(parsed)) {
    return "unusable";
  }
  const skillRaw = parsed["skill"];
  const skill: Record<string, unknown> = isRecord(skillRaw) ? skillRaw : {};
  skill["stage"] = stage;
  parsed["skill"] = skill;
  writeFileSync(skillJsonPath, renderSkillJson(parsed));
  return "written";
};

// ---------------------------------------------------------------------------
// Case + claim appends
// ---------------------------------------------------------------------------

export interface AddCaseInput {
  readonly caseName: string;
  readonly klass: FixtureClass;
  /** Claim ids the case buys coverage for -- each MUST exist in `design.failureHypotheses` (the door refuses dangling ids). */
  readonly risks: ReadonlyArray<string>;
  /** Harvest provenance, stamped on the case entry (the old case.json `source`). */
  readonly source?: FixtureSourceRecord;
}

export type AddCaseResult =
  /** The case entry was appended to `evals.cases`. */
  | { readonly kind: "added" }
  /** `evals.cases` already listed the name (a planned case) -- the entry is kept untouched; the caller realizes it by writing materials. */
  | { readonly kind: "realized" }
  /** `--risks` named claim ids with no `design.failureHypotheses` entry. */
  | { readonly kind: "dangling-risks"; readonly missing: ReadonlyArray<string> }
  /** skill.json exists but is not a usable JSON object -- nothing was written. */
  | { readonly kind: "unusable" };

const hypothesisIdOf = (entry: unknown): string | undefined =>
  isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined;

/**
 * Appends one eval case to a skill.json bundle: the `evals.cases[]` entry
 * plus the hypothesis->case pointer on every claim named in `risks` (the
 * ONLY edge in the merged model -- there is no `risks[]` on the case).
 * Refuses dangling claim ids up front, before writing anything. When the
 * name is already listed (a planned case, i.e. an old proof spec), the
 * entry is kept as-is and only the requested edges are added -- realizing a
 * planned case is the designed order, not a collision.
 */
export const addCaseToSkillJson = Effect.fn("SkillJsonWrite.addCaseToSkillJson")(function* (
  bundleDir: string,
  input: AddCaseInput,
) {
  const fs = yield* FileSystem;
  const skillJsonPath = join(bundleDir, SKILL_JSON_FILENAME);
  const raw = yield* fs
    .readFileString(skillJsonPath)
    .pipe(Effect.mapError(toIOError(`could not read ${skillJsonPath}`)));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unusable" } as AddCaseResult;
  }
  if (!isRecord(parsed)) {
    return { kind: "unusable" } as AddCaseResult;
  }

  const designRaw = parsed["design"];
  const design: Record<string, unknown> = isRecord(designRaw) ? designRaw : {};
  const hypotheses: unknown[] = Array.isArray(design["failureHypotheses"])
    ? (design["failureHypotheses"] as unknown[])
    : [];

  const knownIds = new Set(hypotheses.map(hypothesisIdOf).filter((id): id is string => id !== undefined));
  const missing = input.risks.filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    return { kind: "dangling-risks", missing } as AddCaseResult;
  }

  const evalsRaw = parsed["evals"];
  const evals: Record<string, unknown> = isRecord(evalsRaw) ? evalsRaw : {};
  const cases: unknown[] = Array.isArray(evals["cases"]) ? (evals["cases"] as unknown[]) : [];

  const alreadyListed = cases.some(
    (entry) => isRecord(entry) && typeof entry.name === "string" && entry.name === input.caseName,
  );
  if (!alreadyListed) {
    cases.push({
      name: input.caseName,
      class: input.klass,
      ...(input.source !== undefined ? { source: input.source } : {}),
    });
  }

  // The one hypothesis->case edge: add the case name to every named claim's
  // `cases` pointer array (deduped; other claims untouched).
  for (const entry of hypotheses) {
    if (!isRecord(entry)) continue;
    const id = hypothesisIdOf(entry);
    if (id === undefined || !input.risks.includes(id)) continue;
    const pointers: unknown[] = Array.isArray(entry["cases"]) ? (entry["cases"] as unknown[]) : [];
    if (!pointers.includes(input.caseName)) {
      pointers.push(input.caseName);
    }
    entry["cases"] = pointers;
  }

  evals["cases"] = cases;
  parsed["evals"] = evals;
  design["failureHypotheses"] = hypotheses;
  parsed["design"] = design;

  yield* fs
    .writeFileString(skillJsonPath, renderSkillJson(parsed))
    .pipe(Effect.mapError(toIOError(`could not write ${skillJsonPath}`)));

  return { kind: alreadyListed ? "realized" : "added" } as AddCaseResult;
});

export interface AddClaimInput {
  readonly id: string;
  /** The observable failure sentence. */
  readonly failure: string;
  readonly probability?: string;
  readonly impact?: string;
  readonly mustNever?: string;
}

export type AddClaimResult =
  | { readonly kind: "added" }
  /** `design.failureHypotheses` already carries this id -- nothing written. */
  | { readonly kind: "exists" }
  | { readonly kind: "unusable" };

/**
 * Appends one failure hypothesis (a claim) to a skill.json bundle's
 * `design.failureHypotheses` -- `skillmaker claims add`'s writer, and the
 * future eval-writer skill's door. Born with an empty `cases: []` pointer
 * array: a claim starts as an HONEST gap and `fixture add --risks` wires
 * the edges as cases realize it.
 */
export const addClaimToSkillJson = Effect.fn("SkillJsonWrite.addClaimToSkillJson")(function* (
  bundleDir: string,
  input: AddClaimInput,
) {
  const fs = yield* FileSystem;
  const skillJsonPath = join(bundleDir, SKILL_JSON_FILENAME);
  const raw = yield* fs
    .readFileString(skillJsonPath)
    .pipe(Effect.mapError(toIOError(`could not read ${skillJsonPath}`)));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unusable" } as AddClaimResult;
  }
  if (!isRecord(parsed)) {
    return { kind: "unusable" } as AddClaimResult;
  }

  const designRaw = parsed["design"];
  const design: Record<string, unknown> = isRecord(designRaw) ? designRaw : {};
  const hypotheses: unknown[] = Array.isArray(design["failureHypotheses"])
    ? (design["failureHypotheses"] as unknown[])
    : [];

  if (hypotheses.some((entry) => hypothesisIdOf(entry) === input.id)) {
    return { kind: "exists" } as AddClaimResult;
  }

  hypotheses.push({
    id: input.id,
    failure: input.failure,
    ...(input.probability !== undefined ? { probability: input.probability } : {}),
    ...(input.impact !== undefined ? { impact: input.impact } : {}),
    ...(input.mustNever !== undefined ? { mustNever: input.mustNever } : {}),
    cases: [],
  });

  design["failureHypotheses"] = hypotheses;
  parsed["design"] = design;

  yield* fs
    .writeFileString(skillJsonPath, renderSkillJson(parsed))
    .pipe(Effect.mapError(toIOError(`could not write ${skillJsonPath}`)));

  return { kind: "added" } as AddClaimResult;
});

// ---------------------------------------------------------------------------
// Case materials (the post-merge scaffold)
// ---------------------------------------------------------------------------

const promptSkeleton = (caseName: string): string =>
  `<!-- The eval task prompt for "${caseName}" (prose, sent to the agent as-is). -->
`;

const expectedSkeleton = (caseName: string): string =>
  `# Expected — ${caseName}

<!-- Grading-only: never enters the agent's workspace [inherited]. -->
`;

export interface CaseMaterialsInput {
  /** `<bundleDir>/evals/cases/<name>`. */
  readonly caseDir: string;
  readonly caseName: string;
  /** Seeds `prompt.md` verbatim (`fixture harvest`: the field report's own prose); default is the empty-task-prompt skeleton. */
  readonly promptText?: string;
}

/**
 * Writes one `evals/cases/<name>/` materials directory: `prompt.md`,
 * `files/.gitkeep`, and `expected.md` (the post-merge name --
 * `expected/answer-key.md` is the legacy layout `Fixtures.
 * writeFixtureScaffold` still writes for pre-merge bundles). NO `case.json`:
 * on a skill.json bundle the case entry lives in `skill.json` itself
 * (`addCaseToSkillJson`). Callers guard directory collisions themselves.
 */
export const writeCaseMaterialsScaffold = Effect.fn("SkillJsonWrite.writeCaseMaterialsScaffold")(function* (
  input: CaseMaterialsInput,
) {
  const fs = yield* FileSystem;

  yield* fs
    .makeDirectory(join(input.caseDir, "files"), { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${join(input.caseDir, "files")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, "prompt.md"), input.promptText ?? promptSkeleton(input.caseName))
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "prompt.md")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, "files", ".gitkeep"), "")
    .pipe(Effect.mapError(toIOError(`could not write ${join(input.caseDir, "files", ".gitkeep")}`)));
  yield* fs
    .writeFileString(join(input.caseDir, DEFAULT_EXPECTED_FILENAME), expectedSkeleton(input.caseName))
    .pipe(
      Effect.mapError(toIOError(`could not write ${join(input.caseDir, DEFAULT_EXPECTED_FILENAME)}`)),
    );
});

// ---------------------------------------------------------------------------
// The one generation-aware case door
// ---------------------------------------------------------------------------

export interface ScaffoldCaseInput {
  readonly caseName: string;
  readonly klass: FixtureClass;
  /** Claim/risk ids -- on a skill.json bundle each must exist in `design.failureHypotheses`; on a legacy bundle they land in `case.json.risks` unvalidated (current behavior, kept exactly). */
  readonly risks: ReadonlyArray<string>;
  /** Seeds `prompt.md` verbatim (harvest); default is the skeleton. */
  readonly promptText?: string;
  /** Harvest provenance. */
  readonly source?: FixtureSourceRecord;
}

export type ScaffoldCaseOutcome =
  | {
      readonly kind: "created" | "realized";
      /** Which write generation answered -- `"skill-json"` (case entry in skill.json + `evals/cases/` materials) or `"legacy"` (`evals/fixtures/<name>/case.json`). */
      readonly generation: "skill-json" | "legacy";
      /** Bundle-relative case directory, e.g. `evals/cases/<name>`. */
      readonly caseDirRel: string;
    }
  | { readonly kind: "case-dir-exists"; readonly caseDirRel: string }
  | { readonly kind: "dangling-risks"; readonly missing: ReadonlyArray<string> }
  | { readonly kind: "unusable-skill-json" };

/**
 * THE case-scaffolding door both `fixture add` and `fixture harvest` write
 * through (write-side tranche item 2). On a skill.json bundle it appends
 * the `evals.cases[]` entry (+ hypothesis->case edges for `risks`) and
 * writes `evals/cases/<name>/` materials (prompt.md, files/, expected.md);
 * on a legacy bundle it keeps today's behavior exactly
 * (`Fixtures.writeFixtureScaffold` -> `evals/fixtures/<name>/` with
 * case.json). The write side follows migration, never forces it.
 */
export const scaffoldCaseForBundle = Effect.fn("SkillJsonWrite.scaffoldCaseForBundle")(function* (
  bundleDir: string,
  input: ScaffoldCaseInput,
) {
  const fs = yield* FileSystem;
  const hasSkillJson = yield* fs
    .exists(join(bundleDir, SKILL_JSON_FILENAME))
    .pipe(Effect.mapError(toIOError(`could not check ${join(bundleDir, SKILL_JSON_FILENAME)}`)));

  if (!hasSkillJson) {
    const caseDirRel = join("evals", "fixtures", input.caseName);
    const caseDir = join(bundleDir, caseDirRel);
    const caseDirExists = yield* fs
      .exists(caseDir)
      .pipe(Effect.mapError(toIOError(`could not check ${caseDir}`)));
    if (caseDirExists) {
      return { kind: "case-dir-exists", caseDirRel } as ScaffoldCaseOutcome;
    }
    yield* writeFixtureScaffold({
      caseDir,
      caseName: input.caseName,
      class: input.klass,
      risks: input.risks,
      ...(input.promptText !== undefined ? { promptText: input.promptText } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
    });
    return { kind: "created", generation: "legacy", caseDirRel } as ScaffoldCaseOutcome;
  }

  const caseDirRel = join("evals", "cases", input.caseName);
  const caseDir = join(bundleDir, caseDirRel);
  const caseDirExists = yield* fs
    .exists(caseDir)
    .pipe(Effect.mapError(toIOError(`could not check ${caseDir}`)));
  if (caseDirExists) {
    return { kind: "case-dir-exists", caseDirRel } as ScaffoldCaseOutcome;
  }

  // skill.json first (dangling-risk refusal happens BEFORE any file
  // lands), then the materials that realize the entry.
  const appended = yield* addCaseToSkillJson(bundleDir, {
    caseName: input.caseName,
    klass: input.klass,
    risks: input.risks,
    ...(input.source !== undefined ? { source: input.source } : {}),
  });
  if (appended.kind === "dangling-risks") {
    return { kind: "dangling-risks", missing: appended.missing } as ScaffoldCaseOutcome;
  }
  if (appended.kind === "unusable") {
    return { kind: "unusable-skill-json" } as ScaffoldCaseOutcome;
  }

  yield* writeCaseMaterialsScaffold({
    caseDir,
    caseName: input.caseName,
    ...(input.promptText !== undefined ? { promptText: input.promptText } : {}),
  });

  return {
    kind: appended.kind === "realized" ? "realized" : "created",
    generation: "skill-json",
    caseDirRel,
  } as ScaffoldCaseOutcome;
});
