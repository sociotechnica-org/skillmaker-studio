/**
 * The install door (director rulings 2026-08-03, InstallPublish.ts):
 * target resolution, the provenance stamp, remembered targets in
 * bundle.json, evidence derivation, installed-copy drift, and the
 * adopted-in-place (D4c) passthrough.
 */
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
  applyPublishStamp,
  computeInstalledDrift,
  measuredClaimsEvidence,
  publishToInstallTargets,
  readRememberedInstallTargets,
  rememberInstallTargets,
  renderPublishStamp,
  resolveInstallDir,
  stripPublishStamp,
  type InstallEnvironment,
} from "../src/InstallPublish.ts";
import { computeBundleHashes, snapshotVersionContent } from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let seq = 0;
const at = (): string => new Date(2026, 0, 1, 0, 0, seq++).toISOString();

const stageChanged = (bundle: string, from: BundleStage, to: BundleStage): JournalEvent =>
  BundleStageChangedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "bundle.stage_changed",
    payload: { bundle, from, to },
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

const gateDecided = (bundle: string): JournalEvent =>
  BundleGateDecidedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: at(),
    actor,
    type: "bundle.gate_decided",
    payload: { bundle, gate: "publish", decision: "approved", basis: "install-door tests" },
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

/** idea -> published, via the approve+gate path Machine.ts requires. */
const publishedEvents = (bundle: string): ReadonlyArray<JournalEvent> => [
  reviewResolved(bundle, "idea"),
  stageChanged(bundle, "idea", "researching"),
  reviewResolved(bundle, "researching"),
  stageChanged(bundle, "researching", "drafting"),
  reviewResolved(bundle, "drafting"),
  stageChanged(bundle, "drafting", "evaluating"),
  reviewResolved(bundle, "evaluating"),
  gateDecided(bundle),
  stageChanged(bundle, "evaluating", "published"),
];

const SKILL_MD =
  "---\nname: demo\ndescription: a demo skill.\n---\n\n# Demo skill\n\nDo the thing.\n";

