import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { SkillReceivedEvent } from "../src/Journal.ts";
import { layer as JournalLayer } from "../src/JournalService.ts";
import {
  deriveIntakeVerdict,
  hashReceivedCrate,
  listUndisposedIntake,
  newIntakeId,
  receiveCrate,
  type IntakeRegistry,
} from "../src/Receive.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const receivedEvent = (intake: string, at: string, claimedName?: string): JournalEvent =>
  SkillReceivedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at,
    actor,
    type: "skill.received",
    payload: { intake, source: "test", ...(claimedName !== undefined ? { claimedName } : {}) },
  });

const writeCrate = (dir: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(join(dir, "SKILL.md"), content);
  });

describe("newIntakeId", () => {
  test("has the in-<uuid> shape (mirrors Todo.ts's td-<ulid> pattern)", () => {
    const id = newIntakeId();
    expect(id).toMatch(/^in-[0-9a-f-]{36}$/);
  });

  test("is unique per call", () => {
    expect(newIntakeId()).not.toBe(newIntakeId());
  });
});

describe("deriveIntakeVerdict", () => {
  const registry: IntakeRegistry = {
    bundles: [{ slug: "demo-skill", name: "Demo Skill" }],
    recordedHashes: new Set(["sha256:matching"]),
  };

  test("return: the computed hash matches a recorded version, regardless of claims", () => {
    expect(deriveIntakeVerdict("sha256:matching", undefined, registry)).toBe("return");
    expect(deriveIntakeVerdict("sha256:matching", "Some Other Name", registry)).toBe("return");
  });

  test("conflict: claimed name overlaps an existing bundle's slug/name with different content", () => {
    expect(deriveIntakeVerdict("sha256:different", "Demo Skill", registry)).toBe("conflict");
    expect(deriveIntakeVerdict("sha256:different", "demo-skill", registry)).toBe("conflict");
    // Loose match: different casing/punctuation still folds to the same slug.
    expect(deriveIntakeVerdict("sha256:different", "  DEMO   Skill! ", registry)).toBe("conflict");
  });

  test("new: no hash overlap and no claimed-name overlap", () => {
    expect(deriveIntakeVerdict("sha256:different", "Totally Unrelated Skill", registry)).toBe("new");
  });

  test("no-claims case: new with no claimedName at all -- never a distinct verdict, never an error", () => {
    expect(deriveIntakeVerdict("sha256:different", undefined, registry)).toBe("new");
    const emptyRegistry: IntakeRegistry = { bundles: [], recordedHashes: new Set() };
    expect(deriveIntakeVerdict("sha256:anything", undefined, emptyRegistry)).toBe("new");
  });
});

describe("listUndisposedIntake", () => {
  test("every received crate is undisposed today (no skill.routed event type exists yet)", () => {
    const events = [
      receivedEvent("in-1", "2026-07-01T00:00:00.000Z"),
      receivedEvent("in-2", "2026-07-02T00:00:00.000Z"),
    ];
    const undisposed = listUndisposedIntake(events);
    expect(undisposed.map((event) => event.payload.intake)).toEqual(["in-1", "in-2"]);
  });

  test("forward-compatible: a future skill.routed event referencing an intake id excludes it, with zero changes to this function", () => {
    const events: ReadonlyArray<JournalEvent> = [
      receivedEvent("in-1", "2026-07-01T00:00:00.000Z"),
      receivedEvent("in-2", "2026-07-02T00:00:00.000Z"),
      // Not yet a real JournalEvent member (skill.routed ships next issue) --
      // constructed as a raw envelope to prove listUndisposedIntake's
      // string-compared filter already handles it correctly.
      {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-03T00:00:00.000Z",
        actor,
        type: "skill.routed",
        payload: { intake: "in-1", disposition: "new", reason: "no overlap" },
      } as unknown as JournalEvent,
    ];
    const undisposed = listUndisposedIntake(events);
    expect(undisposed.map((event) => event.payload.intake)).toEqual(["in-2"]);
  });

  test("ignores non-skill.received events entirely", () => {
    const events: ReadonlyArray<JournalEvent> = [
      {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-01T00:00:00.000Z",
        actor,
        type: "bundle.created",
        payload: { bundle: "demo" },
      } as unknown as JournalEvent,
      receivedEvent("in-1", "2026-07-02T00:00:00.000Z"),
    ];
    expect(listUndisposedIntake(events).map((event) => event.payload.intake)).toEqual(["in-1"]);
  });
});

