import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { AdoptMarker } from "../src/Adopt.ts";
import { BundleIdentity } from "../src/Bundle.ts";
import { JournalEvent } from "../src/Journal.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { receiveCrate } from "../src/Receive.ts";
import { routeCrate } from "../src/Route.ts";
import { computeBundleHashes } from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const writeCrateSource = (dir: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(join(dir, "SKILL.md"), content);
  });

/** Writes a real, pre-existing bundle (bundle.json + design.md + output/SKILL.md), mirroring what `skillmaker new` + a version record would produce -- the "existing bundle" fixture every return/upgrade/fork test routes against. */
const writeExistingBundle = (workspaceRoot: string, slug: string, skillMdContent: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const bundleDir = join(workspaceRoot, "skills", slug);
    yield* fs.makeDirectory(join(bundleDir, "output"), { recursive: true });
    yield* fs.writeFileString(
      join(bundleDir, "bundle.json"),
      `${JSON.stringify(
        BundleIdentity.make({
          schemaVersion: 1,
          slug,
          name: slug,
          oneLiner: "",
          tags: [],
          created: "2026-07-01",
          targets: ["claude-code"],
        }),
        null,
        2,
      )}\n`,
    );
    yield* fs.writeFileString(join(bundleDir, "design.md"), `# ${slug}\n`);
    yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), skillMdContent);
    return bundleDir;
  });

describe("SkillRoutedEvent schema", () => {
  test("decodes through the JournalEvent union with bundle present", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(JournalEvent)({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-16T00:00:00.000Z",
        actor,
        type: "skill.routed",
        payload: { intake: "in-1", disposition: "new", bundle: "demo", reason: "no overlap" },
      }),
    );
    expect(decoded.type).toBe("skill.routed");
  });

  test("decodes with no bundle at all -- salvage-without-target", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(JournalEvent)({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-16T00:00:00.000Z",
        actor,
        type: "skill.routed",
        payload: { intake: "in-1", disposition: "salvage", reason: "hypothesis broken" },
      }),
    );
    expect(decoded.type).toBe("skill.routed");
    if (decoded.type === "skill.routed") {
      expect(decoded.payload.bundle).toBeUndefined();
    }
  });

  test("rejects an unknown disposition", async () => {
    const outcome = await Effect.runPromise(
      Effect.flip(
        Schema.decodeUnknownEffect(JournalEvent)({
          schemaVersion: 1,
          id: crypto.randomUUID(),
          at: "2026-07-16T00:00:00.000Z",
          actor,
          type: "skill.routed",
          payload: { intake: "in-1", disposition: "delete", reason: "nope" },
        }),
      ),
    );
    expect(outcome).toBeDefined();
  });
});

describe("routeCrate: unknown/already-routed intake", () => {
  test("errors with RouteIntakeNotFoundError for an unknown intake id", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: "in-does-not-exist",
          disposition: "salvage",
          reason: "no crate here",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteIntakeNotFoundError");
      }),
    );
  });

  test("re-routing with the SAME disposition is a no-op (alreadyRouted: true, no new event)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const sourcePath = join(dir, "incoming", "crate-a");
        yield* writeCrateSource(sourcePath, "---\nname: crate-a\n---\nDo the thing.\n");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const first = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          reason: "hypothesis broken",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(first.alreadyRouted).toBe(false);

        const second = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          reason: "a different reason, still the same disposition",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(second.alreadyRouted).toBe(true);

        const events = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          return yield* journal.readAll();
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(events.filter((event) => event.type === "skill.routed")).toHaveLength(1);
      }),
    );
  });

  test("re-routing with a DIFFERENT disposition is RouteAlreadyRoutedError", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const sourcePath = join(dir, "incoming", "crate-b");
        yield* writeCrateSource(sourcePath, "---\nname: crate-b\n---\nDo the thing.\n");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          reason: "hypothesis broken",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "new",
          reason: "changed my mind",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteAlreadyRoutedError");
      }),
    );
  });
});

