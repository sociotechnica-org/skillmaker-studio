/**
 * Typed domain errors, schema-backed per the Effect error-handling guide:
 * schema-based errors by default, since these payloads are meaningfully
 * serializable and may cross the CLI/journal boundary.
 */
import { Schema } from "effect";

/**
 * Same idempotency key was appended with a different type/actor/payload.
 * Same key + same content is a no-op (`{status: "already_appended"}`), not
 * this error.
 */
export class JournalIdempotencyConflictError extends Schema.TaggedErrorClass<JournalIdempotencyConflictError>()(
  "JournalIdempotencyConflictError",
  {
    idempotencyKey: Schema.String,
    message: Schema.String,
  },
) {}

/** No `skillmaker.config.json` found walking up from the given directory. */
export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "WorkspaceNotFoundError",
  {
    cwd: Schema.String,
  },
) {}

/** `skillmaker new <slug>` targeted a bundle directory that already exists. */
export class BundleExistsError extends Schema.TaggedErrorClass<BundleExistsError>()(
  "BundleExistsError",
  {
    slug: Schema.String,
  },
) {}

/** Slug failed the `^[a-z0-9]+(-[a-z0-9]+)*$` pattern. */
export class InvalidSlugError extends Schema.TaggedErrorClass<InvalidSlugError>()(
  "InvalidSlugError",
  {
    slug: Schema.String,
  },
) {}

/** A line in `events.jsonl` failed schema decode, or a raw I/O failure occurred. */
export class JournalReadError extends Schema.TaggedErrorClass<JournalReadError>()(
  "JournalReadError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** A workspace or bundle filesystem operation failed. */
export class WorkspaceIOError extends Schema.TaggedErrorClass<WorkspaceIOError>()(
  "WorkspaceIOError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** `studio.db` (the rebuildable SQLite index) could not be read or written. */
export class IndexError extends Schema.TaggedErrorClass<IndexError>()("IndexError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * `skillmaker publish` was attempted for a bundle that is not publishable:
 * either its stage isn't `"published"` (the gate already enforces that a
 * bundle can only reach `published` via an approved gate decision -- see
 * `Machine.ts`), or its recorded version has drifted from the live
 * `design.md`/`output/` content (data-model.md §2.7) -- publishing a stale
 * or ahead-of-version bundle would ship content that was never recorded.
 */
export class PublishGuardError extends Schema.TaggedErrorClass<PublishGuardError>()(
  "PublishGuardError",
  {
    bundle: Schema.String,
    reason: Schema.String,
  },
) {}

/** `skillmaker publish` referenced a `--target` id that isn't in `skillmaker.config.json`'s `publishTargets`. */
export class PublishTargetNotFoundError extends Schema.TaggedErrorClass<PublishTargetNotFoundError>()(
  "PublishTargetNotFoundError",
  {
    target: Schema.String,
  },
) {}

/** A `publishTargets` entry had an unrecognized `kind`. */
export class UnknownPublishTargetKindError extends Schema.TaggedErrorClass<UnknownPublishTargetKindError>()(
  "UnknownPublishTargetKindError",
  {
    target: Schema.String,
    kind: Schema.String,
  },
) {}
