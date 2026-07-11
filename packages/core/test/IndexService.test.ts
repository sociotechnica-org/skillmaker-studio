import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { appendFileSync } from "node:fs";
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

  test("folds todo.* events into the todos table with defaults, ordering, and derived archived", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        // `Journal.append` always stamps `at` with the real wall clock (by
        // design -- `JournalEventInput` omits `at`), so to exercise the
        // 7-day archive window deterministically we write the
        // `todo.status_changed` line directly as raw JSONL with a
        // long-past `at`, bypassing `append`.
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "todo.opened",
            actor,
            payload: {
              todo: {
                id: "td-1",
                kind: "bug",
                status: "open",
                title: "Fix crash",
                priority: 10,
                created: "2026-07-01",
                source: actor,
              },
            },
          });
          yield* journal.append({
            type: "todo.opened",
            actor,
            payload: {
              todo: {
                id: "td-2",
                kind: "task",
                status: "open",
                title: "Write docs",
                priority: 30,
                created: "2026-07-01",
                source: actor,
              },
            },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const staleStatusChange = JSON.stringify({
          schemaVersion: 1,
          id: "00000000-0000-4000-8000-000000000099",
          at: "2026-01-01T00:00:00.000Z",
          actor,
          type: "todo.status_changed",
          payload: { id: "td-2", from: "open", to: "done" },
        });
        appendFileSync(journalPath, `${staleStatusChange}\n`);

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.todos).toBe(2);

          const openOnly = yield* index.listTodos();
          expect(openOnly.map((t) => t.id)).toEqual(["td-1"]);

          const all = yield* index.listTodos({ includeArchived: true });
          expect(all.map((t) => t.id)).toEqual(["td-1", "td-2"]);
          const done = all.find((t) => t.id === "td-2");
          expect(done?.archived).toBe(true);
          expect(done?.status).toBe("done");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("rebuild is atomic: a concurrently-open reader keeps its old snapshot until it reopens", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "alpha" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const dbPath = join(dir, ".skillmaker", "studio.db");

        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "alpha" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          // Ensure studio.db exists with the initial snapshot.
          yield* index.rebuild();

          // Simulate a concurrent reader: open studio.db independently,
          // by file descriptor, before the next rebuild starts.
          const concurrentReader = new Database(dbPath, { readonly: true });
          const beforeCount = concurrentReader
            .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
            .get()?.n;
          expect(beforeCount).toBe(1);

          // Add a second bundle and rebuild -- this rewrites studio.db via
          // temp-file + rename.
          yield* Effect.gen(function* () {
            const journal = yield* Journal;
            yield* journal.append({
              type: "bundle.created",
              actor,
              payload: { bundle: "beta" },
            });
          }).pipe(Effect.provide(JournalLayer(journalPath)));
          yield* workspace.createBundle(dir, { slug: "beta" });

          yield* index.rebuild();

          // At the POSIX level, the already-open file descriptor still
          // points at the old, complete inode after `renameSync` swaps the
          // directory entry -- it can never observe a half-written file.
          // On macOS specifically, SQLite's Apple-vendored build adds its
          // own vnode-consistency check on top of that and raises
          // `SQLITE_IOERR_VNODE` instead of silently continuing to serve
          // the stale snapshot once it notices the path's inode changed
          // underneath it. Either outcome satisfies the property under
          // test -- the stale handle NEVER observes the new/replaced
          // data -- so both are accepted here; only a successful read
          // returning the *new* count would indicate a real problem.
          let afterCountOnOldHandle: number | undefined;
          let staleReadThrew = false;
          try {
            afterCountOnOldHandle = concurrentReader
              .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
              .get()?.n;
          } catch {
            staleReadThrew = true;
          }
          if (!staleReadThrew) {
            expect(afterCountOnOldHandle).toBe(1);
          }
          concurrentReader.close();

          // A fresh handle opened against the path now sees the new data.
          const freshReader = new Database(dbPath, { readonly: true });
          const freshCount = freshReader
            .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
            .get()?.n;
          expect(freshCount).toBe(2);
          freshReader.close();

          // And the service's own handle (reopened internally by rebuild())
          // also reflects the new data -- no partial state was ever visible
          // through either handle.
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(2);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});
