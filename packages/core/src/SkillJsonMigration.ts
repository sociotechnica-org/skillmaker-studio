/**
 * THROWAWAY: the pure transform behind scripts/migrate-skill-json.ts (legacy
 * per-bundle files → `skill.json` schemaVersion 2, THE MERGE). This module
 * lives inside core only so the throwaway migration script and its tests
 * typecheck inside core's tsc program — delete it together with
 * scripts/migrate-skill-json.ts after the real bundles migrate.
 */
import type { EvalsFailureHypothesis } from "./EvalsJson.ts";
import type { RiskRow } from "./RiskMap.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** Everything the pure transform consumes — outputs of the SHIPPED core readers plus raw case.json objects, no I/O. */
export interface LegacyBundleSnapshot {
  /** Parsed bundle.json (raw object — unknown fields noted, not carried). */
  readonly bundleJson: Record<string, unknown>;
  /** `parseEvalsJson`'s hypotheses, when the root evals.json parsed. */
  readonly evalsHypotheses?: ReadonlyArray<EvalsFailureHypothesis>;
  /** `parseRiskMap`'s rows, when evals/risk-map.md exists (the claims fallback). Coverage is dropped on purpose — it's DERIVED in v2. `fixtureCase` is absent on gap rows. */
  readonly riskMapRows?: ReadonlyArray<
    Pick<RiskRow, "riskId" | "description"> & Partial<Pick<RiskRow, "fixtureCase">>
  >;
  /** `evals/fixtures/<dir>/case.json` contents by directory name (undefined value = dir without a case.json). */
  readonly caseJsons: ReadonlyMap<string, unknown>;
  /** Declared stage folded from the journal; defaults to "idea". */
  readonly stage?: string;
}

export interface BuildResult {
  /** The skill.json document, ready to stringify. */
  readonly doc: Record<string, unknown>;
  /** Human-readable notes about judgment calls the transform made. */
  readonly notes: ReadonlyArray<string>;
}

interface MutableHypothesis {
  id: string;
  failure: string;
  probability?: string;
  impact?: string;
  mustNever?: string;
  cases: string[];
}

interface MutableCase {
  name: string;
  class?: string;
  setup?: string;
  expectedBehavior?: string;
  expected?: string;
  checks?: ReadonlyArray<string>;
  sandbox?: Record<string, unknown>;
  source?: unknown;
}

/** The one legacy answer-key path that becomes the v2 default `expected.md`. */
const LEGACY_ANSWER_KEY = "expected/answer-key.md";

/**
 * Pure: the core readers' outputs in, skill.json (schemaVersion 2) document
 * out. Never throws on defective input — it migrates what it can and notes
 * the rest (the tolerant reader on the other side warns about anything odd).
 */
