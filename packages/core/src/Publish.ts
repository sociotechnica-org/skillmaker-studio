/**
 * Publish targets (data-model.md §2.14; strategy-skills-repo-mode.md §4):
 * ship a published Skill Bundle's `output/` to configured destinations and
 * record `skill.published` per target (data-model.md §2.9). v1 kinds:
 *
 *   - `git-dir` {path}: copy the bundle's `output/` -> `<path>/<slug>/`.
 *   - `claude-marketplace` {path?}: emit/update `.claude-plugin/marketplace.json`
 *     (docs/research/2026-07-11-competitive-scan/claude-marketplace-spec.md)
 *     -- one skills-only plugin entry whose `skills` array accumulates every
 *     published bundle's output dir (the spec's "simplest valid shape").
 *   - `codex-marketplace` {path?}: emit/update `.codex-plugin/plugin.json` +
 *     `.agents/plugins/marketplace.json`
 *     (docs/research/2026-07-11-competitive-scan/codex-skills-marketplace.md
 *     -- flagged there as less precisely documented than Claude's; this
 *     module's marketplace.json shape is a best-effort, lossless-round-trip
 *     guess, not a verified spec).
 *
 * Guard (data-model.md §2.7, §2.13): only a bundle at stage `"published"`
 * (which the machine only reaches via an approved publish-gate decision --
 * `Machine.ts`) whose live `design.md`/`output/` content is `"in-sync"` with
 * its latest recorded `skill.version_recorded` can be published -- otherwise
 * the thing being shipped was never actually recorded as a version.
 *
 * Manifest updates preserve every unknown top-level/nested field already
 * present on disk (the "adopt" principle, strategy-skills-repo-mode.md §3B):
 * this module only ever adds/merges the specific fields it owns.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { Actor } from "./Actor.ts";
import { BundleIdentity } from "./Bundle.ts";
import {
  PublishGuardError,
  PublishTargetNotFoundError,
  UnknownPublishTargetKindError,
  WorkspaceIOError,
} from "./Errors.ts";
import { foldBundleStates } from "./Fold.ts";
import { layer as IndexServiceLayer, IndexService } from "./IndexService.ts";
import type { JournalEvent } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { confidenceInterval, guidanceForN, type MeasurementRecord } from "./Measurements.ts";
import {
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  latestSkillVersion,
  shortHash,
} from "./Versions.ts";
import type { PublishTarget } from "./Workspace.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export interface PublishGuardResult {
  readonly bundle: string;
  readonly versionHash: string;
  /** The recorded version's human label (e.g. "v2"), when one was given at `skillmaker version record` time. */
  readonly versionLabel?: string;
}

/**
 * The publish guard: stage must be `"published"`, and the latest recorded
 * version must be in-sync with the live content. Reuses `Versions.ts`'s
 * hashing/drift functions and `Fold.ts`'s state fold -- this module never
 * reimplements either.
 */
export const checkPublishable = Effect.fn("Publish.checkPublishable")(function* (
  bundleDir: string,
  bundle: string,
  events: ReadonlyArray<JournalEvent>,
) {
  const states = foldBundleStates(events);
  const stage = states.get(bundle)?.stage ?? "idea";
  if (stage !== "published") {
    return yield* Effect.fail(
      PublishGuardError.make({
        bundle,
        reason: `bundle "${bundle}" is at stage "${stage}", not "published" -- publish requires the bundle to have completed the publish gate`,
      }),
    );
  }

  const layout = yield* detectBundleLayout(bundleDir);
  const current = yield* computeBundleHashes(bundleDir, layout);
  const versions = foldSkillVersions(events).get(bundle);
  const latest = latestSkillVersion(versions);
  const drift = computeDrift(current, latest);

  if (latest === undefined) {
    return yield* Effect.fail(
      PublishGuardError.make({
        bundle,
        reason: `bundle "${bundle}" has never had a version recorded ("skillmaker version record" first)`,
      }),
    );
  }

  if (drift !== "in-sync") {
    return yield* Effect.fail(
      PublishGuardError.make({
        bundle,
        reason: `bundle "${bundle}"'s live design.md/output/ content has drifted from its latest recorded version (drift: "${drift}") -- record a new version before publishing`,
      }),
    );
  }

  const result: PublishGuardResult = {
    bundle,
    versionHash: latest.hash,
    ...(latest.label !== undefined ? { versionLabel: latest.label } : {}),
  };
  return result;
});

