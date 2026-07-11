/**
 * `skillmaker measurements <slug>` -- the CLI's read-out (data-model.md
 * §2.11): fixture | version(label, falling back to short hash) | provider |
 * n | pass rate | partial | fail | CI | guidance label, one row per
 * measurement cell. Mirrors the viewer's Evals tab chips; never pooled
 * across fixture/version/provider/model (§1.1 laws 5-6).
 *
 * Fix 3 (F5): PASS% is PASS-ONLY (`passes / n`) -- PARTIAL and FAIL are
 * their own columns, both counted in `n`'s denominator but never in PASS%'s
 * numerator, so a partial verdict is visible instead of disappearing from
 * the table (the friction-log bug this closes).
 */
import {
  guidanceForN,
  IndexService,
  IndexServiceLayer,
  SMOKE_K,
  versionLabel,
  type VersionRecord,
  Workspace,
  type MeasurementRecord,
} from "@skillmaker/core";
import { Effect } from "effect";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface MeasurementsOptions {
  readonly json: boolean;
}

export const runMeasurements = Effect.fn("runMeasurements")(function* (
  cwd: string,
  slug: string | undefined,
  options: MeasurementsOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker measurements: missing <slug>\n\nUsage: skillmaker measurements <slug>\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker measurements: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      const bundle = yield* index.getBundle(slug);
      if (bundle === undefined) {
        return undefined;
      }
      const measurements = yield* index.listMeasurements(slug);
      const versions = yield* index.listVersions(slug);
      return { measurements, versions };
    }).pipe(Effect.provide(IndexServiceLayer(resolved.root))),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker measurements: ${outcome.failure.message}\n`);
  }
  if (outcome.success === undefined) {
    return expectedFailure(`skillmaker measurements: no such bundle "${slug}"\n`);
  }

  return summarize(outcome.success.measurements, outcome.success.versions, options.json);
});

/** Fix 4 (F6): hash -> recorded VersionRecord, for resolving a version's human label at render time. */
const versionsByHash = (
  versions: ReadonlyArray<VersionRecord>,
): ReadonlyMap<string, VersionRecord> => new Map(versions.map((v) => [v.hash, v]));

const formatCi = (ci: MeasurementRecord["ci"]): string => {
  if (ci === null) return "-";
  const [lo, hi] = ci;
  return `[${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%]`;
};

const summarize = (
  measurements: ReadonlyArray<MeasurementRecord>,
  versions: ReadonlyArray<VersionRecord>,
  json: boolean,
): CliResult => {
  const byHash = versionsByHash(versions);

  if (json) {
    return ok(
      `${JSON.stringify({
        measurements: measurements.map((m) => ({
          ...m,
          // Fix 4 (F6): `versionLabel` alongside the raw `versionHash` --
          // the human label when one was recorded, else a short-hash
          // fallback. JSON keeps the raw hash too so callers needing the
          // full identity still have it.
          versionLabel: versionLabel(byHash.get(m.versionHash) ?? { hash: m.versionHash }),
          guidance: guidanceForN(m.n) ?? null,
        })),
      })}\n`,
    );
  }

  if (measurements.length === 0) {
    return ok("skillmaker: no measurements yet (no graded, completed runs for this bundle)\n");
  }

  const rows = measurements.map((m) => ({
    fixture: m.fixtureCase,
    version: versionLabel(byHash.get(m.versionHash) ?? { hash: m.versionHash }),
    provider: m.model !== "" && m.model !== m.provider ? `${m.provider}/${m.model}` : m.provider,
    n: String(m.n),
    // Fix 3 (F5): pass rate stays PASS-ONLY (passes / n) -- partial and fail
    // both count toward `n`'s denominator but never this numerator. Shown
    // as their own columns below so partials never vanish from the table.
    passRate: `${(m.passRate * 100).toFixed(0)}%`,
    partial: String(m.partial),
    fail: String(m.fail),
    ci: formatCi(m.ci),
    guidance: guidanceForN(m.n) ?? "(below smoke)",
  }));

  const columns = [
    ["FIXTURE", "fixture"],
    ["VERSION", "version"],
    ["PROVIDER", "provider"],
    ["N", "n"],
    ["PASS%", "passRate"],
    ["PARTIAL", "partial"],
    ["FAIL", "fail"],
    ["CI", "ci"],
    ["GUIDANCE", "guidance"],
  ] as const;

  const widths = columns.map(([header, key]) =>
    Math.max(header.length, ...rows.map((row) => row[key].length)),
  );

  const formatRow = (cells: ReadonlyArray<string>): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");

  const lines = [
    formatRow(columns.map(([header]) => header)),
    ...rows.map((row) => formatRow(columns.map(([, key]) => row[key]))),
  ];

  // The `(below smoke)` guidance label is otherwise unexplained in CLI
  // output (Phase 20 Story 4 friction log finding #6) -- make it
  // self-describing right where it renders, instead of only in the docs.
  if (rows.some((row) => row.guidance === "(below smoke)")) {
    lines.push(
      `\n(below smoke): n < ${SMOKE_K} -- below the smoke threshold, collect more runs before trusting this cell`,
    );
  }

  return ok(`${lines.join("\n")}\n`);
};
