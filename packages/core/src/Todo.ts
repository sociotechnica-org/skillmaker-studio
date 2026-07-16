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

/**
 * A todo's optional provenance (issue #81, `"intake"` added issue #91):
 * which upstream signal opened this todo automatically, if any -- named
 * generically (`ref`, not `eventId`) so later producers can add a kind
 * without a breaking change to this shape, exactly the extension point this
 * was built for: `"intake"` reuses the same `ref` field for an intake id
 * instead of a journal event id, no schema surgery required. Immutable like
 * `source`: structurally absent from `TodoPatch`, so a `todo.updated` patch
 * can never retroactively stamp or change it.
 */
export class TodoOrigin extends Schema.Class<TodoOrigin>("TodoOrigin")({
  kind: Schema.Literals(["field-report", "intake"]),
  /** The journal event id (`field-report`) or intake id (`intake`) this todo traces back to. */
  ref: Schema.String,
}) {}

/**
 * The plain-object form of `TodoOrigin` -- mirrors `FixtureSourceRecord`'s
 * reasoning (`Fixtures.ts`): the ONE shape every record carrying todo
 * provenance references, so a future producer kind lands in one place.
 */
export interface TodoOriginRecord {
  readonly kind: "field-report" | "intake";
  readonly ref: string;
}

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
  /** Immutable; stamped only at `todo.opened` (issue #81). See `TodoOrigin`. */
  origin: Schema.optionalKey(TodoOrigin),
}) {}

/**
 * Shallow patch of a todo's MUTABLE fields, carried by `todo.updated`
 * (data-model.md §2.10). `id`, `kind`, `created`, `source`, and `origin`
 * are immutable and deliberately absent from this schema -- a patch payload
 * that tries to carry them is decoded with those keys silently stripped
 * (reject-by-ignore), never rejected outright.
 */
export class TodoPatch extends Schema.Class<TodoPatch>("TodoPatch")({
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  checklist: Schema.optionalKey(Schema.Array(ChecklistItem)),
  priority: Schema.optionalKey(Schema.Number),
  bundle: Schema.optionalKey(Schema.String),
  pinned: Schema.optionalKey(Schema.Boolean),
}) {}
