/**
 * Bundle-root `skill.json` — schemaVersion 2, THE MERGE (docs/proposals/
 * 2026-08-11-the-merge-skill-json.md + director rulings 2026-08-11). One
 * file absorbs the pre-merge structured stores:
 *
 * ```jsonc
 * {
 *   "schemaVersion": 2,
 *   "skill":   { "slug", "name", "oneLiner", "tags", "created",
 *                "harnesses": ["claude-code"],   // renamed from bundle.json "targets"
 *                "stage": "evaluating" },        // declared stage (see SkillJsonSkill.stage)
 *   "design":  { "failureHypotheses": [
 *     { "id": "IN-1", "failure": "...", "mustNever?": "...",
 *       "probability?": "High", "impact?": "Medium",
 *       "cases": ["refusal-thin-input"] }        // hypotheses POINT to cases;
 *   ] },                                         // no proofSpecs, no risks[] on cases
 *   "evals":   { "cases": [
 *     { "name": "refusal-thin-input",            // == evals/cases/<name>/ dir name
 *       "class": "refusal",                      // golden|refusal|empty|rerun|hard-case|trigger
 *       "setup?": "prose...", "expectedBehavior?": "prose...",
 *       "expected?": "expected.md",              // grading material path (default expected.md)
 *       "checks?": ["..."],
 *       "sandbox?": { "files?": "files/", "env?": {} },  // old setup{files,env}
 *       "source?": { "kind": "field-report", "eventId": "..." } }
 *   ], "configs": [ { "id": "cc-default", "provider": "claude-code", "model": "..." } ] },
 *   "publish": { "targets": ["user"] }           // absorbs bundle.json publishTargets verbatim
 * }
 * ```
 *
 * NO stations section — stations.json died with THE MERGE; the production
 * line is code (`Stations.DEFAULT_STATIONS_TEMPLATE`).
 *
 * Tolerance law (the `EvalsJson.ts` pattern, Part 3 ruling I): a missing
 * file is `absent` (fine, no warning); a file that is not a JSON object is
 * `unusable` (warned; callers fall back to the legacy stores); a parsed
 * envelope degrades per-item — every defective entry becomes a warning and
 * is skipped, never a whole-file failure. The envelope trichotomy, the
 * named-entry walk, the per-hypothesis core, and the claim-row derivation
 * are all shared implementations (`TolerantJson.ts`, `EvalsJson.ts`).
 *
 * Coverage is DERIVED, never authored: a hypothesis is `covered` when every
 * case it points at is REALIZED (its `evals/cases/<name>/` materials dir
 * exists), `partial` when some are, `gap` when none (or it points at
 * nothing). A case entry with no materials dir is "planned".
 *
 * `readBundleStructuredState` is the SINGLE entry point for a bundle's
 * structured claims/cases state: when skill.json exists (and is usable) it
 * WINS — wholesale, including for individual cases (a case it doesn't list
 * is absent, never served from stale legacy files); otherwise the legacy
 * chain (evals/fixtures case.json scan + root evals.json, else
 * evals/risk-map.md) answers — one source wins, never a merge.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BundleIdentity, isInstallAudience } from "./Bundle.ts";
import { WorkspaceIOError } from "./Errors.ts";
import {
  claimRowsFromEvals,
  deriveClaimRow,
  parseEvalsJson,
  parseHypothesisCore,
  type ClaimsSource,
} from "./EvalsJson.ts";
import {
  FIXTURE_CLASSES,
  parseFixtureSource,
  scanFixtures,
  type FixtureCaseRecord,
  type FixtureSourceRecord,
} from "./Fixtures.ts";
import { checkCoverage, parseRiskMap, type RiskRow } from "./RiskMap.ts";
import {
  asOptionalString,
  isRecord,
  parseNamedArray,
  readJsonEnvelope,
  readJsonEnvelopeSync,
  stringArray,
  type JsonEnvelope,
} from "./TolerantJson.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

export const SKILL_JSON_FILENAME = "skill.json";
export const SKILL_JSON_SCHEMA_VERSION = 2;
/** The post-merge case-materials directory (`evals/cases/<name>/`); `evals/fixtures/` is the pre-merge name. */
const CASES_DIRNAME = "cases";
const LEGACY_FIXTURES_DIRNAME = "fixtures";
/** The default grading-material file inside a case dir (renamed from `expected/answer-key.md` at migration). */
export const DEFAULT_EXPECTED_FILENAME = "expected.md";

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/** skill.json's `skill` section — bundle.json's identity with `targets` renamed to `harnesses` and the declared `stage` merged in. */
export interface SkillJsonSkill {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly created: string;
  /** Agent platforms the skill is written for (bundle.json's old `targets`). */
  readonly harnesses: ReadonlyArray<string>;
  /**
   * The declared stage. INTERIM (tranche 1 is read-side): nothing writes
   * this field yet, so readers keep trusting the journal fold for the live
   * stage. The write-side tranche makes stage transitions write it — file
   * = record, journal event = liveness, the same pattern grade files use.
   */
  readonly stage?: string;
}

