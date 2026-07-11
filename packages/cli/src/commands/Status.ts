/**
 * `skillmaker status <slug>` — identity + fold state for one bundle, plus
 * its event history summary (plan.md Phase 2).
 */
import {
  type BundleRecord,
  bundleForEvent,
  type CoverageValue,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  shortHash,
  type VersionRecord,
  type WarningRecord,
  Workspace,
} from "@skillmaker/core";
import { Effect, Layer } from "effect";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface StatusOptions {
  readonly json: boolean;
}

interface CoverageSummary {
  readonly covered: number;
  readonly partial: number;
  readonly gap: number;
  readonly na: number;
}

interface StatusView {
  readonly bundle: BundleRecord;
  readonly eventCount: number;
  readonly lastEventType: string | undefined;
  readonly lastEventAt: string | undefined;
  readonly latestVersion: VersionRecord | undefined;
  readonly fixtureCount: number;
  readonly coverage: CoverageSummary;
  readonly warnings: ReadonlyArray<WarningRecord>;
}

const summarizeCoverage = (values: ReadonlyArray<CoverageValue>): CoverageSummary => {
  let covered = 0;
  let partial = 0;
  let gap = 0;
  let na = 0;
  for (const value of values) {
    if (value === "covered") covered++;
    else if (value === "partial") partial++;
    else if (value === "gap") gap++;
    else na++;
  }
  return { covered, partial, gap, na };
};

export const runStatus = Effect.fn("runStatus")(function* (
  cwd: string,
  slug: string | undefined,
  options: StatusOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker status: missing <slug>\n\nUsage: skillmaker status <slug>\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker status: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");

  const layers = Layer.mergeAll(IndexServiceLayer(resolved.root), JournalLayer(journalPath));

  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      const index = yield* IndexService;
      const journal = yield* Journal;

      // `getBundle`/`listVersions` read the SQLite index, which is only
      // rebuilt on `list`/`reindex`/`start` or on first bootstrap
      // (IndexService.ts) -- without an explicit rebuild here, `status`
      // could show a stage/drift/version snapshot stale by however long it's
      // been since one of those ran. Cheap at this scale (see rebuild()'s
      // own doc comment), so just always rebuild first.
      yield* index.rebuild();

      const bundle = yield* index.getBundle(slug);
      if (bundle === undefined) {
        return undefined;
      }

      const events = yield* journal.readAll();
      const bundleEvents = events.filter((event) => bundleForEvent(event) === slug);
      const lastEvent = bundleEvents.at(-1);

      const versions = yield* index.listVersions(slug);
      const fixtures = yield* index.listFixtures(slug);
      const riskCoverage = yield* index.listRiskCoverage(slug);
      const warnings = yield* index.listWarnings(slug);

      const view: StatusView = {
        bundle,
        eventCount: bundleEvents.length,
        lastEventType: lastEvent?.type,
        lastEventAt: lastEvent?.at,
        latestVersion: versions[0],
        fixtureCount: fixtures.length,
        coverage: summarizeCoverage(riskCoverage.map((row) => row.coverage)),
        warnings,
      };
      return view;
    }).pipe(Effect.provide(layers)),
  );

  if (outcome._tag === "Failure") {
    return expectedFailure(`skillmaker status: ${outcome.failure.message}\n`);
  }

  if (outcome.success === undefined) {
    return expectedFailure(`skillmaker status: no such bundle "${slug}"\n`);
  }

  return summarize(outcome.success, options.json);
});

const summarize = (view: StatusView, json: boolean): CliResult => {
  const { bundle, latestVersion } = view;
  if (json) {
    return ok(
      `${JSON.stringify({
        slug: bundle.slug,
        name: bundle.name,
        oneLiner: bundle.oneLiner,
        tags: bundle.tags,
        created: bundle.created,
        stage: bundle.stage,
        substate: bundle.substate,
        archived: bundle.archived,
        eventCount: view.eventCount,
        lastEventType: view.lastEventType ?? null,
        lastEventAt: view.lastEventAt ?? null,
        designHash: bundle.designHash,
        outputHash: bundle.outputHash,
        drift: bundle.drift,
        latestVersion:
          latestVersion !== undefined
            ? { hash: latestVersion.hash, label: latestVersion.label ?? null, recordedAt: latestVersion.recordedAt }
            : null,
        fixtureCount: view.fixtureCount,
        coverage: view.coverage,
        warnings: view.warnings.map((w) => ({ source: w.source, message: w.message })),
      })}\n`,
    );
  }

  const lines = [
    `slug:        ${bundle.slug}`,
    `name:        ${bundle.name}`,
    `one-liner:   ${bundle.oneLiner}`,
    `tags:        ${bundle.tags.join(", ")}`,
    `created:     ${bundle.created}`,
    `stage:       ${bundle.stage}`,
    `substate:    ${bundle.substate}`,
    `archived:    ${bundle.archived}`,
    `events:      ${view.eventCount}`,
    `last event:  ${view.lastEventType !== undefined ? `${view.lastEventType} at ${view.lastEventAt}` : "(none)"}`,
    `design:      ${shortHash(bundle.designHash)}`,
    `output:      ${shortHash(bundle.outputHash)}`,
    `drift:       ${bundle.drift}`,
    `version:     ${
      latestVersion !== undefined
        ? `${shortHash(latestVersion.hash)}${latestVersion.label !== undefined ? ` "${latestVersion.label}"` : ""} at ${latestVersion.recordedAt}`
        : "(none recorded)"
    }`,
    `fixtures:    ${view.fixtureCount}`,
    `coverage:    ${view.coverage.covered} covered, ${view.coverage.partial} partial, ${view.coverage.gap} gap${view.coverage.na > 0 ? `, ${view.coverage.na} n/a` : ""}`,
  ];
  if (view.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of view.warnings) {
      lines.push(`  [${warning.source}] ${warning.message}`);
    }
  }
  return ok(`${lines.join("\n")}\n`);
};
