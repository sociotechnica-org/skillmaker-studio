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
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { Actor } from "./Actor.ts";
import {
  PublishGuardError,
  PublishTargetNotFoundError,
  UnknownPublishTargetKindError,
  WorkspaceIOError,
} from "./Errors.ts";
import { foldBundleStates } from "./Fold.ts";
import type { JournalEvent } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { computeBundleHashes, computeDrift, foldSkillVersions, latestSkillVersion } from "./Versions.ts";
import type { PublishTarget } from "./Workspace.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export interface PublishGuardResult {
  readonly bundle: string;
  readonly versionHash: string;
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

  const current = yield* computeBundleHashes(bundleDir);
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

  const result: PublishGuardResult = { bundle, versionHash: latest.hash };
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
  readonly pluginName: string;
  readonly skillPath: string;
}

/**
 * Emits/updates `.claude-plugin/marketplace.json`
 * (claude-marketplace-spec.md): a single skills-only plugin entry named
 * `"skills"`, `source: "./"`, whose `skills` array accumulates every
 * published bundle's output-dir path (deduped, order-preserving). Every
 * other top-level/plugin field already on disk is preserved verbatim.
 */
export const publishClaudeMarketplace = Effect.fn("Publish.publishClaudeMarketplace")(function* (
  target: PublishTarget,
  workspaceRoot: string,
  workspaceName: string,
  outputRelativePath: string,
) {
  const path = yield* Path;
  const base = target.path ?? workspaceRoot;
  const manifestPath = path.join(base, ".claude-plugin", "marketplace.json");

  const existing = yield* readJsonRecord(manifestPath);

  const marketplaceName = readStringField(existing, "name") ?? kebabCase(workspaceName);
  const existingOwner = existing["owner"];
  const owner: JsonRecord = isJsonRecord(existingOwner) ? existingOwner : { name: workspaceName };

  const pluginsRaw = existing["plugins"];
  const plugins: JsonRecord[] = Array.isArray(pluginsRaw) ? pluginsRaw.filter(isJsonRecord) : [];

  const pluginName = "skills";
  const pluginIndex = plugins.findIndex((entry) => readStringField(entry, "name") === pluginName);
  const existingPlugin = pluginIndex === -1 ? undefined : plugins[pluginIndex];
  const existingSkills = existingPlugin?.["skills"];
  const skills = isStringArray(existingSkills) ? [...existingSkills] : [];
  if (!skills.includes(outputRelativePath)) {
    skills.push(outputRelativePath);
  }
  const updatedPlugin: JsonRecord = {
    source: "./",
    ...(existingPlugin ?? {}),
    name: pluginName,
    skills,
  };
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
  const result: ClaudeMarketplacePublishResult = { manifestPath, pluginName, skillPath: outputRelativePath };
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

const publishToTarget = Effect.fn("Publish.publishToTarget")(function* (
  workspaceRoot: string,
  bundleDir: string,
  bundle: string,
  workspaceName: string,
  target: PublishTarget,
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
      const result = yield* publishClaudeMarketplace(target, workspaceRoot, workspaceName, relOutput);
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