/** One failure hypothesis (a claim). `cases` POINTS at `evals.cases[].name` entries — the only hypothesis→case edge in the model. */
export interface SkillJsonHypothesis {
  readonly id: string;
  /** The observable failure sentence; `""` when the author left it out (warned). */
  readonly failure: string;
  readonly probability?: string;
  readonly impact?: string;
  readonly mustNever?: string;
  readonly cases: ReadonlyArray<string>;
}

/** The old per-case `setup {files, env}` semantics — what gets materialized into the run sandbox — under a distinct key so prose `setup` and file-materialization never collide. */
export interface SkillJsonSandbox {
  readonly files?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** One eval case definition. `name` == its `evals/cases/<name>/` directory; a case with no dir yet is "planned". */
export interface SkillJsonCase {
  readonly name: string;
  /** Raw class string as authored — non-canonical values are warned, not dropped (`Fixtures.FIXTURE_CLASSES` is the vocabulary). */
  readonly class?: string;
  /** Prose: the input state or request that exposes the risk (the old proofSpec.setup). */
  readonly setup?: string;
  /** Prose: what passing looks like (the old proofSpec.expectedBehavior). */
  readonly expectedBehavior?: string;
  /** Grading-material path relative to the case dir; defaults to `expected.md` when absent. */
  readonly expected?: string;
  readonly checks?: ReadonlyArray<string>;
  readonly sandbox?: SkillJsonSandbox;
  /** Harvest provenance, preserved verbatim (`Fixtures.FixtureSourceRecord`). */
  readonly source?: FixtureSourceRecord;
}

/** A named model-and-harness setup (smevals' Config) — completes the measurement key. Rigid on purpose: strict per-entry decode, defective entries warned and skipped. */
export class SkillJsonConfig extends Schema.Class<SkillJsonConfig>("SkillJsonConfig")({
  id: Schema.String,
  provider: Schema.String,
  model: Schema.String,
}) {}

export type SkillJsonStatus = "absent" | "unusable" | "parsed";

export interface ParseSkillJsonResult {
  readonly status: SkillJsonStatus;
  /** `undefined` when the `skill` section is missing/defective (warned) — claims/cases may still have parsed. */
  readonly skill?: SkillJsonSkill;
  readonly hypotheses: ReadonlyArray<SkillJsonHypothesis>;
  readonly cases: ReadonlyArray<SkillJsonCase>;
  readonly configs: ReadonlyArray<SkillJsonConfig>;
  /** `publish.targets`, preserved verbatim (absorbed from bundle.json's `publishTargets`). */
  readonly publishTargets: ReadonlyArray<unknown>;
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

const parseSkillSection = (raw: unknown, warnings: string[]): SkillJsonSkill | undefined => {
  if (raw === undefined) {
    warnings.push('skill.json: missing "skill" section (identity unavailable)');
    return undefined;
  }
  if (!isRecord(raw)) {
    warnings.push('skill.json: "skill" section is not an object (identity unavailable)');
    return undefined;
  }
  const slug = asOptionalString(raw.slug);
  if (slug === undefined) {
    warnings.push('skill.json: "skill" section has no usable slug (identity unavailable)');
    return undefined;
  }
  for (const field of ["name", "oneLiner", "created"] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") {
      warnings.push(`skill.json: skill.${field} is not a string; ignored`);
    }
  }
  if (raw.harnesses !== undefined && !Array.isArray(raw.harnesses)) {
    warnings.push("skill.json: skill.harnesses is not an array; ignored");
  }
  const stage = asOptionalString(raw.stage);
  return {
    slug: slug.trim(),
    name: typeof raw.name === "string" ? raw.name : "",
    oneLiner: typeof raw.oneLiner === "string" ? raw.oneLiner : "",
    tags: stringArray(raw.tags),
    created: typeof raw.created === "string" ? raw.created : "",
    harnesses: stringArray(raw.harnesses),
    ...(stage !== undefined ? { stage } : {}),
  };
};

const parseHypotheses = (raw: unknown, warnings: string[]): ReadonlyArray<SkillJsonHypothesis> => {
  if (raw === undefined) {
    return [];
  }
  if (!isRecord(raw)) {
    warnings.push('skill.json: "design" section is not an object; ignored');
    return [];
  }
  const rawHypotheses = raw.failureHypotheses;
  if (rawHypotheses === undefined) {
    return [];
  }
  if (!Array.isArray(rawHypotheses)) {
    warnings.push("skill.json: design.failureHypotheses is not an array; ignored");
    return [];
  }
  return parseNamedArray<SkillJsonHypothesis>(rawHypotheses, warnings, {
    prefix: "skill.json",
    label: "failure hypothesis",
    keyField: "id",
    parseEntry: (record, id) => {
      if (record.proofSpecs !== undefined) {
        warnings.push(
          `skill.json: hypothesis "${id}" carries a legacy "proofSpecs" field (schemaVersion 2 points at cases via "cases"); ignored`,
        );
      }

      const cases: string[] = [];
      const rawCases = record.cases;
      // An empty `cases: []` is an HONEST gap (a claim not yet proven),
      // never warned; only a structurally missing/mistyped field is.
      if (rawCases === undefined) {
        warnings.push(`skill.json: hypothesis "${id}" has no "cases" field`);
      } else if (!Array.isArray(rawCases)) {
        warnings.push(`skill.json: hypothesis "${id}" has a non-array "cases" field; ignored`);
      } else {
        const seen = new Set<string>();
        for (const name of rawCases) {
          if (typeof name !== "string" || name.trim().length === 0) {
            warnings.push(`skill.json: hypothesis "${id}" has a non-string case pointer; skipped`);
            continue;
          }
          const trimmed = name.trim();
          if (seen.has(trimmed)) {
            warnings.push(`skill.json: hypothesis "${id}" repeats case "${trimmed}"; duplicate skipped`);
            continue;
          }
          seen.add(trimmed);
          cases.push(trimmed);
        }
      }

      return {
        id,
        ...parseHypothesisCore(record, id, "skill.json", warnings),
        cases,
      };
    },
  });
};

const parseSandbox = (raw: unknown, caseName: string, warnings: string[]): SkillJsonSandbox | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    warnings.push(`skill.json: case "${caseName}" has a non-object sandbox field; ignored`);
    return undefined;
  }
  const files = asOptionalString(raw.files);
  let env: Readonly<Record<string, string>> | undefined;
  if (raw.env !== undefined) {
    if (isRecord(raw.env)) {
      const entries = Object.entries(raw.env).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      );
      env = Object.fromEntries(entries);
    } else {
      warnings.push(`skill.json: case "${caseName}" has a non-object sandbox.env; ignored`);
    }
  }
  if (files === undefined && env === undefined) {
    return undefined;
  }
  return { ...(files !== undefined ? { files } : {}), ...(env !== undefined ? { env } : {}) };
};

