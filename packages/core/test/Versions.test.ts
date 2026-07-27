import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { BundleCreatedEvent, SkillVersionRecordedEvent } from "../src/Journal.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  computeBundleHashes,
  computeDrift,
  foldSkillVersions,
  hashDesign,
  hashOutputTree,
  latestSkillVersion,
  listVersionSnapshotFiles,
  recordSkillVersion,
  resolveSkillVersion,
  versionLabel,
  versionSnapshotDir,
} from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const versionRecordedEvent = (
  bundle: string,
  hash: string,
  designHash: string,
  at: string,
  label?: string,
): JournalEvent =>
  SkillVersionRecordedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at,
    actor,
    type: "skill.version_recorded",
    payload: { bundle, hash, designHash, ...(label !== undefined ? { label } : {}) },
  });

describe("hashOutputTree", () => {
  test("hashes the well-defined empty list for a missing directory", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const hash = yield* hashOutputTree(join(dir, "output"));
        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }),
    );
  });

  test("hashes the well-defined empty list for a directory containing only .gitkeep", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const outputDir = join(dir, "output");
        yield* fs.makeDirectory(outputDir, { recursive: true });
        yield* fs.writeFileString(join(outputDir, ".gitkeep"), "");

        const emptyHash = yield* hashOutputTree(join(dir, "does-not-exist"));
        const gitkeepOnlyHash = yield* hashOutputTree(outputDir);
        expect(gitkeepOnlyHash).toBe(emptyHash);
      }),
    );
  });

  test("is independent of directory-scan order", async () => {
    const hashA = await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const outputDir = join(dir, "output");
        yield* fs.makeDirectory(outputDir, { recursive: true });
        yield* fs.writeFileString(join(outputDir, "a.md"), "alpha content");
        yield* fs.writeFileString(join(outputDir, "b.md"), "beta content");
        yield* fs.writeFileString(join(outputDir, "c.md"), "gamma content");
        return yield* hashOutputTree(outputDir);
      }),
    );

    const hashB = await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const outputDir = join(dir, "output");
        yield* fs.makeDirectory(outputDir, { recursive: true });
        // Written in a different order than above.
        yield* fs.writeFileString(join(outputDir, "c.md"), "gamma content");
        yield* fs.writeFileString(join(outputDir, "a.md"), "alpha content");
        yield* fs.writeFileString(join(outputDir, "b.md"), "beta content");
        return yield* hashOutputTree(outputDir);
      }),
    );

    expect(hashB).toBe(hashA);
  });

  test("is sensitive to file content changes", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const outputDir = join(dir, "output");
        yield* fs.makeDirectory(outputDir, { recursive: true });
        yield* fs.writeFileString(join(outputDir, "SKILL.md"), "version one");
        const before = yield* hashOutputTree(outputDir);

        yield* fs.writeFileString(join(outputDir, "SKILL.md"), "version two");
        const after = yield* hashOutputTree(outputDir);

        expect(after).not.toBe(before);
      }),
    );
  });

  test("hashes nested directories recursively", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const outputDir = join(dir, "output");
        const nestedDir = join(outputDir, "nested", "deeper");
        yield* fs.makeDirectory(nestedDir, { recursive: true });
        yield* fs.writeFileString(join(outputDir, "top.md"), "top level");
        yield* fs.writeFileString(join(nestedDir, "leaf.md"), "leaf content");

        const withLeaf = yield* hashOutputTree(outputDir);

        yield* fs.writeFileString(join(nestedDir, "leaf.md"), "changed leaf content");
        const withChangedLeaf = yield* hashOutputTree(outputDir);

        expect(withChangedLeaf).not.toBe(withLeaf);
      }),
    );
  });
});

describe("hashDesign", () => {
  test("hashes the empty string for a missing design.md", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const hash = yield* hashDesign(join(dir, "design.md"));
        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }),
    );
  });

  test("is sensitive to content changes and stable for identical content", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const designPath = join(dir, "design.md");
        yield* fs.writeFileString(designPath, "# Design\n\nFirst draft.");
        const first = yield* hashDesign(designPath);
        const firstAgain = yield* hashDesign(designPath);
        expect(firstAgain).toBe(first);

        yield* fs.writeFileString(designPath, "# Design\n\nSecond draft.");
        const second = yield* hashDesign(designPath);
        expect(second).not.toBe(first);
      }),
    );
  });
});

