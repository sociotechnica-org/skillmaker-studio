import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import {
  ARCHIVE_WINDOW_DAYS,
  compareTodos,
  DEFAULT_PRIORITY_BY_KIND,
  foldTodos,
  isArchived,
  isoDateOnly,
  isTerminalStatus,
} from "../src/FoldTodos.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { Todo } from "../src/Todo.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let counter = 0;
const envelope = <T extends string>(type: T) => {
  counter += 1;
  return {
    schemaVersion: 1 as const,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    at: new Date(2026, 6, 10, 0, 0, counter).toISOString(),
    actor,
    type,
  };
};

const baseTodo = (overrides: Partial<ReturnType<typeof Todo.make>> = {}) =>
  Todo.make({
    id: "td-1",
    kind: "task",
    status: "open",
    title: "Write tests",
    priority: 30,
    created: "2026-07-01",
    source: actor,
    ...overrides,
  });

describe("foldTodos", () => {
  test("todo.opened sets the full record verbatim", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")).toEqual(todo);
  });

  test("todo.updated applies a shallow patch of mutable fields only", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      {
        ...envelope("todo.updated"),
        payload: { id: "td-1", patch: { title: "Write more tests", priority: 5 } },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")?.title).toBe("Write more tests");
    expect(todos.get("td-1")?.priority).toBe(5);
    // Untouched mutable fields are preserved.
    expect(todos.get("td-1")?.status).toBe("open");
  });

  test("todo.updated cannot alter id/kind/created/source (not representable in the patch)", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      {
        ...envelope("todo.updated"),
        payload: { id: "td-1", patch: { bundle: "demo" } },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    const result = todos.get("td-1");
    expect(result?.id).toBe("td-1");
    expect(result?.kind).toBe("task");
    expect(result?.created).toBe("2026-07-01");
    expect(result?.source).toEqual(actor);
    expect(result?.bundle).toBe("demo");
  });

  test("todo.opened carries origin through verbatim (issue #81)", () => {
    const todo = baseTodo({ origin: { kind: "field-report", ref: "evt-1" } });
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")?.origin).toEqual({ kind: "field-report", ref: "evt-1" });
  });

  test("todo.updated cannot alter origin -- not representable in the patch, so it survives untouched", () => {
    const todo = baseTodo({ origin: { kind: "field-report", ref: "evt-1" } });
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      {
        ...envelope("todo.updated"),
        payload: { id: "td-1", patch: { title: "Retitled" } },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    const result = todos.get("td-1");
    expect(result?.title).toBe("Retitled");
    expect(result?.origin).toEqual({ kind: "field-report", ref: "evt-1" });
  });

  test("todo.updated for an unknown id is ignored (tolerant fold)", () => {
    const events: ReadonlyArray<JournalEvent> = [
      {
        ...envelope("todo.updated"),
        payload: { id: "td-missing", patch: { title: "no-op" } },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.size).toBe(0);
  });

  test("todo.status_changed for an unknown id is ignored (tolerant fold)", () => {
    const events: ReadonlyArray<JournalEvent> = [
      {
        ...envelope("todo.status_changed"),
        payload: { id: "td-missing", from: "open", to: "done" },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.size).toBe(0);
  });

  test("todo.status_changed stamps terminalAt entering a terminal status", () => {
    const todo = baseTodo();
    const at = "2026-07-05T12:00:00.000Z";
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      { ...envelope("todo.status_changed"), at, payload: { id: "td-1", from: "open", to: "done" } } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")?.status).toBe("done");
    expect(todos.get("td-1")?.terminalAt).toBe("2026-07-05");
  });

  test("todo.status_changed preserves terminalAt across terminal -> terminal", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      {
        ...envelope("todo.status_changed"),
        at: "2026-07-05T12:00:00.000Z",
        payload: { id: "td-1", from: "open", to: "done" },
      } as JournalEvent,
      {
        ...envelope("todo.status_changed"),
        at: "2026-07-09T12:00:00.000Z",
        payload: { id: "td-1", from: "done", to: "wont-do" },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")?.status).toBe("wont-do");
    expect(todos.get("td-1")?.terminalAt).toBe("2026-07-05");
  });

  test("todo.status_changed clears terminalAt on reopen", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      {
        ...envelope("todo.status_changed"),
        at: "2026-07-05T12:00:00.000Z",
        payload: { id: "td-1", from: "open", to: "done" },
      } as JournalEvent,
      {
        ...envelope("todo.status_changed"),
        at: "2026-07-06T12:00:00.000Z",
        payload: { id: "td-1", from: "done", to: "open" },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-1")?.status).toBe("open");
    expect(todos.get("td-1")?.terminalAt).toBeUndefined();
  });

  test("unrelated event types (bundle.*, run.*) do not affect todo state", () => {
    const todo = baseTodo();
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo } } as JournalEvent,
      { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent,
      {
        ...envelope("run.completed"),
        payload: { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", status: "completed", endedAt: new Date().toISOString() },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.size).toBe(1);
    expect(todos.get("td-1")).toEqual(todo);
  });

  test("independent todos fold independently", () => {
    const a = baseTodo({ id: "td-a", title: "A" });
    const b = baseTodo({ id: "td-b", title: "B" });
    const events: ReadonlyArray<JournalEvent> = [
      { ...envelope("todo.opened"), payload: { todo: a } } as JournalEvent,
      { ...envelope("todo.opened"), payload: { todo: b } } as JournalEvent,
      {
        ...envelope("todo.status_changed"),
        payload: { id: "td-a", from: "open", to: "in-progress" },
      } as JournalEvent,
    ];
    const todos = foldTodos(events);
    expect(todos.get("td-a")?.status).toBe("in-progress");
    expect(todos.get("td-b")?.status).toBe("open");
  });
});

describe("isTerminalStatus", () => {
  test("done and wont-do are terminal; open and in-progress are not", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("wont-do")).toBe(true);
    expect(isTerminalStatus("open")).toBe(false);
    expect(isTerminalStatus("in-progress")).toBe(false);
  });
});

describe("isoDateOnly", () => {
  test("extracts the YYYY-MM-DD portion of an ISO timestamp", () => {
    expect(isoDateOnly("2026-07-05T12:34:56.000Z")).toBe("2026-07-05");
  });
});

describe("DEFAULT_PRIORITY_BY_KIND", () => {
  test("matches data-model.md §2.10 defaults", () => {
    expect(DEFAULT_PRIORITY_BY_KIND).toEqual({
      bug: 10,
      eval: 15,
      improvement: 20,
      task: 30,
    });
  });
});

describe("isArchived", () => {
  const now = new Date("2026-07-10T00:00:00.000Z");

  test("non-terminal todos are never archived", () => {
    const todo = baseTodo({ status: "open" });
    expect(isArchived(todo, now)).toBe(false);
  });

  test("terminal todos without terminalAt are not archived", () => {
    const todo = baseTodo({ status: "done" });
    expect(isArchived(todo, now)).toBe(false);
  });

  test("terminal todos younger than the archive window are not archived", () => {
    const todo = baseTodo({ status: "done", terminalAt: "2026-07-05" });
    expect(isArchived(todo, now)).toBe(false);
  });

  test("terminal todos at/older than the archive window are archived", () => {
    const exactlyAtWindow = baseTodo({ status: "done", terminalAt: "2026-07-03" });
    expect(isArchived(exactlyAtWindow, now)).toBe(true);

    const older = baseTodo({ status: "wont-do", terminalAt: "2026-01-01" });
    expect(isArchived(older, now)).toBe(true);
  });

  test("pinned todos are exempt from archiving regardless of age", () => {
    const todo = baseTodo({ status: "done", terminalAt: "2026-01-01", pinned: true });
    expect(isArchived(todo, now)).toBe(false);
  });

  test("ARCHIVE_WINDOW_DAYS is 7", () => {
    expect(ARCHIVE_WINDOW_DAYS).toBe(7);
  });
});

describe("compareTodos", () => {
  test("sorts by priority ascending first", () => {
    const high = baseTodo({ id: "td-2", priority: 5, created: "2026-07-05" });
    const low = baseTodo({ id: "td-1", priority: 30, created: "2026-07-01" });
    expect(compareTodos(high, low)).toBeLessThan(0);
    expect(compareTodos(low, high)).toBeGreaterThan(0);
  });

  test("falls back to created ascending when priority ties", () => {
    const earlier = baseTodo({ id: "td-2", priority: 10, created: "2026-07-01" });
    const later = baseTodo({ id: "td-1", priority: 10, created: "2026-07-05" });
    expect(compareTodos(earlier, later)).toBeLessThan(0);
  });

  test("falls back to id ascending when priority and created tie", () => {
    const a = baseTodo({ id: "td-a", priority: 10, created: "2026-07-01" });
    const b = baseTodo({ id: "td-b", priority: 10, created: "2026-07-01" });
    expect(compareTodos(a, b)).toBeLessThan(0);
    expect(compareTodos(b, a)).toBeGreaterThan(0);
  });

  test("returns 0 for identical priority/created/id", () => {
    const a = baseTodo({ id: "td-1", priority: 10, created: "2026-07-01" });
    const b = baseTodo({ id: "td-1", priority: 10, created: "2026-07-01" });
    expect(compareTodos(a, b)).toBe(0);
  });
});
