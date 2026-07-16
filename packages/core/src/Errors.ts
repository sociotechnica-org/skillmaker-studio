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

/**
 * `studio.db` (the rebuildable SQLite index) could not be read or written.
 * `eventId`/`lineNumber` (Fix F4) identify the offending journal event when
 * a rebuild failure traces back to one specific line, so "could not write
 * studio.db" is never the only information an operator gets -- both the
 * human-readable message and `--json` output carry the real underlying
 * cause plus, when known, which event/line it came from.
 */
export class IndexError extends Schema.TaggedErrorClass<IndexError>()("IndexError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
  eventId: Schema.optionalKey(Schema.String),
  lineNumber: Schema.optionalKey(Schema.Number),
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

/** `skillmaker ship` was attempted for a bundle with no `skill.version_recorded` event at all -- there is nothing to ship (issue #66: "errors if the bundle has no recorded version"). */
export class ShipNoVersionError extends Schema.TaggedErrorClass<ShipNoVersionError>()(
  "ShipNoVersionError",
  {
    bundle: Schema.String,
  },
) {}

/** `skillmaker ship --version <prefix>` didn't match any recorded version's hash for the bundle. */
export class ShipVersionNotFoundError extends Schema.TaggedErrorClass<ShipVersionNotFoundError>()(
  "ShipVersionNotFoundError",
  {
    bundle: Schema.String,
    prefix: Schema.String,
  },
) {}

/** `skillmaker report --version <prefix>` didn't match any recorded version's hash for the bundle. */
export class FieldReportVersionNotFoundError extends Schema.TaggedErrorClass<FieldReportVersionNotFoundError>()(
  "FieldReportVersionNotFoundError",
  {
    bundle: Schema.String,
    prefix: Schema.String,
  },
) {}

/** `skillmaker fixture harvest --from-report <event-id>` named an event id that isn't in the journal at all (issue #68). */
export class HarvestEventNotFoundError extends Schema.TaggedErrorClass<HarvestEventNotFoundError>()(
  "HarvestEventNotFoundError",
  {
    eventId: Schema.String,
  },
) {}

/** The event `--from-report` named is real, but isn't a `skill.field_report` -- only a field report can be harvested into a fixture. */
export class HarvestNotFieldReportError extends Schema.TaggedErrorClass<HarvestNotFieldReportError>()(
  "HarvestNotFieldReportError",
  {
    eventId: Schema.String,
    eventType: Schema.String,
  },
) {}

/** The `skill.field_report` event `--from-report` named belongs to a different bundle than the one being harvested into. */
export class HarvestWrongBundleError extends Schema.TaggedErrorClass<HarvestWrongBundleError>()(
  "HarvestWrongBundleError",
  {
    eventId: Schema.String,
    bundle: Schema.String,
    reportBundle: Schema.String,
  },
) {}

/** `evals/fixtures/<case>/` already exists for this bundle -- same collision `fixture add` guards against. */
export class HarvestCaseExistsError extends Schema.TaggedErrorClass<HarvestCaseExistsError>()(
  "HarvestCaseExistsError",
  {
    bundle: Schema.String,
    caseName: Schema.String,
  },
) {}

/** `skillmaker todo add --from-report <event-id>` named an event id that isn't in the journal at all (issue #81). */
export class TodoFromReportEventNotFoundError extends Schema.TaggedErrorClass<TodoFromReportEventNotFoundError>()(
  "TodoFromReportEventNotFoundError",
  {
    eventId: Schema.String,
  },
) {}

/** The event `--from-report` named is real, but isn't a `skill.field_report` -- only a field report can seed a todo. */
export class TodoFromReportNotFieldReportError extends Schema.TaggedErrorClass<TodoFromReportNotFieldReportError>()(
  "TodoFromReportNotFieldReportError",
  {
    eventId: Schema.String,
    eventType: Schema.String,
  },
) {}

/** An explicit `--bundle` disagrees with the named `skill.field_report`'s own bundle. */
export class TodoFromReportBundleMismatchError extends Schema.TaggedErrorClass<TodoFromReportBundleMismatchError>()(
  "TodoFromReportBundleMismatchError",
  {
    eventId: Schema.String,
    bundle: Schema.String,
    reportBundle: Schema.String,
  },
) {}

/** `skillmaker receive <path>` named a path that doesn't exist (issue #90). */
export class ReceivePathNotFoundError extends Schema.TaggedErrorClass<ReceivePathNotFoundError>()(
  "ReceivePathNotFoundError",
  {
    path: Schema.String,
  },
) {}

/** `skillmaker receive <path>` named a path that exists but isn't a directory -- a crate is a directory, not a loose file. */
export class ReceivePathNotDirectoryError extends Schema.TaggedErrorClass<ReceivePathNotDirectoryError>()(
  "ReceivePathNotDirectoryError",
  {
    path: Schema.String,
  },
) {}

/**
 * `skillmaker receive <path>` named a directory with no top-level SKILL.md.
 * The dock takes skills (ruling, `Mechanism - Receiving Dock.md` §HOW):
 * unlike `adopt`'s tolerant recursive sweep, a non-skill directory at
 * `receive` is a hard error, never a warn-and-continue -- "facts are
 * per-crate; no sweep."
 */
export class ReceiveNotASkillError extends Schema.TaggedErrorClass<ReceiveNotASkillError>()(
  "ReceiveNotASkillError",
  {
    path: Schema.String,
  },
) {}