describe("receiveCrate", () => {
  test("copies the crate to receiving/<intake-id>/, leaving the source directory untouched", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const sourcePath = join(dir, "incoming", "some-skill");
        yield* writeCrate(sourcePath, "---\nname: some-skill\n---\nDo the thing.\n");

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const result = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "local test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.intake).toMatch(/^in-/);
        expect(result.verdict).toBe("new");
        expect(result.receivedDir).toBe(join(dir, "receiving", result.intake));

        // The source is untouched -- never moved.
        expect(existsSync(join(sourcePath, "SKILL.md"))).toBe(true);
        expect(readFileSync(join(sourcePath, "SKILL.md"), "utf8")).toContain("Do the thing.");

        // The crate is genuinely copied, not linked/aliased.
        expect(existsSync(join(result.receivedDir, "SKILL.md"))).toBe(true);
        expect(readFileSync(join(result.receivedDir, "SKILL.md"), "utf8")).toBe(
          readFileSync(join(sourcePath, "SKILL.md"), "utf8"),
        );

        // `Journal` is only in scope inside the `.pipe(Effect.provide(...))`
        // above -- read the raw journal line directly instead, same pattern
        // `Ship.test.ts` uses for post-hoc journal inspection.
        const rawLines = readFileSync(journalPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: Record<string, unknown> });
        const received = rawLines.find((event) => event.type === "skill.received");
        expect(received).toBeDefined();
        expect(received?.payload).toEqual({ intake: result.intake, source: "local test" });
        // No bundle field at all -- a crate has no identity yet.
        expect(received?.payload.bundle).toBeUndefined();
      }),
    );
  });

  test("errors with ReceivePathNotFoundError for a missing path", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const outcome = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath: join(dir, "does-not-exist"),
          source: "local test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("ReceivePathNotFoundError");
      }),
    );
  });

  test("errors with ReceivePathNotDirectoryError when the path is a file", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const filePath = join(dir, "not-a-dir.txt");
        yield* fs.writeFileString(filePath, "just a file");

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const outcome = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath: filePath,
          source: "local test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("ReceivePathNotDirectoryError");
      }),
    );
  });

  test("errors with ReceiveNotASkillError for a directory with no SKILL.md", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const notASkill = join(dir, "not-a-skill");
        yield* fs.makeDirectory(notASkill, { recursive: true });
        yield* fs.writeFileString(join(notASkill, "README.md"), "just a readme");

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const outcome = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath: notASkill,
          source: "local test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("ReceiveNotASkillError");
      }),
    );
  });

  test("records optional claims verbatim when given", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const sourcePath = join(dir, "incoming", "claimed-skill");
        yield* writeCrate(sourcePath, "---\nname: claimed-skill\n---\nDo the thing.\n");

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "acme export",
          ref: "main",
          claimedName: "Frame the Problem",
          claimedVersionHash: "sha256:claimed",
          rights: "unclear",
          notes: "arrived via shared drive",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const rawLines = readFileSync(journalPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: Record<string, unknown> });
        const received = rawLines.find((event) => event.type === "skill.received");
        expect(received?.payload).toMatchObject({
          source: "acme export",
          ref: "main",
          claimedName: "Frame the Problem",
          claimedVersionHash: "sha256:claimed",
          rights: "unclear",
          notes: "arrived via shared drive",
        });
      }),
    );
  });
});

describe("hashReceivedCrate", () => {
  test("is sensitive to crate content, mirroring an in-place bundle's exclusion rules for studio scaffolding", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const crateA = join(dir, "crate-a");
        yield* writeCrate(crateA, "one content");
        const hashA = yield* hashReceivedCrate(crateA);

        const crateB = join(dir, "crate-b");
        yield* writeCrate(crateB, "different content");
        const hashB = yield* hashReceivedCrate(crateB);

        expect(hashA).not.toBe(hashB);

        // A crate that also carries studio scaffolding (e.g. it was
        // previously adopted elsewhere) still hashes to the same value as
        // one without it -- the excluded names are ignored.
        const fs = yield* FileSystem;
        yield* fs.writeFileString(join(crateA, "bundle.json"), "{}");
        const hashAWithScaffolding = yield* hashReceivedCrate(crateA);
        expect(hashAWithScaffolding).toBe(hashA);
      }),
    );
  });
});
