/**
 * The typed runtime client boundary: fetch -> JSON -> `Schema` decode ->
 * tagged errors. The one place in the viewer that touches `fetch` and
 * `effect`'s `Schema` module directly; components only ever see plain
 * Promises and tagged errors (see src/app/runtime/errors.ts).
 */
import { Schema } from "effect";
import { RuntimeDecodeError, RuntimeFetchError } from "./errors.ts";

export const fetchJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
): Promise<S["Type"]> => {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw new RuntimeFetchError(path, `network error fetching ${path}: ${String(cause)}`);
  }

  if (!response.ok) {
    throw new RuntimeFetchError(path, `${path} responded ${response.status}`, response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new RuntimeFetchError(path, `${path} did not return valid JSON: ${String(cause)}`);
  }

  try {
    return await Schema.decodeUnknownPromise(schema)(json);
  } catch (cause) {
    throw new RuntimeDecodeError(path, `${path} response failed schema decode: ${String(cause)}`);
  }
};
