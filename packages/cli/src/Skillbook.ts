/**
 * The Skillbook (data-model.md §2.14): "a generator over existing facts" --
 * per-skill chapters from `design.md`, measurement receipts, and a journal
 * changelog. This module is the ONE data-aggregation entry point shared by
 * `skillmaker book build` (packages/cli/src/commands/BookBuild.ts, renders
 * to a static site) and the server's `GET /api/skillbook`
 * (packages/cli/src/server/Server.ts, renders live in the viewer) -- "one
 * generator over existing facts... rendered two ways."
 */
import {
  bundleForEvent,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  shortHash,
  type MeasurementRecord,
  type ShipReceipt,
  type VersionRecord,
  type WorkspaceConfig,
} from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { join } from "node:path";

export interface SkillbookChangelogEntry {
  readonly type: "version" | "published" | "gate" | "shipped";
  readonly at: string;
  readonly summary: string;
}

/**
 * One `skill.shipped` event, materialized for the Port (issue #66): "where
 * is this in the world" -- destination, purpose, the version that left, and
 * the receipts it shipped with, frozen at that moment (never re-derived from
 * today's measurements).
 */
export interface SkillbookShipment {
  readonly at: string;
  readonly versionHash: string;
  readonly destination: string;
  readonly purpose: string;
  readonly receipts: ReadonlyArray<ShipReceipt>;
}

export interface SkillbookBundle {
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly stage: string;
  /** Raw `design.md` content; empty string if the bundle has none. */
  readonly designMarkdown: string;
  readonly latestVersion: VersionRecord | null;
  /** Never pooled (data-model.md §1.1 laws 5-6) -- one cell per {fixture, version, provider, model}. */
  readonly measurements: ReadonlyArray<MeasurementRecord>;
  /** Versions/publishes/gates/shipments, newest first. */
  readonly changelog: ReadonlyArray<SkillbookChangelogEntry>;
  /** Every `skill.shipped` event for this bundle, newest first (issue #66: "where is this in the world"). */
  readonly shipments: ReadonlyArray<SkillbookShipment>;
}

export interface SkillbookData {
  readonly workspaceName: string;
  readonly bundles: ReadonlyArray<SkillbookBundle>;
}

/**
 * Builds the whole Skillbook: one aggregate pass over the index (rebuilt
 * first, same as every other read endpoint) + a full journal read + a
 * `design.md` read per bundle. Requires `IndexService` and `Journal` in its
 * environment -- `loadSkillbook` below is the concrete entry point that
 * provides both against a workspace root.
 */
export const buildSkillbook = Effect.fn("Skillbook.build")(function* (
  root: string,
  config: WorkspaceConfig,
) {
  const index = yield* IndexService;
  yield* index.rebuild();
  const bundleRecords = yield* index.listBundles();

  const journal = yield* Journal;
  const events = yield* journal.readAll();

  const fs = yield* FileSystem;
  const path = yield* Path;

  const bundles: SkillbookBundle[] = [];
  for (const bundle of bundleRecords) {
    const versions = yield* index.listVersions(bundle.slug);
    const measurements = yield* index.listMeasurements(bundle.slug);

    const designPath = path.join(root, config.skillsDir, bundle.slug, "design.md");
    const designExists = yield* fs.exists(designPath);
    const designMarkdown = designExists ? yield* fs.readFileString(designPath) : "";

    const bundleEvents = events.filter((event) => bundleForEvent(event) === bundle.slug);
    const changelog: SkillbookChangelogEntry[] = [];
    const shipments: SkillbookShipment[] = [];
    for (const event of bundleEvents) {
      if (event.type === "skill.version_recorded") {
        const labelSuffix = event.payload.label !== undefined ? ` ("${event.payload.label}")` : "";
        changelog.push({
          type: "version",
          at: event.at,
          summary: `Version ${shortHash(event.payload.hash)}${labelSuffix} recorded`,
        });
      } else if (event.type === "skill.published") {
        const urlSuffix = event.payload.url !== undefined ? ` -> ${event.payload.url}` : "";
        changelog.push({
          type: "published",
          at: event.at,
          summary: `Published ${shortHash(event.payload.versionHash)} to "${event.payload.target}"${urlSuffix}`,
        });
      } else if (event.type === "bundle.gate_decided") {
        changelog.push({
          type: "gate",
          at: event.at,
          summary: `Publish gate ${event.payload.decision}: ${event.payload.basis}`,
        });
      } else if (event.type === "skill.shipped") {
        changelog.push({
          type: "shipped",
          at: event.at,
          summary: `Shipped ${shortHash(event.payload.versionHash)} to "${event.payload.destination}" for "${event.payload.purpose}"`,
        });
        shipments.push({
          at: event.at,
          versionHash: event.payload.versionHash,
          destination: event.payload.destination,
          purpose: event.payload.purpose,
          receipts: event.payload.receipts,
        });
      }
    }
    changelog.sort((a, b) => b.at.localeCompare(a.at));
    shipments.sort((a, b) => b.at.localeCompare(a.at));

    bundles.push({
      slug: bundle.slug,
      name: bundle.name,
      oneLiner: bundle.oneLiner,
      stage: bundle.stage,
      designMarkdown,
      latestVersion: versions[0] ?? null,
      measurements,
      changelog,
      shipments,
    });
  }

  const data: SkillbookData = { workspaceName: config.name, bundles };
  return data;
});

/** Concrete entry point: provides `IndexService` + `Journal` for `root` and runs `buildSkillbook`. */
export const loadSkillbook = (root: string, config: WorkspaceConfig): Promise<SkillbookData> => {
  const journalPath = join(root, ".skillmaker", "events.jsonl");
  const layer = Layer.provideMerge(
    Layer.merge(IndexServiceLayer(root), JournalLayer(journalPath)),
    BunServices.layer,
  );
  return Effect.runPromise(buildSkillbook(root, config).pipe(Effect.provide(layer)));
};
