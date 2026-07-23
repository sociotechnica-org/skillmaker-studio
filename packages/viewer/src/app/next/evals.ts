/**
 * Pure mapping logic for the claim-first Evals tree (IA doc §C, ruled
 * 2026-07-22): fixtures hang under the claims they probe (rule 2, the
 * `case.json.risks` join), model is a column never a level (rule 4),
 * version is a pivot never a level (rule 5), and gaps mint tasks (rule 7).
 * No React, no fetch -- unit-tested like `../runtime/cardGlance.ts`.
 */
import type { Claim, ClaimStatus, EvalMeasurement, EvalRun } from "./types.ts";

/**
 * Rule 5's two pivot positions: measurements pinned to the latest recorded
 * version (default -- the honest "does the current draft hold?") vs every
 * measurement ever. Published-version compare is deliberately deferred.
 */
export type VersionScope = "latest" | "all";

/**
 * Rule 4's per-model cell vocabulary: `proven` (>=1 pass in scope),
 * `failing` (measured in scope, zero passes), `stale` (measured only
 * outside the pinned version), `unmeasured` (no cells for this claim's
 * fixtures on this model at all). Under the "all" pivot `stale` cannot
 * occur -- everything counts.
 */
export type ModelChipStatus = "proven" | "failing" | "stale" | "unmeasured";

export type ModelChip = {
  readonly model: string;
  readonly status: ModelChipStatus;
};

/**
 * The fixtures probing one claim (rule 2): `case.json.risks` is THE join.
 * The risk map's authored `fixtureCase` column is honored as a fallback for
 * rows whose named fixture doesn't declare the risk back -- the dual-write
 * drift §C rule 10 wants killed, still displayed honestly while it exists.
 */
export const claimFixtureCases = (
  riskId: string,
  fixtures: ReadonlyArray<{ readonly caseName: string; readonly risks: ReadonlyArray<string> }>,
  coverageFixtureCase: string | undefined,
): ReadonlyArray<string> => {
  const cases = fixtures.filter((f) => f.risks.includes(riskId)).map((f) => f.caseName);
  return coverageFixtureCase !== undefined && !cases.includes(coverageFixtureCase)
    ? [...cases, coverageFixtureCase]
    : cases;
};

/** Rule 2's flag: evidence without a claim -- fixtures whose `risks` name no known claim id. */
export const unclaimedFixtureCases = (
  fixtures: ReadonlyArray<{ readonly caseName: string; readonly risks: ReadonlyArray<string> }>,
  claimIds: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const ids = new Set(claimIds);
  return fixtures.filter((f) => !f.risks.some((r) => ids.has(r))).map((f) => f.caseName);
};

/** Every model with a measurement cell on the bundle, sorted -- the chip column's population. Display names, not raw stored strings (caller strips via `modelDisplayName`). */
export const bundleModels = (measurements: ReadonlyArray<EvalMeasurement>): ReadonlyArray<string> =>
  [...new Set(measurements.map((m) => m.model))].sort();

/**
 * One claim row's per-model status chips (rule 4). `latestVersionHash ===
 * null` under the "latest" pivot means nothing is pinned, so nothing is in
 * scope: measured cells honestly degrade to `stale`, never `proven`.
 */
export const modelChipsForClaim = (input: {
  readonly measurements: ReadonlyArray<EvalMeasurement>;
  readonly fixtureCases: ReadonlyArray<string>;
  readonly scope: VersionScope;
  readonly latestVersionHash: string | null;
  readonly models: ReadonlyArray<string>;
}): ReadonlyArray<ModelChip> => {
  const cases = new Set(input.fixtureCases);
  const forClaim = input.measurements.filter((m) => cases.has(m.fixtureCase));
  return input.models.map((model) => {
    const mine = forClaim.filter((m) => m.model === model);
    const scoped =
      input.scope === "all"
        ? mine
        : input.latestVersionHash === null
          ? []
          : mine.filter((m) => m.versionHash === input.latestVersionHash);
    const status: ModelChipStatus = scoped.some((m) => m.passes > 0)
      ? "proven"
      : scoped.some((m) => m.n > 0)
        ? "failing"
        : mine.some((m) => m.n > 0)
          ? "stale"
          : "unmeasured";
    return { model, status };
  });
};