describe("routeCrate: return", () => {
  test("errors with RouteBundleNotFoundError when --bundle names an unknown bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const sourcePath = join(dir, "incoming", "crate-c");
        yield* writeCrateSource(sourcePath, "---\nname: crate-c\n---\nDo the thing.\n");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "return",
          bundle: "no-such-bundle",
          reason: "ours coming home",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteBundleNotFoundError");
      }),
    );
  });

  test("errors with RouteNoHashMatchError when the crate's content doesn't match the named bundle's recorded versions", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeExistingBundle(dir, "demo", "---\nname: demo\n---\nOriginal content.\n");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "demo" } });
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: "sha256:not-the-real-hash", designHash: "sha256:whatever" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const sourcePath = join(dir, "incoming", "crate-d");
        yield* writeCrateSource(sourcePath, "---\nname: demo\n---\nCompletely different content.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "return",
          bundle: "demo",
          reason: "claims to be ours",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteNoHashMatchError");
      }),
    );
  });

  test("succeeds with a genuine hash match, no file movement at all", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const skillMdContent = "---\nname: demo\n---\nThe real content.\n";
        const bundleDir = yield* writeExistingBundle(dir, "demo", skillMdContent);
        const hashes = yield* computeBundleHashes(bundleDir);
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "demo" } });
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: hashes.outputHash, designHash: hashes.designHash },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const sourcePath = join(dir, "incoming", "crate-e");
        yield* writeCrateSource(sourcePath, skillMdContent);
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "a returning laptop", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );
        expect(received.verdict).toBe("return");

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "return",
          bundle: "demo",
          reason: "ours, coming home",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.disposition).toBe("return");
        expect(result.bundle).toBe("demo");
        // No file movement: the crate is still sitting exactly where it was received.
        expect(existsSync(join(received.receivedDir, "SKILL.md"))).toBe(true);
        expect(existsSync(join(bundleDir, "output", "SKILL.md"))).toBe(true);
      }),
    );
  });
});

describe("routeCrate: new", () => {
  test("moves the crate directory into skills/<slug>/, mints bundle.json + marker, records bundle.created and a version", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "totally-new");
        yield* writeCrateSource(sourcePath, "---\nname: Totally New Skill\n---\nDo a new thing.\n");
        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "a github export",
          ref: "main",
          claimedName: "Totally New Skill",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(received.verdict).toBe("new");

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "new",
          reason: "no overlap with anything we hold",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.slug).toBe("totally-new-skill");
        expect(result.bundle).toBe("totally-new-skill");
        expect(result.versionHash).toBeDefined();

        const bundleDir = join(dir, "skills", "totally-new-skill");
        expect(existsSync(join(bundleDir, "SKILL.md"))).toBe(true);
        expect(existsSync(join(bundleDir, "bundle.json"))).toBe(true);
        expect(existsSync(join(bundleDir, ".skillmaker-adopt.json"))).toBe(true);
        // The crate directory is gone -- it MOVED, it wasn't copied.
        expect(existsSync(received.receivedDir)).toBe(false);

        const marker = JSON.parse(readFileSync(join(bundleDir, ".skillmaker-adopt.json"), "utf8")) as {
          upstream?: { source: string; ref?: string };
        };
        expect(marker.upstream?.source).toBe("a github export");
        expect(marker.upstream?.ref).toBe("main");

        const events = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          return yield* journal.readAll();
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(events.some((event) => event.type === "bundle.created" && event.payload.bundle === "totally-new-skill")).toBe(
          true,
        );
        expect(
          events.some((event) => event.type === "skill.version_recorded" && event.payload.bundle === "totally-new-skill"),
        ).toBe(true);
        expect(
          events.some(
            (event) =>
              event.type === "skill.routed" && event.payload.intake === received.intake && event.payload.bundle === "totally-new-skill",
          ),
        ).toBe(true);
      }),
    );
  });

  test("errors with RouteSlugCollisionError when the derived slug is already a bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeExistingBundle(dir, "taken-name", "---\nname: taken-name\n---\nAlready here.\n");

        const sourcePath = join(dir, "incoming", "collider");
        yield* writeCrateSource(sourcePath, "---\nname: Taken Name\n---\nA stranger with the same name.\n");
        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          claimedName: "Taken Name",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "new",
          reason: "no overlap (mistaken)",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteSlugCollisionError");
      }),
    );
  });

  test("--stage past idea is recorded as an honest override move", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "working-arrival");
        yield* writeCrateSource(sourcePath, "---\nname: Working Arrival\n---\nAlready working.\n");
        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          claimedName: "Working Arrival",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "new",
          stage: "drafting",
          reason: "arrived already drafted",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const events = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          return yield* journal.readAll();
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        const stageChange = events.find((event) => event.type === "bundle.stage_changed");
        expect(stageChange).toBeDefined();
        if (stageChange?.type === "bundle.stage_changed") {
          expect(stageChange.payload.from).toBe("idea");
          expect(stageChange.payload.to).toBe("drafting");
          expect(stageChange.payload.override).toBe(true);
          expect(stageChange.payload.reason).toBe("arrived already drafted");
        }
      }),
    );
  });
});