describe("computeDrift", () => {
  const current = { designHash: "sha256:design-current", outputHash: "sha256:output-current" };

  test("no-version: no recorded version to compare against", () => {
    expect(computeDrift(current, undefined)).toBe("no-version");
  });

  test("in-sync: both hashes match the latest version", () => {
    const latest = { designHash: current.designHash, hash: current.outputHash };
    expect(computeDrift(current, latest)).toBe("in-sync");
  });

  test("design-changed: only the design hash differs", () => {
    const latest = { designHash: "sha256:design-old", hash: current.outputHash };
    expect(computeDrift(current, latest)).toBe("design-changed");
  });

  test("output-hand-edited: only the output hash differs", () => {
    const latest = { designHash: current.designHash, hash: "sha256:output-old" };
    expect(computeDrift(current, latest)).toBe("output-hand-edited");
  });

  test("both: design and output hashes both differ", () => {
    const latest = { designHash: "sha256:design-old", hash: "sha256:output-old" };
    expect(computeDrift(current, latest)).toBe("both");
  });
});

describe("foldSkillVersions / latestSkillVersion", () => {
  test("folds events per bundle and the latest is the last chronologically", () => {
    const events: ReadonlyArray<JournalEvent> = [
      versionRecordedEvent("alpha", "sha256:aaa1", "sha256:d1", "2026-07-01T00:00:00.000Z", "v0.1"),
      versionRecordedEvent("beta", "sha256:bbb1", "sha256:d2", "2026-07-02T00:00:00.000Z"),
      versionRecordedEvent("alpha", "sha256:aaa2", "sha256:d3", "2026-07-03T00:00:00.000Z", "v0.2"),
    ];

    const versions = foldSkillVersions(events);
    expect(versions.get("alpha")?.length).toBe(2);
    expect(versions.get("beta")?.length).toBe(1);
    expect(versions.get("gamma")).toBeUndefined();

    const latestAlpha = latestSkillVersion(versions.get("alpha"));
    expect(latestAlpha?.hash).toBe("sha256:aaa2");
    expect(latestAlpha?.label).toBe("v0.2");

    const latestBeta = latestSkillVersion(versions.get("beta"));
    expect(latestBeta?.hash).toBe("sha256:bbb1");
    expect(latestBeta?.label).toBeUndefined();

    expect(latestSkillVersion(versions.get("gamma"))).toBeUndefined();
    expect(latestSkillVersion(undefined)).toBeUndefined();
  });

  test("ignores non-version events", () => {
    const events: ReadonlyArray<JournalEvent> = [
      BundleCreatedEvent.make({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-01T00:00:00.000Z",
        actor,
        type: "bundle.created",
        payload: { bundle: "alpha" },
      }),
      versionRecordedEvent("alpha", "sha256:aaa1", "sha256:d1", "2026-07-02T00:00:00.000Z"),
    ];
    const versions = foldSkillVersions(events);
    expect(versions.get("alpha")?.length).toBe(1);
  });
});

describe("resolveSkillVersion", () => {
  const events: ReadonlyArray<JournalEvent> = [
    versionRecordedEvent("alpha", "sha256:abc111", "sha256:d1", "2026-07-01T00:00:00.000Z", "v1"),
    versionRecordedEvent("alpha", "sha256:abc222", "sha256:d2", "2026-07-02T00:00:00.000Z", "v2"),
    versionRecordedEvent("alpha", "sha256:def333", "sha256:d3", "2026-07-03T00:00:00.000Z", "v3"),
  ];
  const versions = foldSkillVersions(events).get("alpha") ?? [];

  test("no prefix picks the latest recorded version", () => {
    expect(resolveSkillVersion(versions, undefined)?.hash).toBe("sha256:def333");
    expect(resolveSkillVersion([], undefined)).toBeUndefined();
  });

  test("a prefix is left-anchored, never a substring match", () => {
    expect(resolveSkillVersion(versions, "sha256:def")?.hash).toBe("sha256:def333");
    // "def" appears inside "sha256:def333" but no hash STARTS with it.
    expect(resolveSkillVersion(versions, "def")).toBeUndefined();
  });

  test("an ambiguous prefix resolves to the newest match", () => {
    expect(resolveSkillVersion(versions, "sha256:abc")?.label).toBe("v2");
  });
});

