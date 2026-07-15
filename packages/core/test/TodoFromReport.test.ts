import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Actor } from "../src/Actor.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { openTodoFromReport, TODO_KIND_BY_OUTCOME } from "../src/TodoFromReport.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const baseInput = {
  title: "Fix the crash",
  actor,
  id: "td-1",
  created: "2026-07-15",
};

describe("openTodoFromReport", () => {
  test("errors with TodoFromReportEventNotFoundError when the event id isn't in the journal at all", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;
        const outcome = yield* openTodoFromReport({
          ...baseInput,
          eventId: "does-not-exist",
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("TodoFromReportEventNotFoundError");
      }),
    );
  });

  test("errors with TodoFromReportNotFieldReportError when the named event is real but not a skill.field_report", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "demo" },
          });
          return yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("TodoFromReportNotFieldReportError");
        if (outcome._tag === "TodoFromReportNotFieldReportError") {
          expect(outcome.eventType).toBe("bundle.created");
        }
      }),
    );
  });

  test("errors with TodoFromReportBundleMismatchError when an explicit --bundle disagrees with the report's own", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo-skill", outcome: "failed", report: "Broke badly." },
          });
          return yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
            bundle: "other-skill",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("TodoFromReportBundleMismatchError");
        if (outcome._tag === "TodoFromReportBundleMismatchError") {
          expect(outcome.bundle).toBe("other-skill");
          expect(outcome.reportBundle).toBe("demo-skill");
        }
      }),
    );
  });

  test("an explicit --bundle that agrees with the report's own is not an error", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo-skill", outcome: "failed", report: "Broke badly." },
          });
          return yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
            bundle: "demo-skill",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.todo.bundle).toBe("demo-skill");
      }),
    );
  });

  test("kind defaults by outcome: failed -> bug, surprise -> eval, worked -> task", () => {
    expect(TODO_KIND_BY_OUTCOME.failed).toBe("bug");
    expect(TODO_KIND_BY_OUTCOME.surprise).toBe("eval");
    expect(TODO_KIND_BY_OUTCOME.worked).toBe("task");
  });

  test("happy path: defaults bundle/kind/priority/detail from the report and stamps origin", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: {
              bundle: "demo-skill",
              outcome: "failed",
              report: "Broke on a repo with no package.json.",
              destination: "acme-agent-fleet",
            },
          });
          const result = yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
          });
          const events = yield* journal.readAll();
          return { eventId: appended.event.id, result, events };
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const { todo } = outcome.result;
        expect(todo.bundle).toBe("demo-skill");
        expect(todo.kind).toBe("bug");
        expect(todo.priority).toBe(10);
        expect(todo.status).toBe("open");
        expect(todo.detail).toBe(
          "Broke on a repo with no package.json.\nDestination: acme-agent-fleet",
        );
        expect(todo.origin).toEqual({ kind: "field-report", ref: outcome.eventId });

        // Appends exactly one new event -- the report was already there.
        expect(outcome.events.filter((event) => event.type === "todo.opened")).toHaveLength(1);
      }),
    );
  });

  test("every default is overridable: explicit --kind/--bundle/--detail/--priority win", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo-skill", outcome: "surprise", report: "Used an unexpected tool." },
          });
          return yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
            bundle: "demo-skill",
            kind: "improvement",
            detail: "Custom detail.",
            priority: 99,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.todo.kind).toBe("improvement");
        expect(result.todo.detail).toBe("Custom detail.");
        expect(result.todo.priority).toBe(99);
      }),
    );
  });

  test("a report with no destination/version omits those lines from the default detail", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const journalPath = `${dir}/.skillmaker/events.jsonl`;

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          const appended = yield* journal.append({
            type: "skill.field_report",
            actor,
            payload: { bundle: "demo-skill", outcome: "worked", report: "Worked great." },
          });
          return yield* openTodoFromReport({
            ...baseInput,
            eventId: appended.event.id,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.todo.detail).toBe("Worked great.");
        expect(result.todo.kind).toBe("task");
      }),
    );
  });
});