describe("routeCrate: fork", () => {
  test("errors with RouteBundleNotFoundError when --parent names an unknown bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "fork-attempt");
        yield* writeCrateSource(sourcePath, "---\nname: Fork Attempt\n---\nDiverged.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "fork",
          parent: "no-such-parent",
          reason: "forked from nothing",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteBundleNotFoundError");
      }),
    );
  });

  test("mints a new bundle with the parent link recorded on its marker's forkOf", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeExistingBundle(dir, "parent-skill", "---\nname: parent-skill\n---\nThe original.\n");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "parent-skill" } });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const sourcePath = join(dir, "incoming", "diverged-variant");
        yield* writeCrateSource(sourcePath, "---\nname: Diverged Variant\n---\nA different intent.\n");
        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          claimedName: "Diverged Variant",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "fork",
          parent: "parent-skill",
          reason: "shares ancestry with parent-skill but diverges on X",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.slug).toBe("diverged-variant");
        expect(result.parent).toBe("parent-skill");

        const markerPath = join(dir, "skills", "diverged-variant", ".skillmaker-adopt.json");
        const marker = Schema.decodeUnknownSync(AdoptMarker)(JSON.parse(readFileSync(markerPath, "utf8")));
        expect(marker.forkOf).toBe("parent-skill");
      }),
    );
  });
});

describe("routeCrate: upgrade", () => {
  test("errors with RouteBundleNotFoundError when --bundle names an unknown bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "upgrade-attempt");
        yield* writeCrateSource(sourcePath, "---\nname: demo\n---\nEvolved content.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "upgrade",
          bundle: "no-such-bundle",
          reason: "evolved",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteBundleNotFoundError");
      }),
    );
  });

  test("lands the crate's content into the existing bundle's output/ and records a new version", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const bundleDir = yield* writeExistingBundle(dir, "demo", "---\nname: demo\n---\nOriginal content.\n");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "demo" } });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const sourcePath = join(dir, "incoming", "demo-evolved");
        yield* writeCrateSource(sourcePath, "---\nname: demo\ndescription: v2\n---\nEvolved content entirely.\n");
        const received = yield* receiveCrate({
          workspaceRoot: dir,
          sourcePath,
          source: "test",
          claimedName: "demo",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(received.verdict).toBe("conflict");

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "upgrade",
          bundle: "demo",
          reason: "hypothesis evolved -- same skill, new approach",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.bundle).toBe("demo");
        expect(result.versionHash).toBeDefined();

        const landedContent = readFileSync(join(bundleDir, "output", "SKILL.md"), "utf8");
        expect(landedContent).toContain("Evolved content entirely.");

        // The crate itself is untouched -- upgrade never moves/deletes it (unlike new/fork).
        expect(existsSync(join(received.receivedDir, "SKILL.md"))).toBe(true);

        const events = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          return yield* journal.readAll();
        }).pipe(Effect.provide(JournalLayer(journalPath)));
        const versionEvents = events.filter(
          (event) => event.type === "skill.version_recorded" && event.payload.bundle === "demo",
        );
        expect(versionEvents).toHaveLength(1);
      }),
    );
  });
});

describe("routeCrate: salvage", () => {
  test("no identity granted, no file movement -- the crate stays at the dock, un-accessioned, retained as evidence", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "broken-hypothesis");
        yield* writeCrateSource(sourcePath, "---\nname: broken-hypothesis\n---\nDoesn't hold up.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          reason: "hypothesis broken -- doesn't survive contact with real cases",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.bundle).toBeUndefined();
        // The crate is retained, untouched, still at the dock.
        expect(existsSync(join(received.receivedDir, "SKILL.md"))).toBe(true);
        // No new bundle.json/bundle.created anywhere -- no identity granted.
        expect(existsSync(join(dir, "skills"))).toBe(false);
      }),
    );
  });

  test("--bundle names the existing bundle being defended", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* writeExistingBundle(dir, "existing-skill", "---\nname: existing-skill\n---\nStill here.\n");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "existing-skill" } });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const sourcePath = join(dir, "incoming", "counter-evidence");
        yield* writeCrateSource(sourcePath, "---\nname: existing-skill\n---\nA broken variant.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const result = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          bundle: "existing-skill",
          reason: "counter-evidence for existing-skill's edge cases",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.bundle).toBe("existing-skill");
      }),
    );
  });

  test("errors with RouteBundleNotFoundError when --bundle names an unknown bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const sourcePath = join(dir, "incoming", "salvage-unknown");
        yield* writeCrateSource(sourcePath, "---\nname: salvage-unknown\n---\nEvidence.\n");
        const received = yield* receiveCrate({ workspaceRoot: dir, sourcePath, source: "test", actor }).pipe(
          Effect.provide(JournalLayer(journalPath)),
        );

        const outcome = yield* routeCrate({
          workspaceRoot: dir,
          skillsDir: "skills",
          intake: received.intake,
          disposition: "salvage",
          bundle: "no-such-bundle",
          reason: "counter-evidence",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);
        expect(outcome._tag).toBe("RouteBundleNotFoundError");
      }),
    );
  });
});
