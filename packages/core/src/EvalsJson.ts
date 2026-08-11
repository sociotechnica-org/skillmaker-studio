/**
 * Root-level `evals.json` — the STRUCTURED claims/eval-design artifact the
 * design step writes (design-skill output contract, `docs/library/authoring/
 * Entity - Design Doc.md` §Design-step input/output contract; director
 * ruling in docs/friction/e2e-readiness.md: risk-map.md's claim data is to
 * be subsumed by json-stored data). Shape:
 *
 * ```json
 * {
 *   "failureHypotheses": [
 *     {
 *       "id": "IN-1",
 *       "failure": "An observable description of how the skill could go wrong.",
 *       "probability": "High | Medium | Low",
 *       "impact": "High | Medium | Low",
 *       "mustNever": "The skill must never ...",
 *       "proofSpecs": [
 *         { "name": "kebab-case-case-name", "setup": "...", "expectedBehavior": "..." }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * READ-SIDE ONLY (first shipped slice): nothing here writes or migrates
 * `evals.json`; this parser exists so design-skill's output renders today.
 * Same tolerance law as `RiskMap.ts` (Part 3 ruling I): a missing file is
 * fine (absent, no warning); malformed content is warnings, never failures.
 * A file that exists but is not JSON (or whose `failureHypotheses` is not
 * an array) is UNUSABLE — the caller falls back to the legacy risk-map,
 * one source always wins, never a merge.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { WorkspaceIOError } from "./Errors.ts";
import { isKnownRiskFamily, RISK_FAMILIES, riskFamily } from "./Fixtures.ts";
import type { RiskRow } from "./RiskMap.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** Which source a bundle's claim rows came from — one wins, never merged. `"skill.json"` (THE MERGE, schemaVersion 2) beats root `"evals.json"`, which beats the legacy `"risk-map"` (`SkillJson.readBundleStructuredState` owns the precedence). */
export const CLAIMS_SOURCES = ["skill.json", "evals.json", "risk-map"] as const;
export type ClaimsSource = (typeof CLAIMS_SOURCES)[number];

/** One proof-case intention nested under a hypothesis (contract: `proofSpecs`). */
export interface EvalsProofSpec {
  readonly name: string;
  readonly setup?: string;
  readonly expectedBehavior?: string;
}

/** One parsed failure hypothesis (a claim). `probability`/`impact`/`mustNever` are kept verbatim — display data, not vocabulary. */
export interface EvalsFailureHypothesis {
  readonly id: string;
  /** The observable failure sentence — the claim's description. `""` when the author left it out (warned). */
  readonly failure: string;
  readonly probability?: string;
  readonly impact?: string;
  readonly mustNever?: string;
  readonly proofSpecs: ReadonlyArray<EvalsProofSpec>;
}

/**
 * `absent` — no file (fine, no warning). `unusable` — a file exists but is
 * not parseable as the contract's envelope (not JSON / not an object /
 * `failureHypotheses` not an array): warned, and the caller must fall back
 * to risk-map. `parsed` — the envelope held; per-hypothesis defects are
 * warnings with the defective entry skipped, never a whole-file failure.
 */
export type EvalsJsonStatus = "absent" | "unusable" | "parsed";

export interface ParseEvalsJsonResult {
  readonly status: EvalsJsonStatus;
  readonly hypotheses: ReadonlyArray<EvalsFailureHypothesis>;
  readonly warnings: ReadonlyArray<string>;
}

const ALLOWED_LEVELS = new Set(["High", "Medium", "Low"]);

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const parseProofSpecs = (
  hypothesisId: string,
  raw: unknown,
  warnings: string[],
): ReadonlyArray<EvalsProofSpec> => {
  if (raw === undefined) {
    warnings.push(`evals.json: hypothesis "${hypothesisId}" has no proofSpecs`);
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push(`evals.json: hypothesis "${hypothesisId}" has non-array proofSpecs; ignored`);
    return [];
  }
  const specs: EvalsProofSpec[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      warnings.push(`evals.json: hypothesis "${hypothesisId}" has a non-object proof spec; skipped`);
      continue;
    }
    const spec = entry as Record<string, unknown>;
    if (typeof spec.name !== "string" || spec.name.trim().length === 0) {
      warnings.push(`evals.json: hypothesis "${hypothesisId}" has a proof spec without a name; skipped`);
      continue;
    }
    const name = spec.name.trim();
    if (seen.has(name)) {
      warnings.push(`evals.json: hypothesis "${hypothesisId}" repeats proof spec "${name}"; duplicate skipped`);
      continue;
    }
    seen.add(name);
    const setup = asOptionalString(spec.setup);
    const expectedBehavior = asOptionalString(spec.expectedBehavior);
    specs.push({
      name,
      ...(setup !== undefined ? { setup } : {}),
      ...(expectedBehavior !== undefined ? { expectedBehavior } : {}),
    });
  }
  if (raw.length === 0) {
    warnings.push(`evals.json: hypothesis "${hypothesisId}" has no proofSpecs`);
  }
  return specs;
};