describe("recordSkillVersion (Fix F3: the exact Story-1 duplicate-hash sequence)", () => {
  test("a repeat with IDENTICAL hashes+payload is a clean no-op, not a duplicate journal line", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journal = yield* Journal;
        const source = { bundleDir: dir, layout: "output-dir" } as const;
        const first = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source);
        const second = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source);

        expect(first.status).toBe("appended");
        expect(second.status).toBe("already_appended");

        const all = yield* journal.readAll();
        expect(all.filter((e) => e.type === "skill.version_recorded").length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });

  // Reproduces the exact Story-1 (F3) sequence: `adopt` records an initial
  // version under label "adopted" for a hash; a later `run` against the
  // SAME unchanged content used to auto-record again with NO
  // idempotencyKey at all, appending a second `skill.version_recorded`
  // event for the identical (bundle, hash, designHash) triple -- which then
  // hit IndexService's `skill_versions` PRIMARY KEY and bricked the index.
  // Now both writers share `recordSkillVersion`, so the collision is a
  // catchable `JournalIdempotencyConflictError`, never a raw duplicate.
  test("adopt's labeled record + a later run's auto-record under the SAME hashes: conflict is catchable, journal stays consistent", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journal = yield* Journal;

        // Step 1: `adopt` records the initial version, as Adopt.ts does.
        const source = { bundleDir: dir, layout: "output-dir" } as const;
        const adoptResult = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source, {
          label: "adopted",
        });
        expect(adoptResult.status).toBe("appended");

        // Step 2: a later `run` (unchanged content -> same hashes) auto-
        // records again, exactly like RunEngine.ts's drift check, but WITHOUT
        // the "adopted" label in its payload -- different content under the
        // same idempotency key, so it must conflict, not silently duplicate.
        const runOutcome = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source).pipe(
          Effect.flip,
        );
        expect(runOutcome._tag).toBe("JournalIdempotencyConflictError");

        // The journal must still contain exactly ONE skill.version_recorded
        // event for this triple -- the conflict must never reach disk as a
        // second line.
        const all = yield* journal.readAll();
        const versionEvents = all.filter((e) => e.type === "skill.version_recorded");
        expect(versionEvents.length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });

  test("RunEngine's catchTag pattern: swallowing the conflict lets the run proceed instead of failing", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journal = yield* Journal;
        const source = { bundleDir: dir, layout: "output-dir" } as const;
        yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source, { label: "adopted" });

        // Mirrors RunEngine.ts's `.pipe(Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void))`.
        yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", source).pipe(
          Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void),
        );

        const all = yield* journal.readAll();
        expect(all.filter((e) => e.type === "skill.version_recorded").length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });
});

