import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import type { BundleStage } from "../src/Bundle.ts";
import type { JournalEvent } from "../src/Journal.ts";
import {
  BundleGateDecidedEvent,
  BundleStageChangedEvent,
  ReviewResolvedEvent,
  SkillVersionRecordedEvent,
} from "../src/Journal.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import {
  checkPublishable,
  publishBundle,
  publishClaudeMarketplace,
  publishCodexMarketplace,
  publishGitDir,
} from "../src/Publish.ts";
import { computeBundleHashes } from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let seq = 0;
const at = (): string => new Date(2026, 0, 1, 0, 0, seq++).toISOString();

const stageChanged = (bundle: string, from: BundleStage, to: BundleStage, reason?: string): JournalEvent =>
  BundleStageChangedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "bundle.stage_changed",
    payload: { bundle, from, to, ...(reason !== undefined ? { reason } : {}) },
  });

const reviewResolved = (bundle: string, state: BundleStage): JournalEvent =>
  ReviewResolvedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "review.resolved",
    payload: { bundle, state, decision: "approve" },
  });

const gateDecided = (bundle: string, decision: "approved" | "declined", basis: string): JournalEvent =>
  BundleGateDecidedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "bundle.gate_decided",
    payload: { bundle, gate: "publish", decision, basis },
  });

const versionRecorded = (bundle: string, hash: string, designHash: string, label?: string): JournalEvent =>
  SkillVersionRecordedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "skill.version_recorded",
    payload: { bundle, hash, designHash, ...(label !== undefined ? { label } : {}) },
  });

/** Advances `bundle` from "idea" all the way to "published", via the same approve+gate path Machine.ts requires. */
const publishedEvents = (bundle: string): ReadonlyArray<JournalEvent> => [
  reviewResolved(bundle, "idea"),
  stageChanged(bundle, "idea", "researching"),
  reviewResolved(bundle, "researching"),
  stageChanged(bundle, "researching", "drafting"),
  reviewResolved(bundle, "drafting"),
  stageChanged(bundle, "drafting", "evaluating"),
  reviewResolved(bundle, "evaluating"),
  gateDecided(bundle, "approved", "measured 20/20 passes"),
  stageChanged(bundle, "evaluating", "published"),
];

const writeBundle = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(join(dir, "output"), { recursive: true });
    yield* fs.writeFileString(join(dir, "design.md"), "# Demo\n\nA demo skill.\n");
    yield* fs.writeFileString(join(dir, "output", "SKILL.md"), "# Demo skill\n\nDo the thing.\n");
  });

describe("checkPublishable", () => {
  test("rejects a bundle that has never left \"idea\"", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const outcome = yield* checkPublishable(dir, "demo", []).pipe(Effect.flip);
        if (outcome._tag !== "PublishGuardError") {
          throw new Error(`expected PublishGuardError, got ${outcome._tag}`);
        }
        expect(outcome.reason).toContain('stage "idea"');
      }),
    );
  });

  test("rejects a published bundle with no recorded version", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const outcome = yield* checkPublishable(dir, "demo", publishedEvents("demo")).pipe(Effect.flip);
        if (outcome._tag !== "PublishGuardError") {
          throw new Error(`expected PublishGuardError, got ${outcome._tag}`);
        }
        expect(outcome.reason).toContain("never had a version recorded");
      }),
    );
  });

  test("rejects a published bundle whose live content has drifted from the recorded version", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const events = [...publishedEvents("demo"), versionRecorded("demo", "sha256:stale", "sha256:stale")];
        const outcome = yield* checkPublishable(dir, "demo", events).pipe(Effect.flip);
        if (outcome._tag !== "PublishGuardError") {
          throw new Error(`expected PublishGuardError, got ${outcome._tag}`);
        }
        expect(outcome.reason).toContain("drifted");
      }),
    );
  });

  test("accepts a published bundle whose recorded version matches live content", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const { designHash, outputHash } = yield* computeBundleHashes(dir);
        const events = [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)];
        const result = yield* checkPublishable(dir, "demo", events);
        expect(result.bundle).toBe("demo");
        expect(result.versionHash).toBe(outputHash);
      }),
    );
  });
});