/**
 * The claim dot/pill under the version pivot (rules 5+6): authored `gap`/
 * `partial` judgments stand (they are about coverage, not measurement);
 * a covered claim is `proven` only when some model chip is, else
 * `unmeasured` -- "not yet measured" as the default texture.
 */
export const claimStatusInScope = (base: ClaimStatus, chips: ReadonlyArray<ModelChip>): ClaimStatus =>
  base === "gap" || base === "partial" ? base : chips.some((c) => c.status === "proven") ? "proven" : "unmeasured";

/** Rule 3: runs hang under fixtures, newest first. */
export const runsForFixture = (runs: ReadonlyArray<EvalRun>, caseName: string): ReadonlyArray<EvalRun> =>
  runs.filter((r) => r.fixtureCase === caseName).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));

/** The claim sentence's budget inside a minted todo title -- titles are one-line handles, the claim row keeps the full sentence. */
export const GAP_TITLE_SENTENCE_MAX = 72;

export type GapTodoPayload = {
  readonly todo: {
    readonly id: string;
    readonly kind: "eval";
    readonly status: "open";
    readonly title: string;
    readonly detail: string;
    readonly priority: number;
    readonly bundle: string;
    readonly created: string;
    readonly source: { readonly kind: "user"; readonly name: string };
  };
};

/**
 * Rule 7's minting door: the `todo.opened` payload for "no fixture -- add
 * to Tasks". Same wire shape as the old app's Queue add form (Queue.tsx):
 * `kind: "eval"` at its default priority 15, `source` = the viewer, and NO
 * `origin` -- an origin-less eval todo is exactly what `renderOrigin`
 * renders as "gap · <bundle>". `id`/`created` are caller-generated
 * (`td-<uuid>` / YYYY-MM-DD) so the builder stays pure.
 */
export const buildGapTodoPayload = (input: {
  readonly riskId: string;
  readonly sentence: string;
  readonly bundle: string;
  readonly id: string;
  readonly created: string;
}): GapTodoPayload => {
  const sentence = input.sentence.trim();
  const trimmed =
    sentence.length > GAP_TITLE_SENTENCE_MAX
      ? `${sentence.slice(0, GAP_TITLE_SENTENCE_MAX - 1).trimEnd()}…`
      : sentence;
  return {
    todo: {
      id: input.id,
      kind: "eval",
      status: "open",
      title: `Cover ${input.riskId}: ${trimmed}`,
      detail: `Coverage gap: no fixture covers ${input.riskId}.`,
      // DEFAULT_PRIORITY_BY_KIND.eval (data-model.md §2.10).
      priority: 15,
      bundle: input.bundle,
      created: input.created,
      source: { kind: "user", name: "viewer" },
    },
  };
};

/**
 * A fixture's one-line prompt summary for the accordion: the first
 * non-heading line of `prompt.md`, falling back to the scaffold-era
 * `case.json` prompt, then `context`. `null` = no prompt authored yet, an
 * honest gap.
 */
export const promptSummary = (detail: {
  readonly promptMd: string | null;
  readonly legacyPrompt: string | null;
  readonly context: string | null;
}): string | null => {
  const text = detail.promptMd ?? detail.legacyPrompt ?? detail.context;
  if (text === null) return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  if (line === undefined) return null;
  return line.length > 160 ? `${line.slice(0, 159).trimEnd()}…` : line;
};

/** Claims grouped by family in first-appearance order (rule 1: grouped by Input / Reasoning / Output / Adversarial / Chain). */
export const groupClaimsByFamily = (
  claims: ReadonlyArray<Claim>,
): ReadonlyArray<{ readonly family: string; readonly claims: ReadonlyArray<Claim> }> => {
  const order: string[] = [];
  const byFamily = new Map<string, Claim[]>();
  for (const claim of claims) {
    const bucket = byFamily.get(claim.family);
    if (bucket === undefined) {
      order.push(claim.family);
      byFamily.set(claim.family, [claim]);
    } else {
      bucket.push(claim);
    }
  }
  return order.map((family) => ({ family, claims: byFamily.get(family) ?? [] }));
};