// Director ruling 2026-07-25: recording a version KEEPS its content --
// `recordSkillVersion` snapshots `design.md` + the skill payload into
// `<bundle>/.skillmaker/versions/<bare-hash>/`, so history lives in the
// bundle and travels with the project.
describe("snapshot on record", () => {
  const writeFiles = (files: ReadonlyArray<readonly [string, string]>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      for (const [path, content] of files) {
        yield* fs.makeDirectory(join(path, ".."), { recursive: true });
        yield* fs.writeFileString(path, content);
      }
    });

  test("output-dir layout: records the receipt AND keeps design.md + output/ under .skillmaker/versions/<bare-hash>/", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundleDir = join(dir, "skills", "demo");
        yield* writeFiles([
          [join(bundleDir, "design.md"), "# design\n"],
          [join(bundleDir, "output", "SKILL.md"), "# skill\n"],
          [join(bundleDir, "output", "references", "notes.md"), "notes\n"],
        ]);

        const before = yield* computeBundleHashes(bundleDir, "output-dir");
        const result = yield* recordSkillVersion("demo", actor, before.designHash, before.outputHash, {
          bundleDir,
          layout: "output-dir",
        });
        expect(result.status).toBe("appended");

        const snapshotDir = versionSnapshotDir(bundleDir, before.outputHash);
        // Named by the BARE hex -- no "sha256:" in the directory name.
        expect(snapshotDir).not.toContain("sha256:");
        expect(yield* fs.readFileString(join(snapshotDir, "design.md"))).toBe("# design\n");
        expect(yield* fs.readFileString(join(snapshotDir, "output", "SKILL.md"))).toBe("# skill\n");
        expect(yield* fs.readFileString(join(snapshotDir, "output", "references", "notes.md"))).toBe("notes\n");

        const files = yield* listVersionSnapshotFiles(bundleDir, before.outputHash);
        expect(files).toEqual(["design.md", "output/SKILL.md", "output/references/notes.md"]);

        // The snapshot must NOT change the hash computation: output/ is
        // untouched and the snapshot lives outside it.
        const after = yield* computeBundleHashes(bundleDir, "output-dir");
        expect(after).toEqual(before);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });

  test("in-place layout: keeps the payload + design.md, excludes studio-owned files, and the snapshot never changes the recorded hash", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const bundleDir = join(dir, "imported", "release-notes");
        yield* writeFiles([
          [join(bundleDir, "SKILL.md"), "# skill\n"],
          [join(bundleDir, "references", "guide.md"), "guide\n"],
          [join(bundleDir, "bundle.json"), `{"slug":"release-notes","name":"Release Notes"}\n`],
          [join(bundleDir, ".skillmaker-adopt.json"), "{}\n"],
          [join(bundleDir, "design.md"), "# design\n"],
          [join(bundleDir, "dossier.md"), "# dossier\n"],
        ]);

        const before = yield* computeBundleHashes(bundleDir, "in-place");
        yield* recordSkillVersion("release-notes", actor, before.designHash, before.outputHash, {
          bundleDir,
          layout: "in-place",
        });

        // The payload + design.md, nothing studio-owned.
        const files = yield* listVersionSnapshotFiles(bundleDir, before.outputHash);
        expect(files).toEqual(["SKILL.md", "design.md", "references/guide.md"]);
        const snapshotDir = versionSnapshotDir(bundleDir, before.outputHash);
        expect(yield* fs.exists(join(snapshotDir, "bundle.json"))).toBe(false);
        expect(yield* fs.exists(join(snapshotDir, "dossier.md"))).toBe(false);

        // The critical in-place invariant: the snapshot lands INSIDE the
        // bundle dir, yet the output hash is unchanged -- `.skillmaker` is in
        // `ADOPT_EXCLUDED_NAMES`, so recording a version never registers as
        // drift of the very content it recorded.
        const after = yield* computeBundleHashes(bundleDir, "in-place");
        expect(after).toEqual(before);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });

  test("re-recording identical content is a no-op receipt with the snapshot overwritten identically (and a snapshot never snapshots itself)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "imported", "release-notes");
        yield* writeFiles([
          [join(bundleDir, "SKILL.md"), "# skill\n"],
          [join(bundleDir, ".skillmaker-adopt.json"), "{}\n"],
        ]);

        const hashes = yield* computeBundleHashes(bundleDir, "in-place");
        const source = { bundleDir, layout: "in-place" } as const;
        const first = yield* recordSkillVersion("release-notes", actor, hashes.designHash, hashes.outputHash, source);
        const second = yield* recordSkillVersion("release-notes", actor, hashes.designHash, hashes.outputHash, source);
        expect(first.status).toBe("appended");
        expect(second.status).toBe("already_appended");

        // If the second record's walk had picked up the first record's
        // snapshot, the file list would contain `.skillmaker/versions/...`
        // entries -- it must stay exactly the payload.
        const files = yield* listVersionSnapshotFiles(bundleDir, hashes.outputHash);
        expect(files).toEqual(["SKILL.md"]);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });

  test("listVersionSnapshotFiles is honestly undefined for a receipt recorded before snapshots existed", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const files = yield* listVersionSnapshotFiles(join(dir, "skills", "demo"), "sha256:aaaa");
        expect(files).toBeUndefined();
      }),
    );
  });

  test("hashOutputTree's in-place exclusion covers the snapshot home (.skillmaker is studio plumbing, never output)", async () => {
    expect(ADOPT_EXCLUDED_NAMES.has(".skillmaker")).toBe(true);
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* fs.makeDirectory(join(dir, ".skillmaker", "versions", "abc"), { recursive: true });
        yield* fs.writeFileString(join(dir, ".skillmaker", "versions", "abc", "SKILL.md"), "old\n");
        yield* fs.writeFileString(join(dir, "SKILL.md"), "current\n");
        const withSnapshots = yield* hashOutputTree(dir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES });
        yield* fs.remove(join(dir, ".skillmaker"), { recursive: true });
        const without = yield* hashOutputTree(dir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES });
        expect(withSnapshots).toBe(without);
      }),
    );
  });
});

// Fix 4 (Phase 20 Story 2 friction log F6): everywhere a version renders
// (`skillmaker measurements`, the viewer's Evals validation chips), prefer
// the human label; fall back to a short (7-8 char, unprefixed) hash
// fragment only when no label was ever recorded, instead of a raw
// meaningless hash.
describe("versionLabel", () => {
  test("prefers the recorded label when one exists", () => {
    expect(versionLabel({ hash: "sha256:abcdef0123456789", label: "v0.3" })).toBe("v0.3");
  });

  test("falls back to a short, unprefixed hash fragment when no label exists", () => {
    expect(versionLabel({ hash: "sha256:abcdef0123456789" })).toBe("abcdef01");
  });

  test("falls back the same way for an empty-string label (never renders a blank)", () => {
    expect(versionLabel({ hash: "sha256:abcdef0123456789", label: "" })).toBe("abcdef01");
  });

  test("undefined version -> empty string, never throws", () => {
    expect(versionLabel(undefined)).toBe("");
  });

  test("a hash shorter than 8 hex chars is used in full, not padded", () => {
    expect(versionLabel({ hash: "sha256:ab12" })).toBe("ab12");
  });

  test("a non-sha256-prefixed hash still truncates to 8 chars", () => {
    expect(versionLabel({ hash: "abcdef0123456789" })).toBe("abcdef01");
  });
});