/** A studio-born bundle: bundle.json + design.md + output/SKILL.md (+ a sibling reference file). */
const writeBundle = (bundleDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(join(bundleDir, "output"), { recursive: true });
    yield* fs.writeFileString(
      join(bundleDir, "bundle.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          slug: "demo",
          name: "Demo",
          oneLiner: "does demo things",
          tags: [],
          created: "2026-08-01",
          targets: ["claude-code"],
          handAdded: { keep: true },
        },
        undefined,
        2,
      )}\n`,
    );
    yield* fs.writeFileString(join(bundleDir, "design.md"), "# Demo\n\nDesign.\n");
    yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), SKILL_MD);
    yield* fs.writeFileString(join(bundleDir, "output", "reference.md"), "extra sibling\n");
  });

const env = (home: string): InstallEnvironment => ({ env: {}, homeDir: home });

const readEvents = (journalPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* fs.readFileString(journalPath);
    return raw
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  });

// ---------------------------------------------------------------------------

describe("resolveInstallDir", () => {
  test("user -> $CLAUDE_CONFIG_DIR/skills/<slug> when the env var is set", () => {
    const dir = resolveInstallDir("user", "/ws", "demo", { env: { CLAUDE_CONFIG_DIR: "/custom/claude" }, homeDir: "/home/x" });
    expect(dir).toBe(join("/custom/claude", "skills", "demo"));
  });

  test("user -> ~/.claude/skills/<slug> by default", () => {
    const dir = resolveInstallDir("user", "/ws", "demo", env("/home/x"));
    expect(dir).toBe(join("/home/x", ".claude", "skills", "demo"));
  });

  test("project -> <workspace-root>/.claude/skills/<slug>", () => {
    const dir = resolveInstallDir("project", "/ws", "demo", env("/home/x"));
    expect(dir).toBe(join("/ws", ".claude", "skills", "demo"));
  });
});

describe("publish stamp", () => {
  const stamp = renderPublishStamp({
    bundle: "demo",
    versionHash: "sha256:abcdef1234567890",
    versionLabel: "v2",
    date: "2026-08-03",
    evidence: "3 of 23 claims measured",
  });

  test("carries publisher, bundle, short version hash + label, date, evidence", () => {
    expect(stamp).toContain("published by skillmaker-studio");
    expect(stamp).toContain("bundle: demo");
    expect(stamp).toContain("version: sha256:abcdef123456 (v2)");
    expect(stamp).toContain("date: 2026-08-03");
    expect(stamp).toContain("evidence: 3 of 23 claims measured");
  });

  test("applyPublishStamp inserts BELOW frontmatter so harness loaders still parse the skill", () => {
    const stamped = applyPublishStamp(SKILL_MD, stamp);
    expect(stamped.startsWith("---\n")).toBe(true);
    const frontmatterClose = stamped.indexOf("\n---\n");
    expect(stamped.indexOf("published by skillmaker-studio")).toBeGreaterThan(frontmatterClose);
    expect(stamped).toContain("# Demo skill");
  });

  test("applyPublishStamp prepends when the file has no frontmatter", () => {
    const stamped = applyPublishStamp("# Bare skill\n", stamp);
    expect(stamped.startsWith("<!-- published by skillmaker-studio")).toBe(true);
    expect(stamped).toContain("# Bare skill");
  });

  test("strip(apply(x)) round-trips to the original content", () => {
    expect(stripPublishStamp(applyPublishStamp(SKILL_MD, stamp))).toBe(SKILL_MD);
    expect(stripPublishStamp(applyPublishStamp("# Bare skill\n", stamp))).toBe("# Bare skill\n");
  });

  test("re-stamping replaces the previous stamp instead of stacking", () => {
    const twice = applyPublishStamp(applyPublishStamp(SKILL_MD, stamp), stamp);
    expect(twice.split("published by skillmaker-studio")).toHaveLength(2);
  });
});

describe("measuredClaimsEvidence", () => {
  const claims = [
    { riskId: "IN-1" },
    { riskId: "RE-1" },
    { riskId: "OUT-1", fixtureCase: "authored-join" },
  ];
  const fixtures = [
    { caseName: "case-a", risks: ["IN-1"] },
    { caseName: "case-b", risks: ["RE-1"] },
  ];

  test("counts claims with a measurement cell at the published version, out of all claims", () => {
    const measurements = [
      { fixtureCase: "case-a", versionHash: "sha256:v1", n: 3 },
      { fixtureCase: "case-b", versionHash: "sha256:OTHER", n: 5 },
    ];
    expect(measuredClaimsEvidence(claims, fixtures, measurements, "sha256:v1")).toBe(
      "1 of 3 claims measured",
    );
  });

  test("honors the risk-map's authored fixtureCase column as the join fallback (same as the viewer)", () => {
    const measurements = [{ fixtureCase: "authored-join", versionHash: "sha256:v1", n: 1 }];
    expect(measuredClaimsEvidence(claims, fixtures, measurements, "sha256:v1")).toBe(
      "1 of 3 claims measured",
    );
  });

  test("zero-run cells (n = 0) do not count as measured", () => {
    const measurements = [{ fixtureCase: "case-a", versionHash: "sha256:v1", n: 0 }];
    expect(measuredClaimsEvidence(claims, fixtures, measurements, "sha256:v1")).toBe(
      "0 of 3 claims measured",
    );
  });
});

describe("remembered targets (bundle.json publishTargets)", () => {
  test("read on a fresh bundle is empty; remember merges losslessly and preserves hand-added fields", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual([]);

        expect(yield* rememberInstallTargets(bundleDir, ["user"])).toBe(true);
        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual(["user"]);

        // Union, order preserved, no duplicate; unchanged write reports false.
        expect(yield* rememberInstallTargets(bundleDir, ["project", "user"])).toBe(true);
        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual(["user", "project"]);
        expect(yield* rememberInstallTargets(bundleDir, ["user"])).toBe(false);

        const fs = yield* FileSystem;
        const raw = JSON.parse(yield* fs.readFileString(join(bundleDir, "bundle.json"))) as Record<
          string,
          unknown
        >;
        expect(raw.handAdded).toEqual({ keep: true });
        expect(raw.slug).toBe("demo");
      }),
    );
  });

  test("a missing bundle.json reads as nothing remembered and remember is a safe no-op", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        expect(yield* readRememberedInstallTargets(dir)).toEqual([]);
        expect(yield* rememberInstallTargets(dir, ["user"])).toBe(false);
      }),
    );
  });
});

describe("publishToInstallTargets", () => {
  test("first publish --to user installs stamped output, journals evidence, and remembers the choice", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const home = join(dir, "home");
        const bundleDir = join(dir, "ws", "skills", "demo");
        const journalPath = join(dir, "ws", ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash, "v1")]) {
            yield* journal.append(event);
          }
          return yield* publishToInstallTargets({
            workspaceRoot: join(dir, "ws"),
            bundleDir,
            bundle: "demo",
            actor,
            to: "user",
            environment: env(home),
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.versionHash).toBe(outputHash);
        expect(result.versionLabel).toBe("v1");
        expect(result.stamped).toBe(true);
        expect(result.remembered).toEqual(["user"]);
        expect(result.results).toHaveLength(1);
        expect(result.results[0]?.status).toBe("published");

        const installedDir = join(home, ".claude", "skills", "demo");
        expect(result.results[0]?.path).toBe(installedDir);
        const installed = yield* fs.readFileString(join(installedDir, "SKILL.md"));
        expect(installed).toContain("published by skillmaker-studio");
        expect(installed.startsWith("---\n")).toBe(true);
        expect(stripPublishStamp(installed)).toBe(SKILL_MD);
        // output/ siblings ride along.
        expect(yield* fs.readFileString(join(installedDir, "reference.md"))).toBe("extra sibling\n");

        const events = yield* readEvents(journalPath);
        const published = events.filter((event) => event.type === "skill.published");
        expect(published).toHaveLength(1);
        expect(published[0]?.payload.target).toBe("user");
        expect(published[0]?.payload.versionHash).toBe(outputHash);
        expect(typeof published[0]?.payload.evidence).toBe("string");
        expect(published[0]?.payload.url).toBe(installedDir);

        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual(["user"]);

        // Installed drift: faithful copy (stamp stripped) is in-sync.
        expect(yield* computeInstalledDrift(installedDir, outputHash)).toBe("in-sync");

        // Re-publish with no --to goes to the remembered target and is a
        // true no-op: same content signature, no second journal event.
        const second = yield* publishToInstallTargets({
          workspaceRoot: join(dir, "ws"),
          bundleDir,
          bundle: "demo",
          actor,
          environment: env(home),
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(second.results[0]?.status).toBe("already_published");
        const eventsAfter = yield* readEvents(journalPath);
        expect(eventsAfter.filter((event) => event.type === "skill.published")).toHaveLength(1);
      }),
    );
  });

  test("project audience installs into <workspace-root>/.claude/skills/<slug>", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const workspaceRoot = join(dir, "ws");
        const bundleDir = join(workspaceRoot, "skills", "demo");
        const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)]) {
            yield* journal.append(event);
          }
          return yield* publishToInstallTargets({
            workspaceRoot,
            bundleDir,
            bundle: "demo",
            actor,
            to: "project",
            environment: env(join(dir, "home")),
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const installedDir = join(workspaceRoot, ".claude", "skills", "demo");
        expect(result.results[0]?.path).toBe(installedDir);
        expect(yield* fs.exists(join(installedDir, "SKILL.md"))).toBe(true);
        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual(["project"]);
      }),
    );
  });

  test("revert (--version) writes the older snapshot back, clears stale siblings, and journals a REAL act", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const home = join(dir, "home");
        const workspaceRoot = join(dir, "ws");
        const bundleDir = join(workspaceRoot, "skills", "demo");
        const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);

        // v1: record + snapshot.
        const v1 = yield* computeBundleHashes(bundleDir);
        yield* snapshotVersionContent({ bundleDir, layout: "output-dir" }, v1.outputHash);

        // v2: changed SKILL.md, extra sibling gone.
        const v2Skill = SKILL_MD.replace("Do the thing.", "Do the NEW thing.");
        yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), v2Skill);
        yield* fs.remove(join(bundleDir, "output", "reference.md"));
        const v2 = yield* computeBundleHashes(bundleDir);
        yield* snapshotVersionContent({ bundleDir, layout: "output-dir" }, v2.outputHash);

        const seed = [
          ...publishedEvents("demo"),
          versionRecorded("demo", v1.outputHash, v1.designHash, "v1"),
          versionRecorded("demo", v2.outputHash, v2.designHash, "v2"),
        ];

        const program = Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seed) {
            yield* journal.append(event);
          }
          // Publish v2 (latest, in-sync) to user.
          const first = yield* publishToInstallTargets({
            workspaceRoot,
            bundleDir,
            bundle: "demo",
            actor,
            to: "user",
            environment: env(home),
          });
          expect(first.versionHash).toBe(v2.outputHash);

          // Revert to v1 via its hash prefix.
          const reverted = yield* publishToInstallTargets({
            workspaceRoot,
            bundleDir,
            bundle: "demo",
            actor,
            version: v1.outputHash.slice(0, 20),
            environment: env(home),
          });
          expect(reverted.versionHash).toBe(v1.outputHash);
          expect(reverted.results[0]?.status).toBe("published");
          return reverted;
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        yield* program;

        const installedDir = join(home, ".claude", "skills", "demo");
        const installed = yield* fs.readFileString(join(installedDir, "SKILL.md"));
        expect(stripPublishStamp(installed)).toBe(SKILL_MD);
        // v1's sibling is restored by the revert.
        expect(yield* fs.exists(join(installedDir, "reference.md"))).toBe(true);

        const events = yield* readEvents(journalPath);
        const published = events.filter((event) => event.type === "skill.published");
        expect(published).toHaveLength(2);
        expect(published.map((event) => event.payload.versionHash)).toEqual([v2.outputHash, v1.outputHash]);
      }),
    );
  });

  test("a revert that re-lands PREVIOUSLY published bytes is still a real, journaled act", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const home = join(dir, "home");
        const workspaceRoot = join(dir, "ws");
        const bundleDir = join(workspaceRoot, "skills", "demo");
        const journalPath = join(workspaceRoot, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);

        const v1 = yield* computeBundleHashes(bundleDir);
        yield* snapshotVersionContent({ bundleDir, layout: "output-dir" }, v1.outputHash);
        yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), SKILL_MD.replace("thing", "NEW thing"));
        const v2 = yield* computeBundleHashes(bundleDir);
        yield* snapshotVersionContent({ bundleDir, layout: "output-dir" }, v2.outputHash);

        const seed = [
          ...publishedEvents("demo"),
          versionRecorded("demo", v1.outputHash, v1.designHash, "v1"),
          versionRecorded("demo", v2.outputHash, v2.designHash, "v2"),
        ];

        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seed) {
            yield* journal.append(event);
          }
          const base = { workspaceRoot, bundleDir, bundle: "demo", actor, environment: env(home) } as const;
          // v1 -> v2 -> revert to v1: three real changes to the installed
          // tree, three journal events -- the v1 revert must NOT be
          // swallowed by the first v1 publish's idempotency key.
          yield* publishToInstallTargets({ ...base, to: "user", version: v1.outputHash });
          yield* publishToInstallTargets({ ...base, version: v2.outputHash });
          const reverted = yield* publishToInstallTargets({ ...base, version: v1.outputHash });
          expect(reverted.results[0]?.status).toBe("published");
          // ...and reverting AGAIN to what is already installed is a no-op.
          const again = yield* publishToInstallTargets({ ...base, version: v1.outputHash });
          expect(again.results[0]?.status).toBe("already_published");
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const events = yield* readEvents(journalPath);
        const published = events.filter((event) => event.type === "skill.published");
        expect(published).toHaveLength(3);
        expect(published.map((event) => event.payload.versionHash)).toEqual([
          v1.outputHash,
          v2.outputHash,
          v1.outputHash,
        ]);
      }),
    );
  });

  test("no --to and nothing remembered is a clear InstallTargetError", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)]) {
            yield* journal.append(event);
          }
          return yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            actor,
            environment: env(join(dir, "home")),
          }).pipe(Effect.flip);
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        if (outcome._tag !== "InstallTargetError") {
          throw new Error(`expected InstallTargetError, got ${outcome._tag}`);
        }
        expect(outcome.reason).toContain("--to user");
      }),
    );
  });

  test("unknown --version prefix is InstallVersionNotFoundError", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)]) {
            yield* journal.append(event);
          }
          return yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            actor,
            to: "user",
            version: "sha256:doesnotexist",
            environment: env(join(dir, "home")),
          }).pipe(Effect.flip);
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        if (outcome._tag !== "InstallVersionNotFoundError") {
          throw new Error(`expected InstallVersionNotFoundError, got ${outcome._tag}`);
        }
      }),
    );
  });

  test("guard still applies: a drifted live tree cannot plain-publish", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), "# drifted\n");

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of [...publishedEvents("demo"), versionRecorded("demo", outputHash, designHash)]) {
            yield* journal.append(event);
          }
          return yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            actor,
            to: "user",
            environment: env(join(dir, "home")),
          }).pipe(Effect.flip);
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        if (outcome._tag !== "PublishGuardError") {
          throw new Error(`expected PublishGuardError, got ${outcome._tag}`);
        }
        expect(outcome.reason).toContain("drifted");
      }),
    );
  });

  test("ADOPTED in-place passthrough (D4c): writes to the live directory, no stamp, no --to, nothing remembered", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundleDir = join(dir, "adopted-skill");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* fs.makeDirectory(bundleDir, { recursive: true });
        yield* fs.writeFileString(join(bundleDir, ".skillmaker-adopt.json"), JSON.stringify({ skillPath: "." }));
        yield* fs.writeFileString(
          join(bundleDir, "bundle.json"),
          `${JSON.stringify({ schemaVersion: 1, slug: "adopted", name: "Adopted", oneLiner: "", tags: [], created: "", targets: [] })}\n`,
        );
        yield* fs.writeFileString(join(bundleDir, "design.md"), "# Adopted\n");
        yield* fs.writeFileString(join(bundleDir, "SKILL.md"), "# Adopted skill\n\nOriginal.\n");

        // v1 snapshot, then a v2 live edit + snapshot.
        const v1 = yield* computeBundleHashes(bundleDir, "in-place");
        yield* snapshotVersionContent({ bundleDir, layout: "in-place" }, v1.outputHash);
        yield* fs.writeFileString(join(bundleDir, "SKILL.md"), "# Adopted skill\n\nEdited.\n");
        const v2 = yield* computeBundleHashes(bundleDir, "in-place");
        yield* snapshotVersionContent({ bundleDir, layout: "in-place" }, v2.outputHash);

        const seed = [
          ...publishedEvents("adopted"),
          versionRecorded("adopted", v1.outputHash, v1.designHash, "v1"),
          versionRecorded("adopted", v2.outputHash, v2.designHash, "v2"),
        ];

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          for (const event of seed) {
            yield* journal.append(event);
          }

          // --to is refused for in-place bundles.
          const refused = yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "adopted",
            actor,
            to: "user",
            environment: env(join(dir, "home")),
          }).pipe(Effect.flip);
          expect(refused._tag).toBe("InstallTargetError");

          // Plain publish: the live directory IS the install location.
          const published = yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "adopted",
            actor,
            environment: env(join(dir, "home")),
          });
          expect(published.results[0]?.target).toBe("in-place");
          expect(published.results[0]?.path).toBe(bundleDir);
          expect(published.stamped).toBe(false);

          // Revert to v1 restores the live SKILL.md from the snapshot.
          const reverted = yield* publishToInstallTargets({
            workspaceRoot: dir,
            bundleDir,
            bundle: "adopted",
            actor,
            version: v1.outputHash,
            environment: env(join(dir, "home")),
          });
          expect(reverted.versionHash).toBe(v1.outputHash);
          return published;
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        // No stamp in the live file, ever (stamping would register as
        // output drift against the just-published version).
        const live = yield* fs.readFileString(join(bundleDir, "SKILL.md"));
        expect(live).toBe("# Adopted skill\n\nOriginal.\n");
        expect(live).not.toContain("published by skillmaker-studio");

        // Studio files survived the in-place write.
        expect(yield* fs.exists(join(bundleDir, "bundle.json"))).toBe(true);
        expect(yield* fs.exists(join(bundleDir, "design.md"))).toBe(true);
        expect(yield* fs.exists(join(bundleDir, ".skillmaker-adopt.json"))).toBe(true);

        // Nothing remembered: the layout is the memory.
        expect(outcome.remembered).toEqual([]);
        expect(yield* readRememberedInstallTargets(bundleDir)).toEqual([]);
      }),
    );
  });
});

describe("computeInstalledDrift", () => {
  test("not-installed / in-sync (stamp stripped) / installed-edited", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { outputHash } = yield* computeBundleHashes(bundleDir);

        const installedDir = join(dir, "installed", "demo");
        expect(yield* computeInstalledDrift(installedDir, outputHash)).toBe("not-installed");

        // A faithful install: stamped SKILL.md + siblings.
        yield* fs.makeDirectory(installedDir, { recursive: true });
        const stamp = renderPublishStamp({
          bundle: "demo",
          versionHash: outputHash,
          date: "2026-08-03",
          evidence: "0 of 0 claims measured",
        });
        yield* fs.writeFileString(join(installedDir, "SKILL.md"), applyPublishStamp(SKILL_MD, stamp));
        yield* fs.writeFileString(join(installedDir, "reference.md"), "extra sibling\n");
        expect(yield* computeInstalledDrift(installedDir, outputHash)).toBe("in-sync");

        // Hand-edit after publish -> installed-edited.
        yield* fs.writeFileString(join(installedDir, "SKILL.md"), applyPublishStamp(`${SKILL_MD}\nedited\n`, stamp));
        expect(yield* computeInstalledDrift(installedDir, outputHash)).toBe("installed-edited");
      }),
    );
  });
});
