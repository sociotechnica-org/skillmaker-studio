/**
 * Outbound manifest (issue #66, `Vision - Board Lab Port.md` §HOW): the
 * checkout half of the checkout/return-record primitive. Ships a specific
 * recorded version of a bundle -- appends `skill.shipped` with the
 * measurement receipts snapshotted at ship time. Mirrors `Publish.ts`'s
 * guard-then-append shape, but deliberately lighter: no stage guard (shipping
 * isn't gated behind `"published"`), no target-file writes, and drift is a
 * warning the caller surfaces, never a block (house rule, `Mechanism - Drift
 * Hint.md`: "displayed, never enforced").
 */
import { Effect } from "effect";
import type { Actor } from "./Actor.ts";
import { ShipNoVersionError, ShipVersionNotFoundError } from "./Errors.ts";
import { layer as IndexServiceLayer, IndexService } from "./IndexService.ts";
import { Journal } from "./JournalService.ts";
import type { ShipReceipt } from "./Journal.ts";
import {
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  resolveSkillVersion,
  type Drift,
  type SkillVersion,
} from "./Versions.ts";

export interface ShipBundleInput {
  readonly workspaceRoot: string;
  /** `<workspaceRoot>/<skillsDir>/<slug>`. */
  readonly bundleDir: string;
  readonly bundle: string;
  readonly destination: string;
  readonly purpose: string;
  readonly actor: Actor;
  /** A recorded version's hash or hash-prefix; defaults to the latest recorded version. */
  readonly versionHashPrefix?: string;
}

export interface ShipBundleResult {
  readonly versionHash: string;
  /** The recorded version's human label (e.g. "v2"), when one was given at `skillmaker version record` time. */
  readonly versionLabel?: string;
  readonly destination: string;
  readonly purpose: string;
  /** Live `design.md`/`output/` drift from the shipped version, at ship time -- surfaced as a warning by callers, never blocked on. */
  readonly drift: Drift;
  readonly receipts: ReadonlyArray<ShipReceipt>;
}

/**
 * Picks the version to ship via `resolveSkillVersion` (latest by default,
 * newest left-anchored hash-prefix match with `--version`), mapping the two
 * ways that can come up empty to ship's errors: `ShipNoVersionError` when
 * the bundle has never had a version recorded at all -- there is nothing to
 * ship (issue #66) -- and `ShipVersionNotFoundError` when versions exist but
 * a given `prefix` matches none of them.
 */
const resolveVersion = (
  versions: ReadonlyArray<SkillVersion>,
  bundle: string,
  prefix: string | undefined,
): Effect.Effect<SkillVersion, ShipNoVersionError | ShipVersionNotFoundError> => {
  const match = resolveSkillVersion(versions, prefix);
  if (match !== undefined) {
    return Effect.succeed(match);
  }
  return prefix !== undefined && versions.length > 0
    ? Effect.fail(ShipVersionNotFoundError.make({ bundle, prefix }))
    : Effect.fail(ShipNoVersionError.make({ bundle }));
};

/**
 * Aggregates this bundle's measurement cells for exactly the shipped
 * version -- the ship-time snapshot, never pooled across versions (data-model.md
 * §1.1 laws 5-6). Runs its own scratch `IndexService` layer, same pattern as
 * `Publish.ts`'s `gatherMeasurements`.
 */
const gatherReceipts = Effect.fn("Ship.gatherReceipts")(function* (
  workspaceRoot: string,
  bundle: string,
  versionHash: string,
) {
  const index = yield* IndexService;
  yield* index.rebuild();
  const measurements = yield* index.listMeasurements(bundle);
  const receipts: ReadonlyArray<ShipReceipt> = measurements
    .filter((measurement) => measurement.versionHash === versionHash)
    .map((measurement) => ({
      fixtureCase: measurement.fixtureCase,
      provider: measurement.provider,
      model: measurement.model,
      n: measurement.n,
      passes: measurement.passes,
      passRate: measurement.passRate,
      ci: measurement.ci,
    }));
  return receipts;
});

/**
 * Ships a bundle: resolves the version (default latest, or `--version
 * <prefix>`), computes live drift against it (informational only), snapshots
 * its measurement receipts, and appends `skill.shipped` -- no idempotency
 * key, so a repeat ship of the same version to the same destination is a
 * genuine second event.
 */
export const shipBundle = Effect.fn("Ship.shipBundle")(function* (input: ShipBundleInput) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const versions = foldSkillVersions(events).get(input.bundle) ?? [];

  const target = yield* resolveVersion(versions, input.bundle, input.versionHashPrefix);

  const layout = yield* detectBundleLayout(input.bundleDir);
  const current = yield* computeBundleHashes(input.bundleDir, layout);
  const drift = computeDrift(current, { designHash: target.designHash, hash: target.hash });

  const receipts = yield* gatherReceipts(input.workspaceRoot, input.bundle, target.hash).pipe(
    Effect.provide(IndexServiceLayer(input.workspaceRoot)),
  );

  yield* journal.append({
    type: "skill.shipped",
    actor: input.actor,
    payload: {
      bundle: input.bundle,
      versionHash: target.hash,
      destination: input.destination,
      purpose: input.purpose,
      receipts,
    },
  });

  const result: ShipBundleResult = {
    versionHash: target.hash,
    ...(target.label !== undefined ? { versionLabel: target.label } : {}),
    destination: input.destination,
    purpose: input.purpose,
    drift,
    receipts,
  };
  return result;
});