const parseCases = (raw: unknown, warnings: string[]): ReadonlyArray<SkillJsonCase> => {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push("skill.json: evals.cases is not an array; ignored");
    return [];
  }
  return parseNamedArray<SkillJsonCase>(raw, warnings, {
    prefix: "skill.json",
    label: "eval case",
    keyField: "name",
    parseEntry: (entry, name) => {
      const klass = asOptionalString(entry.class);
      if (klass !== undefined && !(FIXTURE_CLASSES as ReadonlyArray<string>).includes(klass)) {
        warnings.push(
          `skill.json: case "${name}" has unknown class "${klass}" (expected ${FIXTURE_CLASSES.join("|")})`,
        );
      }

      if (entry.risks !== undefined) {
        warnings.push(
          `skill.json: case "${name}" carries a legacy "risks" field (schemaVersion 2's only edge is hypothesis→case via design.failureHypotheses[].cases); ignored`,
        );
      }

      // `setup` is PROSE in schemaVersion 2. The old `setup {files, env}`
      // object landing here is a migration-shaped mistake — captured into
      // `sandbox` (nothing lost) with a warning.
      let setup: string | undefined;
      let sandbox = parseSandbox(entry.sandbox, name, warnings);
      if (entry.setup !== undefined) {
        if (typeof entry.setup === "string") {
          setup = asOptionalString(entry.setup);
        } else if (isRecord(entry.setup) && sandbox === undefined) {
          warnings.push(
            `skill.json: case "${name}" has an object "setup" (the old files/env shape) — schemaVersion 2 keeps that under "sandbox"; captured there`,
          );
          sandbox = parseSandbox(entry.setup, name, warnings);
        } else {
          warnings.push(`skill.json: case "${name}" has a non-string setup; ignored`);
        }
      }

      let checks: ReadonlyArray<string> | undefined;
      if (entry.checks !== undefined) {
        if (Array.isArray(entry.checks)) {
          const kept = entry.checks.filter((check): check is string => typeof check === "string");
          if (kept.length !== entry.checks.length) {
            warnings.push(`skill.json: case "${name}" has non-string checks; those entries were skipped`);
          }
          checks = kept;
        } else {
          warnings.push(`skill.json: case "${name}" has a non-array checks field; ignored`);
        }
      }

      const expectedBehavior = asOptionalString(entry.expectedBehavior);
      const expected = asOptionalString(entry.expected);
      const source = parseFixtureSource(entry.source, `skill.json: case "${name}"`, warnings);

      return {
        name,
        ...(klass !== undefined ? { class: klass } : {}),
        ...(setup !== undefined ? { setup } : {}),
        ...(expectedBehavior !== undefined ? { expectedBehavior } : {}),
        ...(expected !== undefined ? { expected } : {}),
        ...(checks !== undefined ? { checks } : {}),
        ...(sandbox !== undefined ? { sandbox } : {}),
        ...(source !== undefined ? { source } : {}),
      };
    },
  });
};

