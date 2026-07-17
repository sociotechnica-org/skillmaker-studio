import { describe, expect, test } from "bun:test";
import { filterTodosByBundle, isDone } from "./todoQueue.ts";
import type { TodoRecord, TodoStatus } from "./schemas.ts";

const todo = (overrides: Partial<TodoRecord> & { id: string }): TodoRecord => ({
  kind: "task",
  status: "open",
  title: overrides.id,
  priority: 30,
  created: "2026-01-01",
  swept: false,
  source: { kind: "user", name: "viewer" },
  ...overrides,
});

describe("isDone", () => {
  test("only \"done\" reads as done", () => {
    const cases: ReadonlyArray<[TodoStatus, boolean]> = [
      ["open", false],
      ["in-progress", false],
      ["wont-do", false],
      ["done", true],
    ];
    for (const [status, expected] of cases) {
      expect(isDone(status)).toBe(expected);
    }
  });
});

describe("filterTodosByBundle", () => {
  test("no filter returns the list unchanged", () => {
    const todos = [todo({ id: "a", bundle: "alpha" }), todo({ id: "b" })];
    expect(filterTodosByBundle(todos, undefined)).toEqual(todos);
  });

  test("filters to only the matching bundle", () => {
    const alpha = todo({ id: "a", bundle: "alpha" });
    const beta = todo({ id: "b", bundle: "beta" });
    const appLevel = todo({ id: "c" });
    expect(filterTodosByBundle([alpha, beta, appLevel], "alpha")).toEqual([alpha]);
  });

  test("a filter matching nothing returns an empty list, not a fallback to everything", () => {
    const todos = [todo({ id: "a", bundle: "alpha" })];
    expect(filterTodosByBundle(todos, "no-such-bundle")).toEqual([]);
  });
});