/**
 * Parses a bundle-root `evals.json`. Missing file → `absent`, no warning
 * (optional until the design step authors it). Unreadable envelope →
 * `unusable` + a warning (caller falls back to risk-map). Otherwise
 * `parsed`, with per-hypothesis tolerance: entries without a usable string
 * `id` are skipped (no stable identity), duplicate ids keep the first,
 * everything else degrades field-by-field with warnings.
 */
export const parseEvalsJson = Effect.fn("EvalsJson.parseEvalsJson")(function* (evalsJsonPath: string) {
  const fs = yield* FileSystem;
  const warnings: string[] = [];

  const exists = yield* fs.exists(evalsJsonPath).pipe(Effect.mapError(toIOError(`could not check ${evalsJsonPath}`)));
  if (!exists) {
    return { status: "absent", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }

  const content = yield* fs
    .readFileString(evalsJsonPath)
    .pipe(Effect.mapError(toIOError(`could not read ${evalsJsonPath}`)));

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    warnings.push(
      `evals.json: not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); falling back to evals/risk-map.md`,
    );
    return { status: "unusable", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push("evals.json: top level is not an object; falling back to evals/risk-map.md");
    return { status: "unusable", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }
  const envelope = parsed as Record<string, unknown>;
  const rawHypotheses = envelope.failureHypotheses;
  if (!Array.isArray(rawHypotheses)) {
    warnings.push(
      rawHypotheses === undefined
        ? "evals.json: missing failureHypotheses array; falling back to evals/risk-map.md"
        : "evals.json: failureHypotheses is not an array; falling back to evals/risk-map.md",
    );
    return { status: "unusable", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }

  const hypotheses: EvalsFailureHypothesis[] = [];
  const seenIds = new Set<string>();
  for (const entry of rawHypotheses) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      warnings.push("evals.json: non-object failure hypothesis skipped");
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.trim().length === 0) {
      warnings.push("evals.json: failure hypothesis without a string id skipped");
      continue;
    }
    const id = record.id.trim();
    if (seenIds.has(id)) {
      warnings.push(`evals.json: duplicate failure hypothesis id "${id}"; later entry skipped`);
      continue;
    }
    seenIds.add(id);

    if (!isKnownRiskFamily(riskFamily(id))) {
      warnings.push(
        `evals.json: hypothesis id "${id}" does not band into a known family (expected ${RISK_FAMILIES.join("|")} prefix)`,
      );
    }

    let failure = "";
    if (typeof record.failure === "string" && record.failure.trim().length > 0) {
      failure = record.failure.trim();
    } else {
      warnings.push(`evals.json: hypothesis "${id}" has no failure description`);
    }

    for (const level of ["probability", "impact"] as const) {
      const value = record[level];
      if (typeof value === "string" && !ALLOWED_LEVELS.has(value)) {
        warnings.push(`evals.json: hypothesis "${id}" has unexpected ${level} "${value}" (expected High|Medium|Low)`);
      }
    }

    const probability = asOptionalString(record.probability);
    const impact = asOptionalString(record.impact);
    const mustNever = asOptionalString(record.mustNever);
    hypotheses.push({
      id,
      failure,
      ...(probability !== undefined ? { probability } : {}),
      ...(impact !== undefined ? { impact } : {}),
      ...(mustNever !== undefined ? { mustNever } : {}),
      proofSpecs: parseProofSpecs(id, record.proofSpecs, warnings),
    });
  }

  return { status: "parsed", hypotheses, warnings } satisfies ParseEvalsJsonResult;
});

/**
 * Projects parsed hypotheses into the SAME claim/risk row shape the
 * risk-map parser yields (`RiskMap.ts`'s `RiskRow`), so everything
 * downstream — index, server payload, viewer Eval tab, coverage tallies —
 * works unchanged whichever source won.
 *
 * Coverage is DERIVED, not authored (evals.json has no coverage column):
 * a hypothesis whose proof specs are all realized as actual fixture cases
 * is `covered`; some realized is `partial`; none (or no specs at all) is
 * honestly a `gap` — the proof case is an intention until a fixture
 * exists. `fixtureCase` links the first realized spec (so the existing
 * fixture join keeps working); `proofCases` carries every spec name so a
 * not-yet-runnable bundle can still show its proof-case intentions.
 */
export const claimRowsFromEvals = (
  hypotheses: ReadonlyArray<EvalsFailureHypothesis>,
  fixtureCaseNames: ReadonlyArray<string>,
): ReadonlyArray<RiskRow & { readonly proofCases: ReadonlyArray<string> }> => {
  const existing = new Set(fixtureCaseNames);
  return hypotheses.map((hypothesis) => {
    const specNames = hypothesis.proofSpecs.map((spec) => spec.name);
    const realized = specNames.filter((name) => existing.has(name));
    const coverage =
      realized.length === 0 ? "gap" : realized.length === specNames.length ? "covered" : "partial";
    return {
      riskId: hypothesis.id,
      family: riskFamily(hypothesis.id),
      description: hypothesis.failure,
      coverage,
      ...(realized[0] !== undefined ? { fixtureCase: realized[0] } : {}),
      proofCases: specNames,
    };
  });
};