const parseConfigs = (raw: unknown, warnings: string[]): ReadonlyArray<SkillJsonConfig> => {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push("skill.json: evals.configs is not an array; ignored");
    return [];
  }
  return parseNamedArray<SkillJsonConfig>(raw, warnings, {
    prefix: "skill.json",
    label: "eval config",
    keyField: "id",
    parseEntry: (entry, id) => {
      // Configs are rigid enough for a strict per-entry decode — a
      // defective entry is warned and skipped, never a whole-file failure.
      try {
        return Schema.decodeUnknownSync(SkillJsonConfig)(entry);
      } catch {
        warnings.push(`skill.json: eval config "${id}" is malformed (expected string id/provider/model); skipped`);
        return undefined;
      }
    },
  });
};

const parsePublishTargets = (raw: unknown, warnings: string[]): ReadonlyArray<unknown> => {
  if (raw === undefined) {
    return [];
  }
  if (!isRecord(raw)) {
    warnings.push('skill.json: "publish" section is not an object; ignored');
    return [];
  }
  if (raw.targets === undefined) {
    return [];
  }
  if (!Array.isArray(raw.targets)) {
    warnings.push("skill.json: publish.targets is not an array; ignored");
    return [];
  }
  return raw.targets;
};

// ---------------------------------------------------------------------------
// The reader (Effect + sync twins over one shared section walk)
// ---------------------------------------------------------------------------

const EMPTY_SECTIONS = { hypotheses: [], cases: [], configs: [], publishTargets: [] } as const;

