/**
 * The skill card's glance + "Next" chip derivations (issue #109, card
 * charter: display before derivation, derivation before automation). Pure
 * functions over the bundle-detail payload, no React -- unit-tested without
 * a browser, same split as `labOrder.ts`/`boardDoorway.ts`.
 *
 * Every derivation here is pinned to the CURRENT latest recorded version
 * (data-model.md §1.6's honest reset): a new version honestly empties the
 * proven-on list and re-opens the measurement chips. No pooling anywhere --
 * these read the already-unpooled measurement cells, never combine them.
 */
import type { FixtureRecord, MeasurementRecord, RiskCoverageRecord } from "./schemas.ts";

/**
 * Mirrors `@skillmaker/core`'s `Measurements.SMOKE_K` -- guidance surfaced
 * as data, not enforcement (a numeric threshold, not a vocabulary enum, so
 * no VocabLockstep row: nothing stored spells it). Below this n, a
 * fixture's measurement is a smoke signal, not an estimate.
 */
export const SMOKE_K = 5;

/**
 * The ONE pass-rate display policy for the card (issue #109 review): one
 * decimal place, e.g. "83.3%" -- shared by the Models table and the
 * per-fixture measurement chips so precision never drifts between the two.
 */
export const formatPassRate = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/**
 * The ONE CI display policy, matching `formatPassRate`'s precision: both
 * bounds to one decimal, comma-separated, e.g. "[43.8%, 100.0%]"; an em
 * dash when no interval exists (n = 0).
 */
export const formatCI = (ci: readonly [number, number] | null): string =>
  ci === null ? "—" : `[${formatPassRate(ci[0])}, ${formatPassRate(ci[1])}]`;

/** The exact display id for a measurement cell's provider(+model) -- never a marketing alias, always what the run recorded. */
export const providerModelId = (cell: { readonly provider: string; readonly model: string }): string =>
  cell.model.length > 0 && cell.model !== cell.provider ? `${cell.provider}/${cell.model}` : cell.provider;

/**
 * Providers (exact provider/model ids) with >=1 passing measurement at the
 * given version. `latestHash === undefined` (no version recorded) is an
 * honest empty list -- nothing is proven about unversioned content.
 */
export const provenOnProviders = (
  measurements: ReadonlyArray<MeasurementRecord>,
  latestHash: string | undefined,
): ReadonlyArray<string> => {
  if (latestHash === undefined) {
    return [];
  }
  return [
    ...new Set(
      measurements
        .filter((cell) => cell.versionHash === latestHash && cell.passes > 0)
        .map(providerModelId),
    ),
  ].sort();
};

export interface CoverageTally {
  readonly covered: number;
  readonly partial: number;
  readonly gap: number;
  /** Authored rows, `n/a` excluded -- rows the author judged inapplicable are not gaps. */
  readonly total: number;
}

/** The glance's coverage tally, in the risk map's authored words -- a count of judgments, never a pass rate. */
export const coverageTally = (rows: ReadonlyArray<RiskCoverageRecord>): CoverageTally => {
  let covered = 0;
  let partial = 0;
  let gap = 0;
  for (const row of rows) {
    if (row.coverage === "covered") covered += 1;
    else if (row.coverage === "partial") partial += 1;
    else if (row.coverage === "gap") gap += 1;
  }
  return { covered, partial, gap, total: covered + partial + gap };
};

export interface NextChip {
  readonly key: string;
  readonly label: string;
}

/**
 * The Overview's "Next" chips -- derivable-today gaps ONLY (no speculative
 * plays, no scoring): risks the author marked `gap`, fixtures whose best
 * cell at the latest version sits below the smoke threshold (or was never
 * measured), and configured providers with no measurement at the latest
 * version. With no version recorded at all, the one honest chip is to
 * record one -- nothing can be measured against unversioned content.
 */
export const nextChips = (input: {
  readonly riskCoverage: ReadonlyArray<RiskCoverageRecord>;
  readonly fixtures: ReadonlyArray<FixtureRecord>;
  readonly measurements: ReadonlyArray<MeasurementRecord>;
  readonly latestHash: string | undefined;
  readonly providers: ReadonlyArray<string>;
}): ReadonlyArray<NextChip> => {
  const chips: NextChip[] = [];

  for (const row of input.riskCoverage) {
    if (row.coverage === "gap") {
      chips.push({ key: `risk-${row.riskId}`, label: `Cover ${row.riskId} — authored "gap"` });
    }
  }

  if (input.latestHash === undefined) {
    if (input.fixtures.length > 0) {
      chips.push({ key: "no-version", label: "Record a version — measurements need one to pin to" });
    }
    return chips;
  }

  const atLatest = input.measurements.filter((cell) => cell.versionHash === input.latestHash);

  for (const fixture of input.fixtures) {
    const cells = atLatest.filter((cell) => cell.fixtureCase === fixture.caseName);
    if (cells.length === 0) {
      chips.push({ key: `fixture-${fixture.caseName}`, label: `Measure ${fixture.caseName} — not yet measured at this version` });
      continue;
    }
    const bestN = Math.max(...cells.map((cell) => cell.n));
    if (bestN < SMOKE_K) {
      chips.push({
        key: `fixture-${fixture.caseName}`,
        label: `Grow ${fixture.caseName} past smoke — best n=${bestN} of ${SMOKE_K}`,
      });
    }
  }

  const measuredProviders = new Set(atLatest.map((cell) => cell.provider));
  for (const provider of input.providers) {
    if (!measuredProviders.has(provider)) {
      chips.push({ key: `provider-${provider}`, label: `Run on ${provider} — unmeasured at this version` });
    }
  }

  return chips;
};