describe("publishGitDir", () => {
  test("copies output/ -> <path>/<bundle>/", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const fs = yield* FileSystem;
        const destRoot = join(dir, "published-repo");
        const result = yield* publishGitDir(join(dir, "output"), { id: "repo", kind: "git-dir", path: destRoot }, "demo");
        expect(result.url).toBe(join(destRoot, "demo"));
        const copied = yield* fs.readFileString(join(destRoot, "demo", "SKILL.md"));
        expect(copied).toContain("Do the thing.");
      }),
    );
  });

  test("re-publish overwrites in place (idempotent content)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* writeBundle(dir);
        const fs = yield* FileSystem;
        const destRoot = join(dir, "published-repo");
        const target = { id: "repo", kind: "git-dir", path: destRoot };
        yield* publishGitDir(join(dir, "output"), target, "demo");
        yield* fs.writeFileString(join(dir, "output", "SKILL.md"), "# Demo skill\n\nDo the updated thing.\n");
        yield* publishGitDir(join(dir, "output"), target, "demo");
        const copied = yield* fs.readFileString(join(destRoot, "demo", "SKILL.md"));
        expect(copied).toContain("updated");
      }),
    );
  });

  test("requires a path", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const outcome = yield* publishGitDir(join(dir, "output"), { id: "repo", kind: "git-dir" }, "demo").pipe(
          Effect.flip,
        );
        expect(outcome._tag).toBe("WorkspaceIOError");
      }),
    );
  });
});

describe("publishClaudeMarketplace", () => {
  test("emits the exact marketplace.json shape (claude-marketplace-spec.md)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
        );
        const raw = yield* fs.readFileString(result.manifestPath);
        const manifest = JSON.parse(raw) as {
          name: string;
          owner: { name: string };
          plugins: ReadonlyArray<{ name: string; source: string; skills: ReadonlyArray<string> }>;
        };
        expect(manifest.name).toBe("demo-studio");
        expect(manifest.owner).toEqual({ name: "Demo Studio" });
        expect(manifest.plugins).toHaveLength(1);
        expect(manifest.plugins[0]?.name).toBe("skills");
        expect(manifest.plugins[0]?.source).toBe("./");
        expect(manifest.plugins[0]?.skills).toEqual(["./skills/demo/output"]);
      }),
    );
  });

  test("accumulates a second published bundle's skill path without duplicating the first", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
        );
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/second/output",
        );
        const raw = yield* fs.readFileString(result.manifestPath);
        const manifest = JSON.parse(raw) as { plugins: ReadonlyArray<{ skills: ReadonlyArray<string> }> };
        expect(manifest.plugins[0]?.skills).toEqual(["./skills/demo/output", "./skills/second/output"]);

        // Re-publishing the same skill path again is a no-op, not a duplicate.
        const again = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
        );
        const rawAgain = yield* fs.readFileString(again.manifestPath);
        const manifestAgain = JSON.parse(rawAgain) as { plugins: ReadonlyArray<{ skills: ReadonlyArray<string> }> };
        expect(manifestAgain.plugins[0]?.skills).toEqual(["./skills/demo/output", "./skills/second/output"]);
      }),
    );
  });

  test("losslessly round-trips unknown top-level and plugin fields already on disk", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const manifestPath = join(dir, ".claude-plugin", "marketplace.json");
        yield* fs.makeDirectory(join(dir, ".claude-plugin"), { recursive: true });
        yield* fs.writeFileString(
          manifestPath,
          JSON.stringify(
            {
              $schema: "https://example.com/marketplace.schema.json",
              name: "demo-studio",
              owner: { name: "Demo Studio", email: "studio@example.com" },
              metadata: { pluginRoot: "./plugins" },
              plugins: [
                {
                  name: "skills",
                  source: "./",
                  skills: ["./skills/demo/output"],
                  description: "hand-authored description",
                },
                { name: "other-plugin", source: "./other" },
              ],
            },
            undefined,
            2,
          ),
        );

        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/second/output",
        );
        const raw = yield* fs.readFileString(result.manifestPath);
        const manifest = JSON.parse(raw) as {
          $schema: string;
          owner: { email: string };
          metadata: { pluginRoot: string };
          plugins: ReadonlyArray<{ name: string; description?: string; skills?: ReadonlyArray<string> }>;
        };
        expect(manifest.$schema).toBe("https://example.com/marketplace.schema.json");
        expect(manifest.owner.email).toBe("studio@example.com");
        expect(manifest.metadata.pluginRoot).toBe("./plugins");
        expect(manifest.plugins).toHaveLength(2);
        const skillsPlugin = manifest.plugins.find((entry) => entry.name === "skills");
        expect(skillsPlugin?.description).toBe("hand-authored description");
        expect(skillsPlugin?.skills).toEqual(["./skills/demo/output", "./skills/second/output"]);
        expect(manifest.plugins.some((entry) => entry.name === "other-plugin")).toBe(true);
      }),
    );
  });
});