const fromEnvelope = (envelope: JsonEnvelope, warnings: string[]): ParseSkillJsonResult => {
  if (envelope.status === "absent") {
    return { status: "absent", ...EMPTY_SECTIONS, warnings };
  }
  if (envelope.status === "unusable" || envelope.record === undefined) {
    return { status: "unusable", ...EMPTY_SECTIONS, warnings };
  }
  const parsed = envelope.record;

  if (parsed.schemaVersion !== SKILL_JSON_SCHEMA_VERSION) {
    warnings.push(
      `skill.json: schemaVersion is ${JSON.stringify(parsed.schemaVersion)} (expected ${SKILL_JSON_SCHEMA_VERSION}); parsed tolerantly`,
    );
  }
  if (parsed.stations !== undefined) {
    warnings.push(
      'skill.json: carries a "stations" section — the production line is code now (stations.json died with THE MERGE); ignored',
    );
  }

  const skill = parseSkillSection(parsed.skill, warnings);
  const hypotheses = parseHypotheses(parsed.design, warnings);
  const evalsSection = isRecord(parsed.evals) ? parsed.evals : undefined;
  if (parsed.evals !== undefined && evalsSection === undefined) {
    warnings.push('skill.json: "evals" section is not an object; ignored');
  }
  const cases = parseCases(evalsSection?.cases, warnings);
  const configs = parseConfigs(evalsSection?.configs, warnings);
  const publishTargets = parsePublishTargets(parsed.publish, warnings);

  return {
    status: "parsed",
    ...(skill !== undefined ? { skill } : {}),
    hypotheses,
    cases,
    configs,
    publishTargets,
    warnings,
  };
};

const ENVELOPE_OPTIONS = {
  label: "skill.json",
  fallbackHint: "falling back to the legacy pre-merge files",
} as const;

/**
 * Parses a bundle-root `skill.json` (schemaVersion 2). Missing file →
 * `absent`, no warning. Not a JSON object → `unusable` + a warning (callers
 * fall back to the legacy pre-merge stores). Otherwise `parsed`, with
 * per-section, per-item tolerance — defects degrade to warnings, never
 * hard failures.
 */
export const parseSkillJson = Effect.fn("SkillJson.parseSkillJson")(function* (skillJsonPath: string) {
  const warnings: string[] = [];
  const envelope = yield* readJsonEnvelope(skillJsonPath, warnings, ENVELOPE_OPTIONS);
  return fromEnvelope(envelope, warnings);
});

/**
 * Sync twin of `parseSkillJson` for the node-fs call sites (server request
 * handlers, chat preamble) — same trichotomy, same warnings, no per-request
 * Effect runtime.
 */
export const parseSkillJsonSync = (skillJsonPath: string): ParseSkillJsonResult => {
  const warnings: string[] = [];
  const envelope = readJsonEnvelopeSync(skillJsonPath, warnings, ENVELOPE_OPTIONS);
  return fromEnvelope(envelope, warnings);
};

// ---------------------------------------------------------------------------
// Identity bridge
// ---------------------------------------------------------------------------

/**
 * Projects a parsed skill.json's `skill` section into the SAME
 * `BundleIdentity` shape every identity consumer (IndexService's catalog
 * scan, the server payloads) already speaks — `harnesses` maps back onto the
 * old `targets` field, `publish.targets`' audience strings onto
 * `publishTargets`. Returns `undefined` when the section didn't parse.
 */
export const identityFromSkillJson = (parsed: ParseSkillJsonResult): BundleIdentity | undefined => {
  if (parsed.skill === undefined) {
    return undefined;
  }
  const audiences = parsed.publishTargets.filter(isInstallAudience);
  return BundleIdentity.make({
    schemaVersion: 1,
    slug: parsed.skill.slug,
    name: parsed.skill.name,
    oneLiner: parsed.skill.oneLiner,
    tags: parsed.skill.tags,
    created: parsed.skill.created,
    targets: parsed.skill.harnesses,
    ...(audiences.length > 0 ? { publishTargets: audiences } : {}),
  });
};

