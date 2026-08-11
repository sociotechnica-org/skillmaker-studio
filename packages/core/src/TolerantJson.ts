/**
 * Shared plumbing for the tolerant JSON stores (`skill.json`, `evals.json`,
 * per-case `case.json`): the absent/unusable/parsed envelope trichotomy and
 * the named-entry array walk, factored out so the tolerance law (Part 3
 * ruling I: defects degrade to warnings, never hard failures) has ONE
 * implementation instead of per-file forks.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync } from "node:fs";
import { WorkspaceIOError } from "./Errors.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A trimmed non-empty string, or `undefined` — the tolerant readers' "usable string" test. */
export const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/** Keeps only the string entries of an array (anything else reads as `[]`). */
export const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export type JsonEnvelopeStatus = "absent" | "unusable" | "parsed";

export interface JsonEnvelope {
  readonly status: JsonEnvelopeStatus;
  /** The top-level object; present only when `status` is `"parsed"`. */
  readonly record?: Record<string, unknown>;
}

export interface ReadJsonEnvelopeOptions {
  /** Warning prefix naming the file, e.g. `"evals.json"`. */
  readonly label: string;
  /** What the caller does on `unusable`, e.g. `"falling back to evals/risk-map.md"`. */
  readonly fallbackHint: string;
}

const classifyEnvelope = (
  content: string,
  warnings: string[],
  options: ReadJsonEnvelopeOptions,
): JsonEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    warnings.push(
      `${options.label}: not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); ${options.fallbackHint}`,
    );
    return { status: "unusable" };
  }
  if (!isRecord(parsed)) {
    warnings.push(`${options.label}: top level is not an object; ${options.fallbackHint}`);
    return { status: "unusable" };
  }
  return { status: "parsed", record: parsed };
};

/**
 * The absent/unusable/parsed envelope read every tolerant store shares:
 * missing file → `absent` (fine, no warning); unreadable-as-object →
 * `unusable` + a warning naming the fallback; otherwise `parsed` with the
 * top-level record for the caller's per-section walk.
 */
export const readJsonEnvelope = Effect.fn("TolerantJson.readJsonEnvelope")(function* (
  path: string,
  warnings: string[],
  options: ReadJsonEnvelopeOptions,
) {
  const fs = yield* FileSystem;
  const exists = yield* fs.exists(path).pipe(Effect.mapError(toIOError(`could not check ${path}`)));
  if (!exists) {
    return { status: "absent" } satisfies JsonEnvelope;
  }
  const content = yield* fs.readFileString(path).pipe(Effect.mapError(toIOError(`could not read ${path}`)));
  return classifyEnvelope(content, warnings, options);
});

/** Sync twin of `readJsonEnvelope` for the node-fs call sites (server request handlers) — same trichotomy, same warnings. */
export const readJsonEnvelopeSync = (
  path: string,
  warnings: string[],
  options: ReadJsonEnvelopeOptions,
): JsonEnvelope => {
  if (!existsSync(path)) {
    return { status: "absent" };
  }
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (cause) {
    warnings.push(`${options.label}: could not be read (${String(cause)}); ${options.fallbackHint}`);
    return { status: "unusable" };
  }
  return classifyEnvelope(content, warnings, options);
};

export interface ParseNamedArrayOptions<T> {
  /** Warning prefix naming the file, e.g. `"skill.json"`. */
  readonly prefix: string;
  /** What one entry is called in warnings, e.g. `"failure hypothesis"`. */
  readonly label: string;
  /** The identity field entries are keyed and deduplicated by (`"id"`, `"name"`). */
  readonly keyField: string;
  /** Parses one entry past the shared checks; `undefined` drops it (the parser has already warned). */
  readonly parseEntry: (record: Record<string, unknown>, key: string) => T | undefined;
}

/**
 * The named-entry array walk shared by every tolerant list (hypotheses,
 * cases, configs): non-object entries, entries without a usable string key,
 * and duplicate keys are warned and skipped; everything else is handed to
 * `parseEntry` with its trimmed key. First occurrence of a key wins.
 */
export const parseNamedArray = <T>(
  raw: ReadonlyArray<unknown>,
  warnings: string[],
  options: ParseNamedArrayOptions<T>,
): T[] => {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      warnings.push(`${options.prefix}: non-object ${options.label} skipped`);
      continue;
    }
    const key = asOptionalString(entry[options.keyField]);
    if (key === undefined) {
      warnings.push(`${options.prefix}: ${options.label} without a string ${options.keyField} skipped`);
      continue;
    }
    const trimmed = key.trim();
    if (seen.has(trimmed)) {
      warnings.push(`${options.prefix}: duplicate ${options.label} ${options.keyField} "${trimmed}"; later entry skipped`);
      continue;
    }
    seen.add(trimmed);
    const parsed = options.parseEntry(entry, trimmed);
    if (parsed !== undefined) {
      out.push(parsed);
    }
  }
  return out;
};
