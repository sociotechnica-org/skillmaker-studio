import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { BundleCreatedEvent, SkillVersionRecordedEvent } from "../src/Journal.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import {
  computeDrift,
  foldSkillVersions,
  hashDesign,
  hashOutputTree,
  latestSkillVersion,
  recordSkillVersion,
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

describe("recordSkillVersion (Fix F3: the exact Story-1 duplicate-hash sequence)", () => {
  test("a repeat with IDENTICAL hashes+payload is a clean no-op, not a duplicate journal line", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journal = yield* Journal;
        const first = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1");
        const second = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1");

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
        const adoptResult = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", {
          label: "adopted",
        });
        expect(adoptResult.status).toBe("appended");

        // Step 2: a later `run` (unchanged content -> same hashes) auto-
        // records again, exactly like RunEngine.ts's drift check, but WITHOUT
        // the "adopted" label in its payload -- different content under the
        // same idempotency key, so it must conflict, not silently duplicate.
        const runOutcome = yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1").pipe(Effect.flip);
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
        yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1", { label: "adopted" });

        // Mirrors RunEngine.ts's `.pipe(Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void))`.
        yield* recordSkillVersion("demo", actor, "sha256:d1", "sha256:h1").pipe(
          Effect.catchTag("JournalIdempotencyConflictError", () => Effect.void),
        );

        const all = yield* journal.readAll();
        expect(all.filter((e) => e.type === "skill.version_recorded").length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(join(dir, "events.jsonl")))),
    );
  });
});