/**
 * One bundle's identity, sync and tolerant, with THE MERGE precedence:
 * `skill.json` first (it wins when present and usable), `bundle.json` as
 * the legacy fallback. `undefined` when neither yields a usable identity —
 * callers degrade (e.g. the chat preamble drops its one-liner clause).
 */
export const readBundleIdentitySync = (bundleDir: string): BundleIdentity | undefined => {
  const skillScan = parseSkillJsonSync(join(bundleDir, SKILL_JSON_FILENAME));
  const fromSkill = identityFromSkillJson(skillScan);
  if (fromSkill !== undefined) {
    return fromSkill;
  }
  // bundle.json fallback, tolerant BY FIELD (not a strict decode): callers
  // of this helper degrade rather than gate — a hand-written bundle.json
  // missing e.g. `tags` must still yield its one-liner.
  try {
    const raw: unknown = JSON.parse(readFileSync(join(bundleDir, "bundle.json"), "utf8"));
    if (!isRecord(raw)) {
      return undefined;
    }
    const slug = asOptionalString(raw.slug);
    if (slug === undefined) {
      return undefined;
    }
    return BundleIdentity.make({
      schemaVersion: 1,
      slug,
      name: typeof raw.name === "string" ? raw.name : "",
      oneLiner: typeof raw.oneLiner === "string" ? raw.oneLiner : "",
      tags: stringArray(raw.tags),
      created: typeof raw.created === "string" ? raw.created : "",
      targets: stringArray(raw.targets),
    });
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Path helpers — where a bundle's case materials live
// ---------------------------------------------------------------------------

/** `evals/cases/` when it exists (post-merge layout), else `evals/fixtures/` (legacy). Sync twin of `casesRoot` for the node-fs call sites (Server.ts et al.). */
export const casesRootSync = (bundleDir: string): string => {
  const casesDir = join(bundleDir, "evals", CASES_DIRNAME);
  return existsSync(casesDir) ? casesDir : join(bundleDir, "evals", LEGACY_FIXTURES_DIRNAME);
};

/** `evals/cases/` when it exists (post-merge layout), else `evals/fixtures/` (legacy). */
export const casesRoot = Effect.fn("SkillJson.casesRoot")(function* (bundleDir: string) {
  const fs = yield* FileSystem;
  const casesDir = join(bundleDir, "evals", CASES_DIRNAME);
  const exists = yield* fs.exists(casesDir).pipe(Effect.mapError(toIOError(`could not check ${casesDir}`)));
  return exists ? casesDir : join(bundleDir, "evals", LEGACY_FIXTURES_DIRNAME);
});

/** One case's materials dir, layout-aware (`evals/cases/<name>/` post-merge, `evals/fixtures/<name>/` legacy). */
export const resolveCaseDirSync = (bundleDir: string, caseName: string): string =>
  join(casesRootSync(bundleDir), caseName);

/** Whether a directory IS a bundle root: it carries `skill.json` (post-merge) or `bundle.json` (legacy). */
export const bundleMarkerExistsSync = (bundleDir: string): boolean =>
  existsSync(join(bundleDir, SKILL_JSON_FILENAME)) || existsSync(join(bundleDir, "bundle.json"));

/** Whether a directory IS a bundle root: it carries `skill.json` (post-merge) or `bundle.json` (legacy). */
export const bundleMarkerExists = Effect.fn("SkillJson.bundleMarkerExists")(function* (bundleDir: string) {
  const fs = yield* FileSystem;
  const skillJsonPath = join(bundleDir, SKILL_JSON_FILENAME);
  const hasSkillJson = yield* fs
    .exists(skillJsonPath)
    .pipe(Effect.mapError(toIOError(`could not check ${skillJsonPath}`)));
  if (hasSkillJson) {
    return true;
  }
  const bundleJsonPath = join(bundleDir, "bundle.json");
  return yield* fs.exists(bundleJsonPath).pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));
});

// ---------------------------------------------------------------------------
// The unified structured-state reader
// ---------------------------------------------------------------------------

export interface BundleStateWarning {
  /** Which store produced the warning: `"skill.json"`, `"fixtures"`, `"evals.json"`, or `"risk-map"` — the index's warning-source vocabulary. */
  readonly source: string;
  readonly message: string;
}

