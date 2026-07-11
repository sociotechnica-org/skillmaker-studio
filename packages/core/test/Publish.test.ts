import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { mkdirSync, writeFileSync } from "node:fs";
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

  // Fix F2: before this fix, checkPublishable always called
  // computeBundleHashes(bundleDir) with the "output-dir" default, which
  // hashes bundleDir/output -- nonexistent for an in-place (adopted)
  // bundle, so an adopted bundle could never actually pass this guard even
  // with a correctly-recorded "adopted" version. checkPublishable must
  // auto-detect layout via detectBundleLayout, same as RunEngine/StationEngine.
  test("accepts a published IN-PLACE (adopted) bundle whose recorded version matches live content", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        // An adopted bundle: no output/ subdirectory -- SKILL.md lives at
        // the bundle root, alongside the adopt marker.
        yield* fs.writeFileString(join(dir, ".skillmaker-adopt.json"), JSON.stringify({ skillPath: "." }));
        yield* fs.writeFileString(join(dir, "design.md"), "# Demo\n\nAn adopted demo skill.\n");
        yield* fs.writeFileString(join(dir, "SKILL.md"), "# Demo skill\n\nDo the thing.\n");

        const { designHash, outputHash } = yield* computeBundleHashes(dir, "in-place");
        const events = [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash, "adopted")];
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

describe("publishClaudeMarketplace richness (Phase 20 Story 4 friction log finding #4)", () => {
  const demoMeasurements = [
    {
      bundle: "demo",
      fixtureCase: "golden-basic",
      versionHash: "sha256:v1",
      provider: "claude-code",
      model: "fake-model-1",
      n: 3,
      passes: 3,
      partial: 0,
      fail: 0,
      passRate: 1,
      ci: [0.4385029682449545, 1] as const,
    },
  ];

  test("gives the bundle its own plugin entry with oneLiner/tags/version-label + measurement receipts, and writes a README", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing, reliably.",
            tags: ["demo", "onboarding"],
            versionHash: "sha256:v1",
            versionLabel: "v2",
            measurements: demoMeasurements,
          },
        );

        const raw = yield* fs.readFileString(result.manifestPath);
        const manifest = JSON.parse(raw) as {
          plugins: ReadonlyArray<{
            name: string;
            source: string;
            description: string;
            version: string;
            keywords: ReadonlyArray<string>;
          }>;
        };
        expect(manifest.plugins).toHaveLength(1);
        const plugin = manifest.plugins[0];
        expect(plugin?.name).toBe("demo");
        expect(plugin?.source).toBe("./skills/demo/output");
        expect(plugin?.description).toBe("Does the demo thing, reliably.");
        // The recorded label ("v2"), never the bare hash -- friction log
        // finding #4: "Teammate sees plugin 'skills', Version 419bb565ddf1
        // (a hash, not v2)".
        expect(plugin?.version).toBe("v2");
        expect(plugin?.keywords).toEqual(["demo", "onboarding"]);

        const readme = yield* fs.readFileString(result.readmePath);
        expect(readme).toContain("### demo");
        expect(readme).toContain("Does the demo thing, reliably.");
        expect(readme).toContain("v2");
        expect(readme).toContain("demo, onboarding");
        // The receipts must reach the shopper: n, pass rate, and CI, per
        // provider -- not just a bare install target.
        expect(readme).toContain("claude-code/fake-model-1");
        expect(readme).toContain("n=3");
        expect(readme).toContain("100% pass");
        expect(readme).toContain("[44%, 100%]");
      }),
    );
  });

  test("falls back to a short hash when no version label was recorded", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing.",
            tags: [],
            versionHash: "sha256:abcdef0123456789",
            measurements: [],
          },
        );
        const manifest = JSON.parse(yield* fs.readFileString(result.manifestPath)) as {
          plugins: ReadonlyArray<{ version: string }>;
        };
        expect(manifest.plugins[0]?.version).toBe("sha256:abcdef012345");

        const readme = yield* fs.readFileString(result.readmePath);
        expect(readme).toContain("no graded runs yet");
      }),
    );
  });

  test("two bundles get two separate plugin entries, each with its own README section", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing.",
            tags: ["demo"],
            versionHash: "sha256:v1",
            versionLabel: "v1",
            measurements: [],
          },
        );
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/second/output",
          {
            slug: "second",
            name: "Second Skill",
            oneLiner: "Does the second thing.",
            tags: ["second"],
            versionHash: "sha256:v1",
            versionLabel: "v1",
            measurements: [],
          },
        );

        const manifest = JSON.parse(yield* fs.readFileString(result.manifestPath)) as {
          plugins: ReadonlyArray<{ name: string }>;
        };
        expect(manifest.plugins.map((p) => p.name)).toEqual(["demo", "second"]);

        const readme = yield* fs.readFileString(result.readmePath);
        expect(readme).toContain("### demo");
        expect(readme).toContain("### second");
        expect(readme).toContain("Does the demo thing.");
        expect(readme).toContain("Does the second thing.");
      }),
    );
  });

  test("re-publishing the same bundle refreshes its entry + README in place (never stale)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing.",
            tags: ["demo"],
            versionHash: "sha256:v1",
            versionLabel: "v1",
            measurements: [],
          },
        );
        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing, now even better.",
            tags: ["demo", "v2-tag"],
            versionHash: "sha256:v2",
            versionLabel: "v2",
            measurements: demoMeasurements.map((m) => ({ ...m, versionHash: "sha256:v2" })),
          },
        );

        const manifest = JSON.parse(yield* fs.readFileString(result.manifestPath)) as {
          plugins: ReadonlyArray<{ name: string; description: string; version: string; keywords: ReadonlyArray<string> }>;
        };
        expect(manifest.plugins).toHaveLength(1);
        expect(manifest.plugins[0]?.description).toBe("Does the demo thing, now even better.");
        expect(manifest.plugins[0]?.version).toBe("v2");
        expect(manifest.plugins[0]?.keywords).toEqual(["demo", "v2-tag"]);

        const readme = yield* fs.readFileString(result.readmePath);
        expect(readme).toContain("Does the demo thing, now even better.");
        expect(readme).not.toContain("Does the demo thing.\n");
      }),
    );
  });

  test("losslessly round-trips unrelated hand-authored plugin entries and unknown top-level fields, and surfaces them in the README", async () => {
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
              plugins: [{ name: "hand-authored", source: "./other", description: "A hand-authored plugin." }],
            },
            undefined,
            2,
          ),
        );

        const result = yield* publishClaudeMarketplace(
          { id: "claude", kind: "claude-marketplace" },
          dir,
          "Demo Studio",
          "./skills/demo/output",
          {
            slug: "demo",
            name: "Demo Skill",
            oneLiner: "Does the demo thing.",
            tags: ["demo"],
            versionHash: "sha256:v1",
            versionLabel: "v1",
            measurements: [],
          },
        );

        const raw = yield* fs.readFileString(result.manifestPath);
        const manifest = JSON.parse(raw) as {
          $schema: string;
          owner: { email: string };
          metadata: { pluginRoot: string };
          plugins: ReadonlyArray<{ name: string; description?: string }>;
        };
        expect(manifest.$schema).toBe("https://example.com/marketplace.schema.json");
        expect(manifest.owner.email).toBe("studio@example.com");
        expect(manifest.metadata.pluginRoot).toBe("./plugins");
        expect(manifest.plugins).toHaveLength(2);
        expect(manifest.plugins.some((entry) => entry.name === "hand-authored")).toBe(true);

        const readme = yield* fs.readFileString(result.readmePath);
        expect(readme).toContain("### demo");
        expect(readme).toContain("### hand-authored");
        expect(readme).toContain("A hand-authored plugin.");
      }),
    );
  });
});

