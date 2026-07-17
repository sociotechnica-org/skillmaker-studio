/**
 * Todos — journal-native (data-model.md §2.10). The full record, materialized
 * in the DB from `todo.*` events.
 */
import { Schema, SchemaGetter } from "effect";
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
 * A todo's `field-report` provenance kind (issue #81; reshaped by the
 * 2026-07-17 data-model reconciliation, ruling R2): which
 * `skill.field_report` journal event opened this todo automatically. The
 * id lives under `eventId`, not a generic `ref` -- see `TodoOrigin` for
 * why the overload was retired. Plain `Schema.Struct` (not `Schema.Class`
 * like `FixtureSource`'s members) because `origin` decodes through the
 * `TodoOriginFromWire` read shim below: the shim yields plain objects, and
 * `Todo.make({ origin: { kind, eventId } })` must accept the same plain
 * shape rather than demanding a constructed class instance.
 */
export const TodoOriginFieldReport = Schema.Struct({
  kind: Schema.Literal("field-report"),
  /** The `skill.field_report` journal event's id this todo was opened from. */
  eventId: Schema.String,
});

/**
 * A todo's `intake` provenance kind (issue #91's salvage door and issue
 * #92's triage-manifest "what hurts" mint; reshaped by the 2026-07-17
 * data-model reconciliation, ruling R2): the `skill.received` event's
 * intake id (`in-<ulid>`) this todo was minted from -- the crate, not a
 * journal event, is the thing being pointed at.
 */
export const TodoOriginIntake = Schema.Struct({
  kind: Schema.Literal("intake"),
  /** The crate's intake id (`in-<ulid>`) from its `skill.received` event. */
  intakeId: Schema.String,
});

/**
 * A todo's optional provenance (issue #81, `"intake"` added issue #91;
 * reshaped by the 2026-07-17 data-model reconciliation, ruling R2): which
 * upstream signal opened this todo automatically, if any. A discriminated
 * union with a distinct id field per kind -- `FixtureSource`'s exact shape
 * (`Fixtures.ts`), which is the house pattern for provenance now: the two
 * kinds key on genuinely different things (a journal event id vs. an
 * intake id), so each carries its own honestly-named field instead of one
 * overloaded `ref`. The previous single-class shape documented `ref` as
 * "the extension point"; the reconciliation ruled the opposite way -- a
 * new producer kind is a new union member with its own field, exactly how
 * `FixtureSourceIntake` landed next to `FixtureSourceFieldReport`.
 * Immutable like `source`: structurally absent from `TodoPatch`, so a
 * `todo.updated` patch can never retroactively stamp or change it.
 */
export const TodoOrigin = Schema.Union([TodoOriginFieldReport, TodoOriginIntake]);
export type TodoOrigin = typeof TodoOrigin.Type;

/**
 * The legacy on-the-wire shape `TodoOrigin` had before the 2026-07-17
 * reconciliation: one class, one generic `ref` holding either id-space.
 * Kept ONLY as an input to `TodoOriginFromWire`'s read shim below -- never
 * exported, never written.
 */
const TodoOriginLegacyWire = Schema.Struct({
  kind: Schema.Literals(["field-report", "intake"]),
  ref: Schema.String,
});

/** Every origin shape a journal event may carry: the two current shapes, plus the retired `ref` overload. */
const TodoOriginWire = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("field-report"), eventId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("intake"), intakeId: Schema.String }),
  TodoOriginLegacyWire,
]);

/**
 * READ SHIM (2026-07-17 data-model reconciliation, ruling R2). The journal
 * is append-only and old events are forever: every `todo.opened` payload
 * written before this change carries the retired `{kind, ref}` origin
 * shape, and those lines will never be rewritten. So the schema `Todo`
 * decodes `origin` through accepts BOTH shapes on the way in -- when the
 * legacy `ref` key is present it is mapped to `eventId` (kind
 * `field-report`) or `intakeId` (kind `intake`) -- and everything past
 * decode (`foldTodos`, the index, the API) sees only the union above.
 * Writes are one-directional: encoding (and `Journal.append`, which
 * round-trips its candidate through decode before serializing) only ever
 * produces the new keys, so no event written since this change carries
 * `ref`. The legacy branch of this shim is read-forever, write-never.
 */
export const TodoOriginFromWire = TodoOriginWire.pipe(
  Schema.decodeTo(TodoOrigin, {
    decode: SchemaGetter.transform((wire) =>
      "ref" in wire
        ? wire.kind === "field-report"
          ? { kind: "field-report" as const, eventId: wire.ref }
          : { kind: "intake" as const, intakeId: wire.ref }
        : wire,
    ),
    encode: SchemaGetter.passthroughSubtype(),
  }),
);

/**
 * The plain-object form of `TodoOrigin` -- mirrors `FixtureSourceRecord`'s
 * reasoning (`Fixtures.ts`): the ONE shape every record carrying todo
 * provenance references, so a future producer kind lands in one place.
 */
export type TodoOriginRecord =
  | { readonly kind: "field-report"; readonly eventId: string }
  | { readonly kind: "intake"; readonly intakeId: string };

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
  /** Immutable; stamped only at `todo.opened` (issue #81). See `TodoOrigin` and `TodoOriginFromWire`'s read shim. */
  origin: Schema.optionalKey(TodoOriginFromWire),
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
