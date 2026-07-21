/**
 * The read-out's "this run surfaced work -> open a todo" payload builder
 * (2026-07-21 simplification, D5). What matters: the origin stamp points at
 * the run, the bundle defaults from the run, the detail always ends with
 * the evidence line, and nothing about the payload depends on a grade.
 */
import { describe, expect, test } from "bun:test";
import { buildRunTodoPayload } from "./runTodoDraft.ts";
import type { RunDetailRun } from "./schemas.ts";

const run = (overrides?: Partial<RunDetailRun>): RunDetailRun => ({
  id: "01RUN",
  bundle: "demo-skill",
  fixtureCase: "hard-case-conflicting-sections",
  skillVersionHash: "sha256:abcdef0123456789",
  provider: "claude-code",
  model: "sonnet",
  startedAt: "2026-07-21T10:00:00.000Z",
  status: "completed",
  ...overrides,
});

const draftBase = { id: "td-1", created: "2026-07-21" };

describe("buildRunTodoPayload", () => {
  test("stamps origin {kind: 'run', runId} and defaults bundle from the run", () => {
    const payload = buildRunTodoPayload({ run: run(), title: "Resolve the design conflict", note: "", ...draftBase });
    expect(payload?.todo.origin).toEqual({ kind: "run", runId: "01RUN" });
    expect(payload?.todo.bundle).toBe("demo-skill");
    expect(payload?.todo.kind).toBe("task");
    expect(payload?.todo.status).toBe("open");
    expect(payload?.todo.priority).toBe(30);
    expect(payload?.todo.id).toBe("td-1");
    expect(payload?.todo.created).toBe("2026-07-21");
  });

  test("detail is the evidence line alone when no note is given, naming the fixture", () => {
    const payload = buildRunTodoPayload({ run: run(), title: "T", note: "  ", ...draftBase });
    expect(payload?.todo.detail).toBe(
      "Surfaced by run 01RUN (fixture hard-case-conflicting-sections).",
    );
  });

  test("a note comes first, evidence line last; a fixture-less run omits the fixture clause", () => {
    const payload = buildRunTodoPayload({
      run: run({ fixtureCase: undefined }),
      title: "T",
      note: "The design contradicts itself in section 3.",
      ...draftBase,
    });
    expect(payload?.todo.detail).toBe(
      "The design contradicts itself in section 3.\nSurfaced by run 01RUN.",
    );
  });

  test("title is trimmed; a blank title builds nothing", () => {
    expect(buildRunTodoPayload({ run: run(), title: "   ", note: "n", ...draftBase })).toBeUndefined();
    const payload = buildRunTodoPayload({ run: run(), title: "  Fix it  ", note: "", ...draftBase });
    expect(payload?.todo.title).toBe("Fix it");
  });

  test("builds identically regardless of run status -- disposition never consults the verdict", () => {
    const completed = buildRunTodoPayload({ run: run({ status: "completed" }), title: "T", note: "", ...draftBase });
    const failed = buildRunTodoPayload({ run: run({ status: "failed" }), title: "T", note: "", ...draftBase });
    expect(failed).toEqual(completed);
  });
});
