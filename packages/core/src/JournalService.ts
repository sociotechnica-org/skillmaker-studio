/**
 * The Journal service: append-only access to `.skillmaker/events.jsonl`
 * (data-model.md §2.9). Writes go only through this service, never freehand.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { JournalIdempotencyConflictError, JournalReadError } from "./Errors.ts";
import { JournalEvent, type JournalEventInput } from "./Journal.ts";

export type AppendResult =
  | { readonly status: "appended"; readonly event: JournalEvent }
  | { readonly status: "already_appended"; readonly event: JournalEvent };

const decodeEvent = Schema.decodeUnknownEffect(JournalEvent);

const toReadError = (message: string) => (cause: unknown) =>
  JournalReadError.make({ message, cause });

/**
 * Deep-equal comparison restricted to the fields idempotency cares about:
 * same `type`, same `actor`, same `payload`. Uses JSON structural equality,
 * which is sufficient since journal payloads are plain JSON-shaped data.
 */
const sameContent = (a: JournalEvent, b: JournalEventInput): boolean =>
  a.type === b.type &&
  JSON.stringify(a.actor) === JSON.stringify(b.actor) &&
  JSON.stringify(a.payload) === JSON.stringify(b.payload);

export class Journal extends Context.Service<
  Journal,
  {
    readonly append: (
      input: JournalEventInput,
    ) => Effect.Effect<AppendResult, JournalIdempotencyConflictError | JournalReadError>;
    readonly readAll: () => Effect.Effect<ReadonlyArray<JournalEvent>, JournalReadError>;
  }
>()("Journal") {}

/**
 * Builds the live Journal layer for a journal file at `journalPath`
 * (typically `<workspace>/.skillmaker/events.jsonl`). A factory because the
 * path is a genuine runtime parameter; call it once per workspace root and
 * reuse the resulting layer.
 */
export const layer = (journalPath: string): Layer.Layer<Journal, never, FileSystem | Path> =>
  Layer.effect(Journal)(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const readRaw = Effect.fn("Journal.readRaw")(function* () {
        const exists = yield* fs
          .exists(journalPath)
          .pipe(Effect.mapError(toReadError(`could not check ${journalPath}`)));
        if (!exists) {
          return "";
        }
        return yield* fs
          .readFileString(journalPath)
          .pipe(Effect.mapError(toReadError(`could not read ${journalPath}`)));
      });

      const readAll = Effect.fn("Journal.readAll")(function* () {
        const raw = yield* readRaw();
        const lines = raw.split("\n").filter((line) => line.trim().length > 0);
        const events: JournalEvent[] = [];
        for (const line of lines) {
          const parsed = yield* Effect.try({
            try: () => JSON.parse(line) as unknown,
            catch: toReadError(`invalid JSON in ${journalPath}`),
          });
          const event = yield* decodeEvent(parsed).pipe(
            Effect.mapError(toReadError(`invalid journal event in ${journalPath}`)),
          );
          events.push(event);
        }
        return events;
      });

      const append = Effect.fn("Journal.append")(function* (input: JournalEventInput) {
        const existing = yield* readAll();

        if (input.idempotencyKey !== undefined) {
          const match = existing.find((event) => event.idempotencyKey === input.idempotencyKey);
          if (match !== undefined) {
            if (sameContent(match, input)) {
              return { status: "already_appended" as const, event: match };
            }
            return yield* Effect.fail(
              JournalIdempotencyConflictError.make({
                idempotencyKey: input.idempotencyKey,
                message: `idempotency key "${input.idempotencyKey}" was already appended with a different type/actor/payload`,
              }),
            );
          }
        }

        const candidate = {
          ...input,
          schemaVersion: 1 as const,
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
        };
        const event = yield* decodeEvent(candidate).pipe(
          Effect.mapError(toReadError("constructed journal event failed schema validation")),
        );

        yield* fs
          .makeDirectory(path.dirname(journalPath), { recursive: true })
          .pipe(Effect.mapError(toReadError(`could not create ${path.dirname(journalPath)}`)));

        // Repair a missing trailing newline before appending, so appends
        // never merge onto a partial last line.
        const raw = yield* readRaw();
        if (raw.length > 0 && !raw.endsWith("\n")) {
          yield* fs
            .writeFileString(journalPath, "\n", { flag: "a" })
            .pipe(Effect.mapError(toReadError(`could not repair ${journalPath}`)));
        }

        yield* fs
          .writeFileString(journalPath, `${JSON.stringify(event)}\n`, { flag: "a" })
          .pipe(Effect.mapError(toReadError(`could not append to ${journalPath}`)));

        return { status: "appended" as const, event };
      });

      return { append, readAll };
    }),
  );
