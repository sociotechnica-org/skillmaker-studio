import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as IndexServiceLayer, IndexService } from "../src/IndexService.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { layer as WorkspaceLayer, Workspace } from "../src/WorkspaceService.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

describe("IndexService.rebuild", () => {
  test("scans skills/*/bundle.json and folds the journal into the bundles table", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "alpha" });
        yield* workspace.createBundle(dir, { slug: "beta" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:alpha",
            payload: { bundle: "alpha" },
          });
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:beta",
            payload: { bundle: "beta" },
          });
          yield* journal.append({
            type: "bundle.stage_changed",
            actor,
            payload: { bundle: "alpha", from: "idea", to: "researching" },
          });
          yield* journal.append({
            type: "review.requested",
            actor,
            payload: { bundle: "alpha", state: "researching" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.bundles).toBe(2);
          expect(result.events).toBe(4);
          expect(result.warnings).toEqual([]);

          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(2);

          const alpha = bundles.find((b) => b.slug === "alpha");
          expect(alpha).toMatchObject({
            slug: "alpha",
            name: "Alpha",
            oneLiner: "",
            tags: [],
            stage: "researching",
            substate: "awaiting-review",
            archived: false,
          });
          expect(typeof alpha?.created).toBe("string");

          const beta = yield* index.getBundle("beta");
          expect(beta?.stage).toBe("idea");
          expect(beta?.substate).toBe("working");
          expect(beta?.archived).toBe(false);

          const missing = yield* index.getBundle("does-not-exist");
          expect(missing).toBeUndefined();
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a bundle on disk but absent from the journal appears with default state", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "orphan" });

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings).toEqual([]);
          const bundle = yield* index.getBundle("orphan");
          expect(bundle?.stage).toBe("idea");
          expect(bundle?.substate).toBe("working");
          expect(bundle?.archived).toBe(false);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a bundle in the journal but missing on disk appears with a warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "ghost" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings.length).toBe(1);
          expect(result.warnings[0]).toContain("ghost");
          const bundle = yield* index.getBundle("ghost");
          expect(bundle?.name).toBe("ghost");
          expect(bundle?.stage).toBe("idea");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("malformed bundle.json produces a warning, not a failure", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "broken" });

        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* fs.writeFileString(
          path.join(dir, "skills", "broken", "bundle.json"),
          "{ this is not valid json",
        );

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.bundles).toBe(0);
          expect(result.warnings.length).toBe(1);
          expect(result.warnings[0]).toContain("broken");
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(0);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("listBundles rebuilds automatically when studio.db is missing", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "fresh" });

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(1);
          expect(bundles[0]?.slug).toBe("fresh");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});
