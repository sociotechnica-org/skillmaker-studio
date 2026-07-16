/**
 * Schema-level tests for `Todo`/`TodoPatch`/`TodoOrigin` (issue #81):
 * `origin`'s round-trip and its immutability at the `TodoPatch` layer.
 * `FoldTodos.test.ts` covers the fold-level behavior (origin carried
 * through `todo.opened`, untouched by `todo.updated`).
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { Actor } from "../src/Actor.ts";
import { Todo, TodoPatch } from "../src/Todo.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

describe("Todo.origin", () => {
  test("round-trips through encode/decode when present", () => {
    const todo = Todo.make({
      id: "td-1",
      kind: "bug",
      status: "open",
      title: "Investigate crash",
      priority: 10,
      created: "2026-07-01",
      source: actor,
      origin: { kind: "field-report", ref: "evt-123" },
    });

    const encoded = Schema.encodeSync(Todo)(todo);
    expect(encoded.origin).toEqual({ kind: "field-report", ref: "evt-123" });

    const decoded = Schema.decodeUnknownSync(Todo)(encoded);
    expect(decoded.origin).toEqual({ kind: "field-report", ref: "evt-123" });
  });

  test("is absent when the todo was opened by hand", () => {
    const todo = Todo.make({
      id: "td-2",
      kind: "task",
      status: "open",
      title: "Write docs",
      priority: 30,
      created: "2026-07-01",
      source: actor,
    });

    expect(todo.origin).toBeUndefined();
    const encoded = Schema.encodeSync(Todo)(todo);
    expect("origin" in encoded).toBe(false);
  });
});

describe("TodoPatch strips origin (immutable, reject-by-ignore)", () => {
  test("a patch payload carrying origin decodes with it silently stripped", () => {
    const decoded = Schema.decodeUnknownSync(TodoPatch)({
      title: "New title",
      origin: { kind: "field-report", ref: "evt-999" },
    });
    expect(decoded.title).toBe("New title");
    expect("origin" in decoded).toBe(false);
  });

  test("id/kind/created/source/origin are all absent from a patch carrying every field", () => {
    const decoded = Schema.decodeUnknownSync(TodoPatch)({
      id: "td-should-not-move",
      kind: "bug",
      created: "2020-01-01",
      source: { kind: "agent", name: "someone-else" },
      origin: { kind: "field-report", ref: "evt-1" },
      priority: 5,
    });
    expect(decoded).toEqual({ priority: 5 });
  });
});