describe("publishCodexMarketplace", () => {
  test("emits plugin.json and marketplace.json (best-effort shape)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const result = yield* publishCodexMarketplace(
          { id: "codex", kind: "codex-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
        );
        const plugin = JSON.parse(yield* fs.readFileString(result.pluginManifestPath)) as {
          name: string;
          skills: ReadonlyArray<string>;
        };
        expect(plugin.name).toBe("demo-studio");
        expect(plugin.skills).toEqual(["./skills/demo/output"]);

        const marketplace = JSON.parse(yield* fs.readFileString(result.marketplaceManifestPath)) as {
          marketplaces: ReadonlyArray<{ name: string; source: { type: string; path: string } }>;
        };
        expect(marketplace.marketplaces).toEqual([{ name: "demo-studio", source: { type: "local", path: "." } }]);
      }),
    );
  });

  test("losslessly round-trips unknown fields on both manifests", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const pluginPath = join(dir, ".codex-plugin", "plugin.json");
        yield* fs.makeDirectory(join(dir, ".codex-plugin"), { recursive: true });
        yield* fs.writeFileString(
          pluginPath,
          JSON.stringify({ name: "demo-studio", version: "1.2.3", author: "Demo Team", skills: [] }, undefined, 2),
        );

        const marketplacePath = join(dir, ".agents", "plugins", "marketplace.json");
        yield* fs.makeDirectory(join(dir, ".agents", "plugins"), { recursive: true });
        yield* fs.writeFileString(
          marketplacePath,
          JSON.stringify({ marketplaces: [], notes: "hand-authored" }, undefined, 2),
        );

        const result = yield* publishCodexMarketplace(
          { id: "codex", kind: "codex-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
        );
        const plugin = JSON.parse(yield* fs.readFileString(result.pluginManifestPath)) as {
          version: string;
          author: string;
          skills: ReadonlyArray<string>;
        };
        expect(plugin.version).toBe("1.2.3");
        expect(plugin.author).toBe("Demo Team");
        expect(plugin.skills).toEqual(["./skills/demo/output"]);

        const marketplace = JSON.parse(yield* fs.readFileString(result.marketplaceManifestPath)) as {
          notes: string;
        };
        expect(marketplace.notes).toBe("hand-authored");
      }),
    );
  });
});

describe("publishBundle", () => {
  test("guards, publishes to every configured target, and appends skill.published per target", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const seedEvents = [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)];

        const targets = [
          { id: "repo", kind: "git-dir", path: join(dir, "published-repo") },
          { id: "claude", kind: "claude-marketplace" },
        ];

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seedEvents) {
            yield* journal.append(event);
          }
          return yield* publishBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            workspaceName: "Demo Studio",
            targets,
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(outcome.versionHash).toBe(outputHash);
        expect(outcome.results).toHaveLength(2);
        expect(outcome.results.map((entry) => entry.status)).toEqual(["published", "published"]);

        // Re-publish: same version, same targets -> idempotent no-op journal appends.
        const second = yield* Effect.gen(function* () {
          return yield* publishBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            workspaceName: "Demo Studio",
            targets,
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(second.results.map((entry) => entry.status)).toEqual(["already_published", "already_published"]);

        const fs = yield* FileSystem;
        const events = JSON.parse(
          `[${(yield* fs.readFileString(journalPath)).trim().split("\n").join(",")}]`,
        ) as ReadonlyArray<{ type: string }>;
        const publishedEventCount = events.filter((event) => event.type === "skill.published").length;
        expect(publishedEventCount).toBe(2);
      }),
    );
  });

  test("rejects a not-yet-published bundle with PublishGuardError, targets untouched", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const targets = [{ id: "repo", kind: "git-dir", path: join(dir, "published-repo") }];

        const outcome = yield* publishBundle({
          workspaceRoot: dir,
          bundleDir,
          bundle: "demo",
          workspaceName: "Demo Studio",
          targets,
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("PublishGuardError");
        const fs = yield* FileSystem;
        const repoDirExists = yield* fs.exists(join(dir, "published-repo", "demo"));
        expect(repoDirExists).toBe(false);
      }),
    );
  });

  test("rejects an unknown --target id with PublishTargetNotFoundError", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const seedEvents = [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)];
        const targets = [{ id: "repo", kind: "git-dir", path: join(dir, "published-repo") }];

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seedEvents) {
            yield* journal.append(event);
          }
          return yield* publishBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            workspaceName: "Demo Studio",
            targets,
            targetIds: ["does-not-exist"],
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("PublishTargetNotFoundError");
      }),
    );
  });
});
