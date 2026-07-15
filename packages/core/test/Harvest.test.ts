import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { harvestFixture } from "../src/Harvest.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

describe("harvestFixture", () => {
  test("errors with HarvestEventNotFoundError when the event id isn't in the journal at all", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const outcome = yield* harvestFixture({
          bundle: "demo",
          bundleDir,
          caseName: "hard-case-1",
          eventId: "does-not-exist",
          klass: "hard-case",
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("HarvestEventNotFoundError");
      }),
    );
  });

  test("errors with HarvestNotFieldReportError when the named event is real but not a skill.field_report", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "demo" },
          });
          return yield* harvestFixture({
            bundle: "demo",
            bundleDir,
            caseName: "hard-case-1",
            eventId: appended.event.id,
            klass: "hard-case",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("HarvestNotFieldReportError");
        if (outcome._tag === "HarvestNotFieldReportError") {
          expect(outcome.eventType).toBe("bundle.created");
        }
      }),
    );
  });

  test("errors with HarvestWrongBundleError when the report names a different bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "other-skill", outcome: "failed", report: "Broke badly." },
          });
          return yield* harvestFixture({
            bundle: "demo",
            bundleDir,
            caseName: "hard-case-1",
            eventId: appended.event.id,
            klass: "hard-case",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("HarvestWrongBundleError");
        if (outcome._tag === "HarvestWrongBundleError") {
          expect(outcome.reportBundle).toBe("other-skill");
        }
      }),
    );
  });

  test("errors with HarvestCaseExistsError when evals/fixtures/<case>/ already exists", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const fs = yield* FileSystem;
        yield* fs.makeDirectory(join(bundleDir, "evals", "fixtures", "hard-case-1"), { recursive: true });

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo", outcome: "failed", report: "Broke badly." },
          });
          return yield* harvestFixture({
            bundle: "demo",
            bundleDir,
            caseName: "hard-case-1",
            eventId: appended.event.id,
            klass: "hard-case",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("HarvestCaseExistsError");
      }),
    );
  });

  test("happy path: writes case.json with provenance and seeds prompt.md from the report's prose verbatim", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: {
              bundle: "demo",
              outcome: "failed",
              report: "Broke on a repo with no package.json.",
              destination: "acme-agent-fleet",
            },
          });
          return { eventId: appended.event.id, result: yield* harvestFixture({
            bundle: "demo",
            bundleDir,
            caseName: "hard-case-1",
            eventId: appended.event.id,
            klass: "hard-case",
          }) };
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.result.caseName).toBe("hard-case-1");
        expect(result.result.class).toBe("hard-case");
        expect(result.result.source).toEqual({
          kind: "field-report",
          eventId: result.eventId,
          destination: "acme-agent-fleet",
        });

        const fs = yield* FileSystem;
        const caseDir = join(bundleDir, "evals", "fixtures", "hard-case-1");
        const caseJson = JSON.parse(yield* fs.readFileString(join(caseDir, "case.json"))) as {
          readonly case: string;
          readonly class: string;
          readonly risks: ReadonlyArray<string>;
          readonly source: unknown;
        };
        expect(caseJson.case).toBe("hard-case-1");
        expect(caseJson.class).toBe("hard-case");
        expect(caseJson.risks).toEqual([]);
        expect(caseJson.source).toEqual({
          kind: "field-report",
          eventId: result.eventId,
          destination: "acme-agent-fleet",
        });

        const prompt = yield* fs.readFileString(join(caseDir, "prompt.md"));
        expect(prompt).toBe("Broke on a repo with no package.json.\n");

        expect(yield* fs.exists(join(caseDir, "files", ".gitkeep"))).toBe(true);
        expect(yield* fs.exists(join(caseDir, "expected", "answer-key.md"))).toBe(true);

        // Fixtures are files, not events -- harvesting must not append to
        // the journal beyond the field report already there.
        const raw = yield* fs.readFileString(journalPath);
        const lines = raw.trim().split("\n");
        expect(lines).toHaveLength(1);
      }),
    );
  });

  test("happy path: a report with no destination omits it from source, same optionality as the field report itself", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo", outcome: "surprise", report: "Used a tool we didn't expect." },
          });
          return yield* harvestFixture({
            bundle: "demo",
            bundleDir,
            caseName: "hard-case-2",
            eventId: appended.event.id,
            klass: "hard-case",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.source.destination).toBeUndefined();
      }),
    );
  });
});
