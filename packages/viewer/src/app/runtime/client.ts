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

export interface RawJsonResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

/**
 * `POST` without decode-or-throw on the HTTP status: a non-2xx here (e.g.
 * the guarded-transition 409) is expected domain information the caller
 * wants to read and show inline, not an exceptional runtime failure. Only
 * network errors and non-JSON bodies throw.
 */
export const postJson = async (path: string, payload: unknown): Promise<RawJsonResponse> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new RuntimeFetchError(path, `network error posting to ${path}: ${String(cause)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new RuntimeFetchError(
      path,
      `${path} did not return valid JSON: ${String(cause)}`,
      response.status,
    );
  }

  return { status: response.status, ok: response.ok, body };
};