/**
 * The unified structured state of one bundle — everything the index/server
 * needs about claims and cases, whichever generation of files answered.
 */
export interface BundleStructuredState {
  /** True when a usable skill.json won; false when the legacy chain answered. */
  readonly hasSkillJson: boolean;
  readonly claimsSource: ClaimsSource;
  /** Claim rows in the risk-map row shape everything downstream consumes (`RiskMap.RiskRow` + proof-case intentions). */
  readonly claims: ReadonlyArray<RiskRow & { readonly proofCases?: ReadonlyArray<string> }>;
  /** Case records in the scanned-fixture shape (`Fixtures.FixtureCaseRecord`). skill.json cases carry `risks: []` — the hypothesis→case edge lives on `claims[].proofCases`. */
  readonly cases: ReadonlyArray<FixtureCaseRecord>;
  readonly warnings: ReadonlyArray<BundleStateWarning>;
}

/**
 * Coverage derivation over skill.json — `EvalsJson.deriveClaimRow` (the one
 * shared implementation) applied to hypothesis→case pointers. Exported for
 * the reader's tests; `realized` is the set of case names whose materials
 * dir exists.
 */
export const claimRowsFromSkillJson = (
  hypotheses: ReadonlyArray<SkillJsonHypothesis>,
  realized: ReadonlySet<string>,
): ReadonlyArray<RiskRow & { readonly proofCases: ReadonlyArray<string> }> =>
  hypotheses.map((hypothesis) => deriveClaimRow(hypothesis.id, hypothesis.failure, hypothesis.cases, realized));

export interface ReadBundleStructuredStateOptions {
  /** A skill.json parse this rebuild already ran (IndexService's catalog scan) — passed so one rebuild parses each bundle's skill.json exactly once. */
  readonly skillJsonScan?: ParseSkillJsonResult;
}

/**
 * THE single entry point for a bundle's structured claims/cases state.
 *
 * When `skill.json` exists and parses, it WINS: cases come from
 * `evals.cases` (realization/prompt.md checked against `evals/cases/<name>/`
 * on disk; a directory not named by any case entry is warned — the
 * name==dir contract, tolerantly enforced), claims from
 * `design.failureHypotheses` with coverage derived from realization.
 *
 * Otherwise the legacy chain answers, exactly as the pre-merge index did:
 * `scanFixtures` over `evals/fixtures/*​/case.json`, claims from the root
 * `evals.json` when it parses, else from `evals/risk-map.md` (+
 * `checkCoverage`). One source wins, never a merge.
 */