// ---------------------------------------------------------------------------
// JSON manifest helpers (lossless unknown-field preservation)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const readStringField = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const EMPTY_JSON_RECORD: JsonRecord = {};

const parseJson = (raw: string): unknown => JSON.parse(raw);

const readJsonRecord = Effect.fn("Publish.readJsonRecord")(function* (filePath: string) {
  const fs = yield* FileSystem;
  const exists = yield* fs.exists(filePath).pipe(Effect.mapError(toIOError(`could not check ${filePath}`)));
  if (!exists) {
    return EMPTY_JSON_RECORD;
  }
  const raw = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError(toIOError(`could not read ${filePath}`)));
  const parsed = yield* Effect.try({
    try: () => parseJson(raw),
    catch: toIOError(`invalid JSON in ${filePath}`),
  });
  return isJsonRecord(parsed) ? parsed : EMPTY_JSON_RECORD;
});

const writeJsonRecord = Effect.fn("Publish.writeJsonRecord")(function* (
  filePath: string,
  record: JsonRecord,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const dir = path.dirname(filePath);
  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(toIOError(`could not create ${dir}`)));
  yield* fs
    .writeFileString(filePath, `${JSON.stringify(record, undefined, 2)}\n`)
    .pipe(Effect.mapError(toIOError(`could not write ${filePath}`)));
});

const kebabCase = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

const normalizeRelative = (relPath: string): string => {
  const forward = relPath.split("\\").join("/");
  return forward.startsWith(".") || forward.startsWith("/") ? forward : `./${forward}`;
};

// ---------------------------------------------------------------------------
// git-dir
// ---------------------------------------------------------------------------

export interface GitDirPublishResult {
  readonly url: string;
}

