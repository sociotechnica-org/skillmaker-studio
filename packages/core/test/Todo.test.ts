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
      origin: { kind: "field-report", eventId: "evt-123" },
    });

    const encoded = Schema.encodeSync(Todo)(todo);
    expect(encoded.origin).toEqual({ kind: "field-report", eventId: "evt-123" });

    const decoded = Schema.decodeUnknownSync(Todo)(encoded);
    expect(decoded.origin).toEqual({ kind: "field-report", eventId: "evt-123" });
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

  // The read shim (ruling R2): the journal is append-only, so every
  // `todo.opened` written before the union reshape carries the retired
  // `{kind, ref}` origin. Those lines are read forever and must decode into
  // the new per-kind-id union; new writes only ever emit the new keys.
  test("decodes a legacy {kind, ref} field-report origin into eventId", () => {
    const decoded = Schema.decodeUnknownSync(Todo)({
      id: "td-3",
      kind: "bug",
      status: "open",
      title: "From an old journal",
      priority: 10,
      created: "2026-07-01",
      source: { kind: "user", name: "test-user" },
      origin: { kind: "field-report", ref: "evt-legacy" },
    });
    expect(decoded.origin).toEqual({ kind: "field-report", eventId: "evt-legacy" });
    // and re-encoding produces the new shape, never the retired `ref`
    expect(Schema.encodeSync(Todo)(decoded).origin).toEqual({ kind: "field-report", eventId: "evt-legacy" });
  });

  test("decodes a legacy {kind, ref} intake origin into intakeId", () => {
    const decoded = Schema.decodeUnknownSync(Todo)({
      id: "td-4",
      kind: "task",
      status: "open",
      title: "From an old crate mint",
      priority: 30,
      created: "2026-07-01",
      source: { kind: "user", name: "test-user" },
      origin: { kind: "intake", ref: "in-legacy" },
    });
    expect(decoded.origin).toEqual({ kind: "intake", intakeId: "in-legacy" });
  });
});

describe("TodoPatch strips origin (immutable, reject-by-ignore)", () => {
  test("a patch payload carrying origin decodes with it silently stripped", () => {
    const decoded = Schema.decodeUnknownSync(TodoPatch)({
      title: "New title",
      origin: { kind: "field-report", eventId: "evt-999" },
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
      origin: { kind: "field-report", eventId: "evt-1" },
      priority: 5,
    });
    expect(decoded).toEqual({ priority: 5 });
  });
});