describe("publishClaudeMarketplace via publishBundle end-to-end (real bundle.json + real graded runs)", () => {
  test("the storefront README carries real measurement receipts for a real bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);

        // A real bundle.json (identity), the source `readBundleIdentity`
        // reads to enrich the manifest/README.
        writeFileSync(
          join(bundleDir, "bundle.json"),
          JSON.stringify(
            {
              schemaVersion: 1,
              slug: "demo",
              name: "Demo Skill",
              oneLiner: "Turns raw notes into a clean changelog entry.",
              tags: ["writing", "changelog"],
              created: "2026-07-01",
              targets: ["claude-code"],
            },
            undefined,
            2,
          ),
        );

        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const seedEvents = [
          ...publishedEvents("demo"),
          versionRecorded("demo", outputHash, designHash, "v3"),
        ];

        // A real, graded run.json -- exactly what IndexService.listMeasurements
        // aggregates from (mirrors IndexService.test.ts's writeRunJson).
        const runDir = join(bundleDir, "runs", "run-1");
        mkdirSync(runDir, { recursive: true });
        writeFileSync(
          join(runDir, "run.json"),
          JSON.stringify(
            {
              schemaVersion: 1,
              id: "run-1",
              bundle: "demo",
              kind: "eval",
              station: null,
              fixtureCase: "golden-basic",
              skillVersionHash: outputHash,
              provider: "claude-code",
              model: "fake-model-1",
              startedAt: "2026-07-10T00:00:00.000Z",
              endedAt: "2026-07-10T00:01:00.000Z",
              status: "completed",
              actor: { kind: "process", name: "run-engine" },
            },
            undefined,
            2,
          ),
        );

        const targets = [{ id: "claude", kind: "claude-marketplace" }];

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seedEvents) {
            yield* journal.append(event);
          }
          yield* journal.append({
            type: "run.graded",
            actor,
            payload: { id: "run-1", verdict: "pass" },
          });
          return yield* publishBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            workspaceName: "Demo Studio",
            targets,
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.results[0]?.status).toBe("published");

        const fs = yield* FileSystem;
        const manifestPath = join(dir, ".claude-plugin", "marketplace.json");
        const manifest = JSON.parse(yield* fs.readFileString(manifestPath)) as {
          plugins: ReadonlyArray<{ name: string; description: string; version: string; keywords: ReadonlyArray<string> }>;
        };
        expect(manifest.plugins).toHaveLength(1);
        expect(manifest.plugins[0]?.name).toBe("demo");
        expect(manifest.plugins[0]?.description).toBe("Turns raw notes into a clean changelog entry.");
        expect(manifest.plugins[0]?.version).toBe("v3");
        expect(manifest.plugins[0]?.keywords).toEqual(["writing", "changelog"]);

        const readmePath = join(dir, "README.md");
        const readme = yield* fs.readFileString(readmePath);
        expect(readme).toContain("### demo");
        expect(readme).toContain("Turns raw notes into a clean changelog entry.");
        expect(readme).toContain("v3");
        expect(readme).toContain("writing, changelog");
        expect(readme).toContain("claude-code/fake-model-1");
        expect(readme).toContain("n=1");
        expect(readme).toContain("100% pass");
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
