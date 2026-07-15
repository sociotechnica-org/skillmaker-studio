/**
 * `skillmaker ship <slug> --to <destination> --purpose <text> [--version
 * <hash-prefix>] [--json]` -- the outbound half of the checkout/return-record
 * primitive (issue #66, `Vision - Board Lab Ship Receive.md` §HOW). Ships the
 * latest recorded version by default (or the version matching `--version`'s
 * hash prefix), appending `skill.shipped` with its measurement receipts
 * snapshotted at ship time. Errors if the bundle has no recorded version at
 * all -- nothing to ship. Warns, but never blocks, when the live
 * `design.md`/`output/` content has drifted from the shipped version (house
 * rule, `Mechanism - Drift Hint.md`: drift is displayed, never enforced).
 */
import {
  Actor,
  shipBundle,
  shortHash,
  JournalLayer,
  Workspace,
  type ShipBundleResult,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface ShipOptions {
  readonly json: boolean;
  readonly to?: string;
  readonly purpose?: string;
  readonly version?: string;
}

export const runShip = Effect.fn("runShip")(function* (
  cwd: string,
  slug: string | undefined,
  options: ShipOptions,
) {
  const usage =
    "Usage: skillmaker ship <slug> --to <destination> --purpose <text> [--version <hash-prefix>]\n";

  if (slug === undefined) {
    return usageError(`skillmaker ship: missing <slug>\n\n${usage}`);
  }
  if (options.to === undefined || options.to.length === 0) {
    return usageError(`skillmaker ship: missing --to <destination>\n\n${usage}`);
  }
  if (options.purpose === undefined || options.purpose.length === 0) {
    return usageError(`skillmaker ship: missing --purpose <text>\n\n${usage}`);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker ship: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker ship: no such bundle "${slug}"\n`);
  }

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor: Actor = yield* resolveUserActor();

  const outcome = yield* shipBundle({
    workspaceRoot: resolved.root,
    bundleDir,
    bundle: slug,
    destination: options.to,
    purpose: options.purpose,
    actor,
    ...(options.version !== undefined ? { versionHashPrefix: options.version } : {}),
  }).pipe(
    Effect.provide(JournalLayer(journalPath)),
    Effect.map((result) => ({ kind: "ok" as const, result })),
    Effect.catchTag("ShipNoVersionError", () =>
      Effect.succeed({ kind: "no_version" as const }),
    ),
    Effect.catchTag("ShipVersionNotFoundError", (error) =>
      Effect.succeed({ kind: "version_not_found" as const, prefix: error.prefix }),
    ),
  );

  if (outcome.kind === "no_version") {
    return expectedFailure(
      `skillmaker ship: bundle "${slug}" has never had a version recorded ("skillmaker version record" first) -- there is nothing to ship\n`,
    );
  }
  if (outcome.kind === "version_not_found") {
    return expectedFailure(
      `skillmaker ship: no recorded version of "${slug}" matches --version "${outcome.prefix}"\n`,
    );
  }

  return summarize(slug, outcome.result, options.json);
});

const summarize = (slug: string, result: ShipBundleResult, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        status: "shipped",
        slug,
        versionHash: result.versionHash,
        versionLabel: result.versionLabel ?? null,
        destination: result.destination,
        purpose: result.purpose,
        drift: result.drift,
        receiptCount: result.receipts.length,
      })}\n`,
    );
  }

  const versionText = `${shortHash(result.versionHash)}${
    result.versionLabel !== undefined ? ` ("${result.versionLabel}")` : ""
  }`;
  const lines = [
    `skillmaker: shipped ${slug} version ${versionText} to "${result.destination}" for "${result.purpose}"`,
    `  receipts: ${result.receipts.length} measurement cell(s) snapshotted`,
  ];
  if (result.drift !== "in-sync") {
    lines.push(
      `  warning: live design.md/output/ content has drifted from the shipped version (drift: "${result.drift}") -- consider recording a new version`,
    );
  }
  return ok(`${lines.join("\n")}\n`);
};