export const readBundleStructuredState = Effect.fn("SkillJson.readBundleStructuredState")(function* (
  bundleDir: string,
  options?: ReadBundleStructuredStateOptions,
) {
  const fs = yield* FileSystem;
  const warnings: BundleStateWarning[] = [];

  const skillJsonScan =
    options?.skillJsonScan ?? (yield* parseSkillJson(join(bundleDir, SKILL_JSON_FILENAME)));
  for (const warning of skillJsonScan.warnings) {
    warnings.push({ source: "skill.json", message: warning });
  }

  if (skillJsonScan.status === "parsed") {
    // One directory listing drives BOTH realization (which cases have
    // materials dirs) and the name==dir enforcement (dirs no case entry
    // names), instead of per-case exists() probes.
    const casesDir = join(bundleDir, "evals", CASES_DIRNAME);
    const casesDirExists = yield* fs
      .exists(casesDir)
      .pipe(Effect.mapError(toIOError(`could not check ${casesDir}`)));
    const root = casesDirExists ? casesDir : join(bundleDir, "evals", LEGACY_FIXTURES_DIRNAME);
    const rootRel = `evals/${casesDirExists ? CASES_DIRNAME : LEGACY_FIXTURES_DIRNAME}`;
    const rootExists =
      casesDirExists ||
      (yield* fs.exists(root).pipe(Effect.mapError(toIOError(`could not check ${root}`))));

    const materialDirs = new Set<string>();
    if (rootExists) {
      const entries = yield* fs.readDirectory(root).pipe(Effect.mapError(toIOError(`could not list ${root}`)));
      for (const entry of entries.slice().sort()) {
        if (entry.startsWith(".")) {
          continue;
        }
        const info = yield* fs
          .stat(join(root, entry))
          .pipe(Effect.mapError(toIOError(`could not stat ${join(root, entry)}`)));
        if (info.type === "Directory") {
          materialDirs.add(entry);
        }
      }
    }

    const listed = new Set(skillJsonScan.cases.map((entry) => entry.name));
    const realized = new Set<string>();
    const cases: FixtureCaseRecord[] = [];
    for (const caseEntry of skillJsonScan.cases) {
      let hasPromptMd = false;
      if (materialDirs.has(caseEntry.name)) {
        realized.add(caseEntry.name);
        const promptPath = join(root, caseEntry.name, "prompt.md");
        hasPromptMd = yield* fs.exists(promptPath).pipe(Effect.mapError(toIOError(`could not check ${promptPath}`)));
        if (!hasPromptMd) {
          warnings.push({ source: "fixtures", message: `${rootRel}/${caseEntry.name}/prompt.md is missing` });
        }
      }
      // A case entry with no materials dir is PLANNED — listed (so the Eval
      // tab can show the intention) but unrunnable, and silent: planning
      // ahead of building is the designed order, not a defect.
      cases.push({
        caseName: caseEntry.name,
        class: caseEntry.class ?? "unknown",
        risks: [],
        hasPromptMd,
        ...(caseEntry.source !== undefined ? { source: caseEntry.source } : {}),
      });
    }

    // The name==dir contract, tolerantly enforced from the other side: a
    // materials directory no case entry names is warned, never adopted.
    for (const dirName of materialDirs) {
      if (!listed.has(dirName)) {
        warnings.push({
          source: "skill.json",
          message: `${rootRel}/${dirName}/ has no matching case entry in skill.json (case name must equal its directory name)`,
        });
      }
    }

    // Dangling case pointers: a hypothesis naming a case that has no
    // evals.cases entry at all (not merely unrealized) is a broken edge.
    for (const hypothesis of skillJsonScan.hypotheses) {
      for (const name of hypothesis.cases) {
        if (!listed.has(name)) {
          warnings.push({
            source: "skill.json",
            message: `hypothesis "${hypothesis.id}" points at case "${name}" which has no evals.cases entry`,
          });
        }
      }
    }

    return {
      hasSkillJson: true,
      claimsSource: "skill.json",
      claims: claimRowsFromSkillJson(skillJsonScan.hypotheses, realized),
      cases,
      warnings,
    } satisfies BundleStructuredState;
  }

  // ---- Legacy chain: exactly the pre-merge read path. ----
  const fixtureScan = yield* scanFixtures(bundleDir);
  for (const warning of fixtureScan.warnings) {
    warnings.push({ source: "fixtures", message: warning });
  }

  const evalsScan = yield* parseEvalsJson(join(bundleDir, "evals.json"));
  for (const warning of evalsScan.warnings) {
    warnings.push({ source: "evals.json", message: warning });
  }
  if (evalsScan.status === "parsed") {
    const caseNames = fixtureScan.cases.map((fixtureCase) => fixtureCase.caseName);
    return {
      hasSkillJson: false,
      claimsSource: "evals.json",
      claims: claimRowsFromEvals(evalsScan.hypotheses, caseNames),
      cases: fixtureScan.cases,
      warnings,
    } satisfies BundleStructuredState;
  }

  const riskMapScan = yield* parseRiskMap(join(bundleDir, "evals", "risk-map.md"));
  for (const warning of riskMapScan.warnings) {
    warnings.push({ source: "risk-map", message: warning });
  }
  for (const warning of checkCoverage(riskMapScan.rows, fixtureScan.cases)) {
    warnings.push({ source: "risk-map", message: warning });
  }
  return {
    hasSkillJson: false,
    claimsSource: "risk-map",
    claims: riskMapScan.rows,
    cases: fixtureScan.cases,
    warnings,
  } satisfies BundleStructuredState;
});
