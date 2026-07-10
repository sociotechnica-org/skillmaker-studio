import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

describe("Journal.append idempotency", () => {
  test("same idempotencyKey + same content is a no-op", async () => {
    await withTempDir((dir) => {
      const journalPath = join(dir, "events.jsonl");
      return Effect.gen(function* () {
        const journal = yield* Journal;
        const first = yield* journal.append({
          type: "bundle.created",
          actor,
          idempotencyKey: "bundle.created:demo",
          payload: { bundle: "demo" },
        });
        const second = yield* journal.append({
          type: "bundle.created",
          actor,
          idempotencyKey: "bundle.created:demo",
          payload: { bundle: "demo" },
        });

        expect(first.status).toBe("appended");
        expect(second.status).toBe("already_appended");
        expect(second.event.id).toBe(first.event.id);

        const all = yield* journal.readAll();
        expect(all.length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(journalPath)));
    });
  });

  test("same idempotencyKey + different payload conflicts", async () => {
    await withTempDir((dir) => {
      const journalPath = join(dir, "events.jsonl");
      return Effect.gen(function* () {
        const journal = yield* Journal;
        yield* journal.append({
          type: "bundle.created",
          actor,
          idempotencyKey: "bundle.created:demo",
          payload: { bundle: "demo" },
        });

        const outcome = yield* journal
          .append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:demo",
            payload: { bundle: "different-bundle" },
          })
          .pipe(Effect.flip);

        expect(outcome._tag).toBe("JournalIdempotencyConflictError");

        const all = yield* journal.readAll();
        expect(all.length).toBe(1);
      }).pipe(Effect.provide(JournalLayer(journalPath)));
    });
  });

  test("no idempotencyKey appends every call", async () => {
    await withTempDir((dir) => {
      const journalPath = join(dir, "events.jsonl");
      return Effect.gen(function* () {
        const journal = yield* Journal;
        yield* journal.append({
          type: "bundle.archived",
          actor,
          payload: { bundle: "demo" },
        });
        yield* journal.append({
          type: "bundle.archived",
          actor,
          payload: { bundle: "demo" },
        });

        const all = yield* journal.readAll();
        expect(all.length).toBe(2);
      }).pipe(Effect.provide(JournalLayer(journalPath)));
    });
  });

  test("repairs a missing trailing newline before appending", async () => {
    await withTempDir((dir) => {
      const journalPath = join(dir, "events.jsonl");
      return Effect.gen(function* () {
        const journal = yield* Journal;
        yield* journal.append({
          type: "bundle.archived",
          actor,
          payload: { bundle: "one" },
        });

        // Simulate a partial write: strip the trailing newline.
        const raw = yield* Effect.promise(() => Bun.file(journalPath).text());
        yield* Effect.promise(() => Bun.write(journalPath, raw.replace(/\n$/, "")));

        yield* journal.append({
          type: "bundle.archived",
          actor,
          payload: { bundle: "two" },
        });

        const all = yield* journal.readAll();
        expect(all.length).toBe(2);
        expect(all.map((event) => event.payload)).toEqual([
          { bundle: "one" },
          { bundle: "two" },
        ]);
      }).pipe(Effect.provide(JournalLayer(journalPath)));
    });
  });
});