export const buildSkillJsonDocument = (snapshot: LegacyBundleSnapshot): BuildResult => {
  const notes: string[] = [];
  const b = snapshot.bundleJson;

  // ---- skill (identity) ----
  const slug = asString(b.slug) ?? "";
  if (slug === "") {
    notes.push("bundle.json has no usable slug — skill.slug written empty (fix by hand)");
  }
  const skill: Record<string, unknown> = {
    slug,
    name: typeof b.name === "string" ? b.name : "",
    oneLiner: typeof b.oneLiner === "string" ? b.oneLiner : "",
    tags: stringArray(b.tags),
    created: typeof b.created === "string" ? b.created : "",
    // Renamed: bundle.json "targets" (agent platforms) → "harnesses".
    harnesses: stringArray(b.targets),
    stage: snapshot.stage ?? "idea",
  };

  // ---- design (claims) ----
  const hypotheses: MutableHypothesis[] = [];
  const hypothesisById = new Map<string, MutableHypothesis>();
  // proofSpec prose keyed by case name, to merge onto the case entries.
  const proseByCase = new Map<string, { setup?: string; expectedBehavior?: string }>();
  const caseOrder: string[] = [];
  const rememberCase = (name: string): void => {
    if (!caseOrder.includes(name)) {
      caseOrder.push(name);
    }
  };

  if (snapshot.evalsHypotheses !== undefined) {
    for (const entry of snapshot.evalsHypotheses) {
      const hypothesis: MutableHypothesis = {
        id: entry.id,
        failure: entry.failure,
        ...(entry.probability !== undefined ? { probability: entry.probability } : {}),
        ...(entry.impact !== undefined ? { impact: entry.impact } : {}),
        ...(entry.mustNever !== undefined ? { mustNever: entry.mustNever } : {}),
        cases: [],
      };
      for (const spec of entry.proofSpecs) {
        if (!hypothesis.cases.includes(spec.name)) {
          hypothesis.cases.push(spec.name);
        }
        rememberCase(spec.name);
        if (!proseByCase.has(spec.name)) {
          proseByCase.set(spec.name, {
            ...(spec.setup !== undefined ? { setup: spec.setup } : {}),
            ...(spec.expectedBehavior !== undefined ? { expectedBehavior: spec.expectedBehavior } : {}),
          });
        }
      }
      hypotheses.push(hypothesis);
      hypothesisById.set(entry.id, hypothesis);
    }
  } else if (snapshot.riskMapRows !== undefined) {
    // No evals.json: the legacy risk-map's rows ARE the claims — absorbed
    // here (and the file deleted) so a migrated bundle loses nothing.
    notes.push("no evals.json — claims absorbed from evals/risk-map.md");
    for (const row of snapshot.riskMapRows) {
      if (hypothesisById.has(row.riskId)) continue;
      const hypothesis: MutableHypothesis = {
        id: row.riskId,
        failure: row.description,
        cases: row.fixtureCase !== undefined ? [row.fixtureCase] : [],
      };
      if (row.fixtureCase !== undefined) rememberCase(row.fixtureCase);
      hypotheses.push(hypothesis);
      hypothesisById.set(row.riskId, hypothesis);
    }
  }

  // ---- evals.cases (definitions) — proofSpec names ∪ case dirs ----
  for (const name of [...snapshot.caseJsons.keys()].sort()) {
    rememberCase(name);
  }

  const cases: MutableCase[] = [];
  for (const name of caseOrder) {
    const caseEntry: MutableCase = { name };
    const prose = proseByCase.get(name);
    if (prose?.setup !== undefined) caseEntry.setup = prose.setup;
    if (prose?.expectedBehavior !== undefined) caseEntry.expectedBehavior = prose.expectedBehavior;

    const rawCaseJson = snapshot.caseJsons.get(name);
    if (isRecord(rawCaseJson)) {
      const klass = asString(rawCaseJson.class);
      if (klass !== undefined) caseEntry.class = klass;

      // Reverse the legacy case→risk edge onto the hypotheses (v2's only
      // edge is hypothesis→case).
      for (const riskId of stringArray(rawCaseJson.risks)) {
        const hypothesis = hypothesisById.get(riskId);
        if (hypothesis !== undefined) {
          if (!hypothesis.cases.includes(name)) hypothesis.cases.push(name);
        } else {
          const stub: MutableHypothesis = { id: riskId, failure: "", cases: [name] };
          hypotheses.push(stub);
          hypothesisById.set(riskId, stub);
          notes.push(
            `case "${name}" pointed at risk "${riskId}" which no claims source describes — stub hypothesis written (fill in its failure description)`,
          );
        }
      }

      // Old setup {files, env} → sandbox (v2's `setup` is prose).
      if (isRecord(rawCaseJson.setup)) {
        const sandbox: Record<string, unknown> = {};
        if (asString(rawCaseJson.setup.files) !== undefined) sandbox.files = rawCaseJson.setup.files;
        if (isRecord(rawCaseJson.setup.env)) sandbox.env = rawCaseJson.setup.env;
        if (Object.keys(sandbox).length > 0) caseEntry.sandbox = sandbox;
      }

      if (isRecord(rawCaseJson.grading)) {
        const checks = rawCaseJson.grading.checks;
        if (Array.isArray(checks) && checks.length > 0) caseEntry.checks = stringArray(checks);
        const answerKey = asString(rawCaseJson.grading.answerKey);
        if (answerKey !== undefined && answerKey !== LEGACY_ANSWER_KEY) {
          // A non-conventional answer key stays authored verbatim; the
          // conventional one becomes the v2 default (`expected.md`, moved on
          // disk) and is omitted.
          caseEntry.expected = answerKey;
        }
      }

      if (rawCaseJson.source !== undefined) caseEntry.source = rawCaseJson.source;

      if (typeof rawCaseJson.prompt === "string") {
        notes.push(
          `case "${name}" has a legacy case.json "prompt" string — not migrated (the prompt lives in prompt.md); copy it by hand if prompt.md is missing`,
        );
      }
    } else if (rawCaseJson !== undefined) {
      notes.push(`case "${name}" has a malformed case.json — migrated as a bare case entry`);
    }
    cases.push(caseEntry);
  }

  // ---- assemble ----
  const doc: Record<string, unknown> = {
    schemaVersion: 2,
    skill,
    design: { failureHypotheses: hypotheses.map((h) => ({ ...h })) },
    evals: { cases: cases.map((c) => ({ ...c })), configs: [] },
  };
  const publishTargets = b.publishTargets;
  if (Array.isArray(publishTargets)) {
    doc.publish = { targets: publishTargets };
  }
  return { doc, notes };
};