/** Copies the bundle's `output/` -> `<target.path>/<bundle>/` (`cp -r` semantics, overwrite-in-place). */
export const publishGitDir = Effect.fn("Publish.publishGitDir")(function* (
  outputDir: string,
  target: PublishTarget,
  bundle: string,
) {
  if (target.path === undefined) {
    return yield* Effect.fail(
      WorkspaceIOError.make({
        message: `publish target "${target.id}" (kind "git-dir") requires a "path"`,
      }),
    );
  }
  const fs = yield* FileSystem;
  const path = yield* Path;
  const dest = path.join(target.path, bundle);
  yield* fs
    .makeDirectory(path.dirname(dest), { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${path.dirname(dest)}`)));
  yield* fs
    .copy(outputDir, dest, { overwrite: true })
    .pipe(Effect.mapError(toIOError(`could not copy ${outputDir} -> ${dest}`)));
  const result: GitDirPublishResult = { url: dest };
  return result;
});

// ---------------------------------------------------------------------------
// claude-marketplace
// ---------------------------------------------------------------------------

export interface ClaudeMarketplacePublishResult {
  readonly manifestPath: string;
  readonly readmePath: string;
  readonly pluginName: string;
  readonly skillPath: string;
}

/** Everything `publishClaudeMarketplace` needs about the bundle being published, beyond its output path (friction log finding #4). */
export interface ClaudeMarketplaceBundleInfo {
  /** The bundle's slug -- also the per-bundle plugin's `name` in the manifest. */
  readonly slug: string;
  readonly name: string;
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly versionHash: string;
  /** The human label given at `skillmaker version record` time (e.g. `"v2"`), when there is one. */
  readonly versionLabel?: string;
  /** This bundle's measurement cells (data-model.md §2.11) -- feeds the README's receipts section. */
  readonly measurements: ReadonlyArray<MeasurementRecord>;
}

/** Marker prefix on every field this module owns inside a plugin entry -- never hand-authored, always safe to overwrite/regenerate. */
const RECEIPTS_FIELD = "skillmakerReceipts";

interface StoredReceipts {
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly version: { readonly label: string; readonly hash: string };
  readonly measurements: ReadonlyArray<{
    readonly provider: string;
    readonly model: string;
    readonly fixtureCase: string;
    readonly n: number;
    readonly passes: number;
    readonly passRate: number;
    readonly ci: readonly [number, number] | null;
  }>;
}

const isStoredReceipts = (value: unknown): value is StoredReceipts => isJsonRecord(value);

const formatCiPercent = (ci: readonly [number, number] | null): string => {
  if (ci === null) return "-";
  const [lo, hi] = ci;
  return `[${(lo * 100).toFixed(0)}%, ${(hi * 100).toFixed(0)}%]`;
};

/** Aggregates a bundle's measurement cells for its LATEST published version into one line per provider ("n · rate · CI per provider", friction log finding #4). Never mutates the underlying never-pooled `MeasurementRecord`s -- this is display-only rollup for the storefront README. */
const receiptsByProvider = (
  measurements: ReadonlyArray<StoredReceipts["measurements"][number]>,
): ReadonlyArray<{ provider: string; n: number; passes: number; passRate: number; ci: readonly [number, number] | null; guidance: string }> => {
  const byProvider = new Map<string, { n: number; passes: number }>();
  for (const cell of measurements) {
    const key = cell.model !== "" && cell.model !== cell.provider ? `${cell.provider}/${cell.model}` : cell.provider;
    const existing = byProvider.get(key) ?? { n: 0, passes: 0 };
    existing.n += cell.n;
    existing.passes += cell.passes;
    byProvider.set(key, existing);
  }
  return [...byProvider.entries()].map(([provider, agg]) => ({
    provider,
    n: agg.n,
    passes: agg.passes,
    passRate: agg.n === 0 ? 0 : agg.passes / agg.n,
    ci: confidenceInterval(agg.passes, agg.n),
    guidance: guidanceForN(agg.n) ?? "below smoke",
  }));
};

const readmePluginSection = (pluginName: string, description: string | undefined, receipts: StoredReceipts | undefined): string => {
  const lines: string[] = [`### ${pluginName}`, ""];
  if (receipts !== undefined) {
    lines.push(receipts.oneLiner || description || "_(no description)_", "");
    lines.push(`- **Version:** ${receipts.version.label} (\`${shortHash(receipts.version.hash)}\`)`);
    if (receipts.tags.length > 0) {
      lines.push(`- **Tags:** ${receipts.tags.join(", ")}`);
    }
    if (receipts.measurements.length === 0) {
      lines.push("- **Measurements:** _no graded runs yet_");
    } else {
      lines.push("- **Measurements:**");
      for (const row of receiptsByProvider(receipts.measurements)) {
        lines.push(
          `  - **${row.provider}**: n=${row.n}, ${(row.passRate * 100).toFixed(0)}% pass, CI ${formatCiPercent(row.ci)} (${row.guidance})`,
        );
      }
    }
  } else {
    lines.push(description ?? "_(no description)_");
  }
  lines.push("");
  return lines.join("\n");
};

/**
 * Builds the marketplace README (the repo IS the storefront, friction log
 * finding #4): one section per plugin entry in `plugins`, richest for the
 * ones this module manages (carrying a `skillmakerReceipts` payload:
 * oneLiner, tags, version label+hash, and per-provider measurement
 * receipts), a plain name+description fallback for any hand-authored
 * plugin entries this module doesn't own. Regenerated in full on every
 * publish from the manifest's own (already lossless-round-tripped) data --
 * never hand-edited, never stale.
 */
const buildMarketplaceReadme = (marketplaceName: string, ownerName: string, plugins: ReadonlyArray<JsonRecord>): string => {
  const header = [`# ${marketplaceName}`, "", `Published by ${ownerName}.`, "", "## Skills", ""];
  const sections = plugins.map((entry) => {
    const name = readStringField(entry, "name") ?? "(unnamed plugin)";
    const description = readStringField(entry, "description");
    const receiptsRaw = entry[RECEIPTS_FIELD];
    const receipts = isStoredReceipts(receiptsRaw) ? receiptsRaw : undefined;
    return readmePluginSection(name, description, receipts);
  });
  return `${[...header, ...sections].join("\n").trimEnd()}\n`;
};

/**
 * Emits/updates `.claude-plugin/marketplace.json` (claude-marketplace-spec.md)
 * and refreshes the marketplace README storefront alongside it. Each
 * published bundle gets its OWN plugin entry (`name` = the bundle's slug,
 * `source` = the bundle's output dir) carrying `description` (the bundle's
 * oneLiner), `version` (the recorded label, falling back to a short hash),
 * and `keywords` (the bundle's tags) -- friction log finding #4: before
 * this, every bundle collapsed into one generically-named `"skills"` plugin
 * with no description or human version. A `skillmakerReceipts` field (this
 * module's own, ignored by Claude Code's loader per the spec's "unrecognized
 * fields ignored" rule) carries the measurement data the README renders, so
 * the README can be regenerated in full from the manifest alone on every
 * publish. Every other top-level/plugin field already on disk -- including
 * unrelated hand-authored plugin entries -- is preserved verbatim.
 */
export const publishClaudeMarketplace = Effect.fn("Publish.publishClaudeMarketplace")(function* (
  target: PublishTarget,
  workspaceRoot: string,
  workspaceName: string,
  outputRelativePath: string,
  bundleInfo?: ClaudeMarketplaceBundleInfo,
) {
  const path = yield* Path;
  const base = target.path ?? workspaceRoot;
  const manifestPath = path.join(base, ".claude-plugin", "marketplace.json");
  const readmePath = path.join(base, "README.md");

  const existing = yield* readJsonRecord(manifestPath);

  const marketplaceName = readStringField(existing, "name") ?? kebabCase(workspaceName);
  const existingOwner = existing["owner"];
  const owner: JsonRecord = isJsonRecord(existingOwner) ? existingOwner : { name: workspaceName };
  const ownerName = readStringField(owner, "name") ?? workspaceName;

  const pluginsRaw = existing["plugins"];
  const plugins: JsonRecord[] = Array.isArray(pluginsRaw) ? pluginsRaw.filter(isJsonRecord) : [];

  // Back-compat: a pre-fix manifest may still carry the old shared "skills"
  // plugin entry (a `skills: string[]` accumulator, no per-bundle identity).
  // Leave it exactly as found -- it round-trips like any other unowned
  // entry -- new publishes only ever create/update per-bundle entries keyed
  // by slug.
  const pluginName = bundleInfo?.slug ?? "skills";
  const pluginIndex = plugins.findIndex((entry) => readStringField(entry, "name") === pluginName);
  const existingPlugin = pluginIndex === -1 ? undefined : plugins[pluginIndex];

  let updatedPlugin: JsonRecord;
  if (bundleInfo === undefined) {
    // No bundle metadata given (e.g. a direct call without richness data) --
    // fall back to the old bare accumulator shape for compatibility.
    const existingSkills = existingPlugin?.["skills"];
    const skills = isStringArray(existingSkills) ? [...existingSkills] : [];
    if (!skills.includes(outputRelativePath)) {
      skills.push(outputRelativePath);
    }
    updatedPlugin = { source: "./", ...(existingPlugin ?? {}), name: pluginName, skills };
  } else {
    const versionLabel = bundleInfo.versionLabel ?? shortHash(bundleInfo.versionHash);
    const receipts: StoredReceipts = {
      oneLiner: bundleInfo.oneLiner,
      tags: bundleInfo.tags,
      version: { label: versionLabel, hash: bundleInfo.versionHash },
      measurements: bundleInfo.measurements
        .filter((m) => m.versionHash === bundleInfo.versionHash)
        .map((m) => ({
          provider: m.provider,
          model: m.model,
          fixtureCase: m.fixtureCase,
          n: m.n,
          passes: m.passes,
          passRate: m.passRate,
          ci: m.ci,
        })),
    };
    updatedPlugin = {
      ...(existingPlugin ?? {}),
      name: pluginName,
      source: outputRelativePath,
      description: bundleInfo.oneLiner,
      version: versionLabel,
      keywords: [...bundleInfo.tags],
      [RECEIPTS_FIELD]: receipts,
    };
  }

  if (pluginIndex === -1) {
    plugins.push(updatedPlugin);
  } else {
    plugins[pluginIndex] = updatedPlugin;
  }

  const updated: JsonRecord = {
    ...existing,
    name: marketplaceName,
    owner,
    plugins,
  };

  yield* writeJsonRecord(manifestPath, updated);

  const fs = yield* FileSystem;
  const readme = buildMarketplaceReadme(marketplaceName, ownerName, plugins);
  yield* fs
    .writeFileString(readmePath, readme)
    .pipe(Effect.mapError(toIOError(`could not write ${readmePath}`)));

  const result: ClaudeMarketplacePublishResult = {
    manifestPath,
    readmePath,
    pluginName,
    skillPath: outputRelativePath,
  };
  return result;
});

// ---------------------------------------------------------------------------
// codex-marketplace
// ---------------------------------------------------------------------------

export interface CodexMarketplacePublishResult {
  readonly pluginManifestPath: string;
  readonly marketplaceManifestPath: string;
}

/**
 * Emits/updates `.codex-plugin/plugin.json` (this workspace's own plugin
 * manifest, `skills` array accumulating every published bundle's output
 * dir) and registers this workspace as a local marketplace source in
 * `.agents/plugins/marketplace.json`. The marketplace.json shape here is a
 * best-effort minimal guess (codex-skills-marketplace.md flags Codex's
 * exact registration schema as not fully documented) -- kept deliberately
 * small (`marketplaces: [{name, source}]`) and lossless on unknown fields
 * so it can be corrected later without losing hand-edits.
 */
export const publishCodexMarketplace = Effect.fn("Publish.publishCodexMarketplace")(function* (
  target: PublishTarget,
  workspaceRoot: string,
  workspaceName: string,
  outputRelativePath: string,
) {
  const path = yield* Path;
  const base = target.path ?? workspaceRoot;
  const pluginManifestPath = path.join(base, ".codex-plugin", "plugin.json");
  const marketplaceManifestPath = path.join(base, ".agents", "plugins", "marketplace.json");

  const existingPlugin = yield* readJsonRecord(pluginManifestPath);
  const pluginName = readStringField(existingPlugin, "name") ?? kebabCase(workspaceName);
  const existingSkills = existingPlugin["skills"];
  const skills = isStringArray(existingSkills) ? [...existingSkills] : [];
  if (!skills.includes(outputRelativePath)) {
    skills.push(outputRelativePath);
  }
  const updatedPlugin: JsonRecord = {
    ...existingPlugin,
    name: pluginName,
    skills,
  };
  yield* writeJsonRecord(pluginManifestPath, updatedPlugin);

  const existingMarketplace = yield* readJsonRecord(marketplaceManifestPath);
  const marketplacesRaw = existingMarketplace["marketplaces"];
  const marketplaces: JsonRecord[] = Array.isArray(marketplacesRaw) ? marketplacesRaw.filter(isJsonRecord) : [];
  const marketplaceName = kebabCase(workspaceName);
  const alreadyRegistered = marketplaces.some((entry) => readStringField(entry, "name") === marketplaceName);
  if (!alreadyRegistered) {
    marketplaces.push({ name: marketplaceName, source: { type: "local", path: "." } });
  }
  const updatedMarketplace: JsonRecord = {
    ...existingMarketplace,
    marketplaces,
  };
  yield* writeJsonRecord(marketplaceManifestPath, updatedMarketplace);

  const result: CodexMarketplacePublishResult = { pluginManifestPath, marketplaceManifestPath };
  return result;
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Best-effort read of `<bundleDir>/bundle.json`'s identity fields; never fails publish -- a missing/malformed bundle.json just yields a minimal fallback identity. */
const readBundleIdentity = (bundleDir: string, bundle: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const bundleJsonPath = path.join(bundleDir, "bundle.json");
    const raw = yield* fs.readFileString(bundleJsonPath);
    const parsed = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (cause) => cause });
    return yield* Schema.decodeUnknownEffect(BundleIdentity)(parsed);
  }).pipe(
    Effect.orElseSucceed(() =>
      BundleIdentity.make({
        schemaVersion: 1,
        slug: bundle,
        name: bundle,
        oneLiner: "",
        tags: [],
        created: "",
        targets: [],
      }),
    ),
  );

/** Best-effort read of this bundle's measurement cells via a scratch `IndexService` layer; never fails publish -- an index rebuild problem just yields an empty receipts section. */
const gatherMeasurements = (workspaceRoot: string, bundle: string) =>
  Effect.gen(function* () {
    const index = yield* IndexService;
    yield* index.rebuild();
    return yield* index.listMeasurements(bundle);
  }).pipe(
    Effect.provide(IndexServiceLayer(workspaceRoot)),
    Effect.orElseSucceed((): ReadonlyArray<MeasurementRecord> => []),
  );

const publishToTarget = Effect.fn("Publish.publishToTarget")(function* (
  workspaceRoot: string,
  bundleDir: string,
  bundle: string,
  workspaceName: string,
  target: PublishTarget,
  guard: PublishGuardResult,
) {
  const path = yield* Path;
  const outputDir = path.join(bundleDir, "output");

  switch (target.kind) {
    case "git-dir": {
      const result = yield* publishGitDir(outputDir, target, bundle);
      return result.url;
    }
    case "claude-marketplace": {
      const base = target.path ?? workspaceRoot;
      const relOutput = normalizeRelative(path.relative(base, outputDir));
      const identity = yield* readBundleIdentity(bundleDir, bundle);
      const measurements = yield* gatherMeasurements(workspaceRoot, bundle);
      const result = yield* publishClaudeMarketplace(target, workspaceRoot, workspaceName, relOutput, {
        slug: bundle,
        name: identity.name,
        oneLiner: identity.oneLiner,
        tags: identity.tags,
        versionHash: guard.versionHash,
        ...(guard.versionLabel !== undefined ? { versionLabel: guard.versionLabel } : {}),
        measurements,
      });
      return result.manifestPath;
    }
    case "codex-marketplace": {
      const base = target.path ?? workspaceRoot;
      const relOutput = normalizeRelative(path.relative(base, outputDir));
      const result = yield* publishCodexMarketplace(target, workspaceRoot, workspaceName, relOutput);
      return result.pluginManifestPath;
    }
    default:
      return yield* Effect.fail(
        UnknownPublishTargetKindError.make({ target: target.id, kind: target.kind }),
      );
  }
});

export interface PublishTargetResult {
  readonly target: string;
  readonly kind: string;
  readonly status: "published" | "already_published";
  readonly url?: string;
}

export interface PublishBundleResult {
  readonly bundle: string;
  readonly versionHash: string;
  readonly results: ReadonlyArray<PublishTargetResult>;
}

export interface PublishBundleInput {
  readonly workspaceRoot: string;
  /** `<workspaceRoot>/<skillsDir>/<slug>`. */
  readonly bundleDir: string;
  readonly bundle: string;
  readonly workspaceName: string;
  readonly targets: ReadonlyArray<PublishTarget>;
  /** Restrict to these target ids; `undefined` publishes to every configured target. */
  readonly targetIds?: ReadonlyArray<string>;
  readonly actor: Actor;
}

/**
 * Runs the publish guard, then publishes to the selected targets (default:
 * every configured target) and appends `skill.published` per target,
 * idempotent on `(bundle, versionHash, target)` -- a re-publish of the same
 * version to the same target is a no-op journal append, but manifest/file
 * writes still run (they are themselves idempotent: same content in, same
 * content out).
 */
export const publishBundle = Effect.fn("Publish.publishBundle")(function* (input: PublishBundleInput) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();

  const guard = yield* checkPublishable(input.bundleDir, input.bundle, events);

  if (input.targetIds !== undefined) {
    for (const id of input.targetIds) {
      if (!input.targets.some((target) => target.id === id)) {
        return yield* Effect.fail(PublishTargetNotFoundError.make({ target: id }));
      }
    }
  }

  const selected =
    input.targetIds === undefined
      ? input.targets
      : input.targets.filter((target) => input.targetIds?.includes(target.id) === true);

  const results: PublishTargetResult[] = [];
  for (const target of selected) {
    const url = yield* publishToTarget(
      input.workspaceRoot,
      input.bundleDir,
      input.bundle,
      input.workspaceName,
      target,
      guard,
    );
    const appendResult = yield* journal.append({
      type: "skill.published",
      actor: input.actor,
      idempotencyKey: `skill.published:${input.bundle}:${guard.versionHash}:${target.id}`,
      payload: {
        bundle: input.bundle,
        versionHash: guard.versionHash,
        target: target.id,
        ...(url !== undefined ? { url } : {}),
      },
    });
    results.push({
      target: target.id,
      kind: target.kind,
      status: appendResult.status === "appended" ? "published" : "already_published",
      ...(url !== undefined ? { url } : {}),
    });
  }

  const result: PublishBundleResult = { bundle: input.bundle, versionHash: guard.versionHash, results };
  return result;
});
