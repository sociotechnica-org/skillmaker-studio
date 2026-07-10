/**
 * Todos — journal-native (data-model.md §2.10). The full record, materialized
 * in the DB from `todo.*` events.
 */
import { Schema } from "effect";
import { Actor } from "./Actor.ts";

export const TodoKind = Schema.Literals(["task", "bug", "improvement", "eval"]);
export type TodoKind = typeof TodoKind.Type;

/** Terminal statuses: "done" and "wont-do". Status is independent of bundle stage. */
export const TodoStatus = Schema.Literals(["open", "in-progress", "done", "wont-do"]);
export type TodoStatus = typeof TodoStatus.Type;

export class ChecklistItem extends Schema.Class<ChecklistItem>("ChecklistItem")({
  text: Schema.String,
  done: Schema.Boolean,
}) {}

export class Todo extends Schema.Class<Todo>("Todo")({
  /** "td-<ulid>". */
  id: Schema.String,
  kind: TodoKind,
  status: TodoStatus,
  title: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  checklist: Schema.optionalKey(Schema.Array(ChecklistItem)),
  /** Lower = more urgent; defaults: bug 10, eval 15, improvement 20, task 30. */
  priority: Schema.Number,
  /** App-level todos omit it. */
  bundle: Schema.optionalKey(Schema.String),
  created: Schema.String,
  /** Derived at replay: stamped entering a terminal status, cleared on reopen. */
  terminalAt: Schema.optionalKey(Schema.String),
  pinned: Schema.optionalKey(Schema.Boolean),
  /** Derived: terminal + >= 7 days + not pinned. */
  archived: Schema.optionalKey(Schema.Boolean),
  source: Actor,
}) {}

/** Shallow patch of a todo's mutable fields, carried by `todo.updated`. */
export class TodoPatch extends Schema.Class<TodoPatch>("TodoPatch")({
  kind: Schema.optionalKey(TodoKind),
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  checklist: Schema.optionalKey(Schema.Array(ChecklistItem)),
  priority: Schema.optionalKey(Schema.Number),
  bundle: Schema.optionalKey(Schema.String),
  pinned: Schema.optionalKey(Schema.Boolean),
}) {}
