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
 *
 * The per-hypothesis core (id/family/failure/probability/impact/mustNever)
 * and the claim-row derivation are shared with `SkillJson.ts` — one
 * implementation, two file formats (the child field differs: `proofSpecs`
 * here, `cases` there).
 */
import { Effect } from "effect";
import { isKnownRiskFamily, RISK_FAMILIES, riskFamily } from "./Fixtures.ts";
import type { RiskRow } from "./RiskMap.ts";
import { asOptionalString, isRecord, parseNamedArray, readJsonEnvelope } from "./TolerantJson.ts";

/** Which source a bundle's claim rows came from — one wins, never merged. `"skill.json"` (THE MERGE, schemaVersion 2) beats root `"evals.json"`, which beats the legacy `"risk-map"` (`SkillJson.readBundleStructuredState` owns the precedence). */
export const CLAIMS_SOURCES = ["skill.json", "evals.json", "risk-map"] as const;
export type ClaimsSource = (typeof CLAIMS_SOURCES)[number];

/** One proof-case intention nested under a hypothesis (contract: `proofSpecs`). */
export interface EvalsProofSpec {
  readonly name: string;
  readonly setup?: string;
  readonly expectedBehavior?: string;
}

/** The hypothesis fields shared by every claims format (`evals.json`'s `failureHypotheses` and skill.json's `design.failureHypotheses`). `probability`/`impact`/`mustNever` are kept verbatim — display data, not vocabulary. */
export interface HypothesisCoreFields {
  /** The observable failure sentence — the claim's description. `""` when the author left it out (warned). */
  readonly failure: string;
  readonly probability?: string;
  readonly impact?: string;
  readonly mustNever?: string;
}

/** One parsed failure hypothesis (a claim). */
export interface EvalsFailureHypothesis extends HypothesisCoreFields {
  readonly id: string;
  readonly proofSpecs: ReadonlyArray<EvalsProofSpec>;
}

const ALLOWED_LEVELS = new Set(["High", "Medium", "Low"]);

/**
 * The shared per-hypothesis parse core: family-banding warning, failure
 * fallback (kept as `""`, warned), probability/impact vocabulary warnings,
 * verbatim optional strings. Id validation/dedup happens in the caller's
 * `parseNamedArray` walk; `prefix` names the file for warnings.
 */
export const parseHypothesisCore = (
  record: Record<string, unknown>,
  id: string,
  prefix: string,
  warnings: string[],
): HypothesisCoreFields => {
  if (!isKnownRiskFamily(riskFamily(id))) {
    warnings.push(
      `${prefix}: hypothesis id "${id}" does not band into a known family (expected ${RISK_FAMILIES.join("|")} prefix)`,
    );
  }

  let failure = "";
  if (typeof record.failure === "string" && record.failure.trim().length > 0) {
    failure = record.failure.trim();
  } else {
    warnings.push(`${prefix}: hypothesis "${id}" has no failure description`);
  }

  for (const level of ["probability", "impact"] as const) {
    const value = record[level];
    if (typeof value === "string" && !ALLOWED_LEVELS.has(value)) {
      warnings.push(`${prefix}: hypothesis "${id}" has unexpected ${level} "${value}" (expected High|Medium|Low)`);
    }
  }

  const probability = asOptionalString(record.probability);
  const impact = asOptionalString(record.impact);
  const mustNever = asOptionalString(record.mustNever);
  return {
    failure,
    ...(probability !== undefined ? { probability } : {}),
    ...(impact !== undefined ? { impact } : {}),
    ...(mustNever !== undefined ? { mustNever } : {}),
  };
};

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
  if (raw.length === 0) {
    warnings.push(`evals.json: hypothesis "${hypothesisId}" has no proofSpecs`);
    return [];
  }
  // Deliberately NOT `parseNamedArray`: the shipped warning wording here
  // ("has a proof spec without a name", "repeats proof spec") predates the
  // shared walk and is part of the read contract design-skill's authors see.
  const specs: EvalsProofSpec[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      warnings.push(`evals.json: hypothesis "${hypothesisId}" has a non-object proof spec; skipped`);
      continue;
    }
    const spec = entry;
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
  const warnings: string[] = [];

  const envelope = yield* readJsonEnvelope(evalsJsonPath, warnings, {
    label: "evals.json",
    fallbackHint: "falling back to evals/risk-map.md",
  });
  if (envelope.status === "absent") {
    return { status: "absent", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }
  if (envelope.status === "unusable" || envelope.record === undefined) {
    return { status: "unusable", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }

  const rawHypotheses = envelope.record.failureHypotheses;
  if (!Array.isArray(rawHypotheses)) {
    warnings.push(
      rawHypotheses === undefined
        ? "evals.json: missing failureHypotheses array; falling back to evals/risk-map.md"
        : "evals.json: failureHypotheses is not an array; falling back to evals/risk-map.md",
    );
    return { status: "unusable", hypotheses: [], warnings } satisfies ParseEvalsJsonResult;
  }

  const hypotheses = parseNamedArray<EvalsFailureHypothesis>(rawHypotheses, warnings, {
    prefix: "evals.json",
    label: "failure hypothesis",
    keyField: "id",
    parseEntry: (record, id) => ({
      id,
      ...parseHypothesisCore(record, id, "evals.json", warnings),
      proofSpecs: parseProofSpecs(id, record.proofSpecs, warnings),
    }),
  });

  return { status: "parsed", hypotheses, warnings } satisfies ParseEvalsJsonResult;
});

/**
 * The shared claim-row derivation (used by both claims formats): coverage
 * is DERIVED, not authored — all pointed cases realized is `covered`, some
 * is `partial`, none (or no pointers at all) is honestly a `gap`.
 * `fixtureCase` links the first realized case (the existing fixture join);
 * `proofCases` carries every pointed name so unbuilt intentions still show.
 */
export const deriveClaimRow = (
  riskId: string,
  description: string,
  pointedCases: ReadonlyArray<string>,
  realized: ReadonlySet<string>,
): RiskRow & { readonly proofCases: ReadonlyArray<string> } => {
  const realizedCases = pointedCases.filter((name) => realized.has(name));
  const coverage =
    realizedCases.length === 0 ? "gap" : realizedCases.length === pointedCases.length ? "covered" : "partial";
  return {
    riskId,
    family: riskFamily(riskId),
    description,
    coverage,
    ...(realizedCases[0] !== undefined ? { fixtureCase: realizedCases[0] } : {}),
    proofCases: pointedCases,
  };
};

/**
 * Projects parsed hypotheses into the SAME claim/risk row shape the
 * risk-map parser yields (`RiskMap.ts`'s `RiskRow`), so everything
 * downstream — index, server payload, viewer Eval tab, coverage tallies —
 * works unchanged whichever source won.
 */
export const claimRowsFromEvals = (
  hypotheses: ReadonlyArray<EvalsFailureHypothesis>,
  fixtureCaseNames: ReadonlyArray<string>,
): ReadonlyArray<RiskRow & { readonly proofCases: ReadonlyArray<string> }> => {
  const realized = new Set(fixtureCaseNames);
  return hypotheses.map((hypothesis) =>
    deriveClaimRow(
      hypothesis.id,
      hypothesis.failure,
      hypothesis.proofSpecs.map((spec) => spec.name),
      realized,
    ),
  );
};
