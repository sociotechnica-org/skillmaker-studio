/**
 * Typed wrappers over the `/api/*` endpoints served by `packages/cli`'s
 * server module. Each function is a plain async function -- no `Effect`
 * escapes this directory.
 */
import { Schema } from "effect";
import { fetchJson, postJson } from "./client.ts";
import {
  ApiErrorResponse,
  BundleDetailResponse,
  BundlesResponse,
  HealthResponse,
  PostEventResponse,
  StateResponse,
  TodosResponse,
} from "./schemas.ts";

export const getHealth = (): Promise<HealthResponse> => fetchJson("/api/health", HealthResponse);

export const getState = (): Promise<StateResponse> => fetchJson("/api/state", StateResponse);

export const getBundles = (): Promise<BundlesResponse> =>
  fetchJson("/api/bundles", BundlesResponse);

export const getBundleDetail = (slug: string): Promise<BundleDetailResponse> =>
  fetchJson(`/api/bundles/${encodeURIComponent(slug)}`, BundleDetailResponse);

/** `GET /api/todos[?all=1]` -- the todos panel's data (data-model.md §2.10/§2.11). */
export const getTodos = (includeArchived: boolean): Promise<TodosResponse> =>
  fetchJson(includeArchived ? "/api/todos?all=1" : "/api/todos", TodosResponse);

export interface PostEventInput {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

export type PostEventResult =
  | { readonly ok: true; readonly response: PostEventResponse }
  | { readonly ok: false; readonly error: string };

const FALLBACK_ERROR = (status: number): ApiErrorResponse =>
  ApiErrorResponse.make({ error: `request failed with status ${status}` });

/**
 * `POST /api/events` -- the server-mediated write path (data-model.md
 * §2.9/§2.13). Never throws on a 4xx/5xx: the caller decides how to show a
 * rejection (e.g. a guarded-transition 409's reason) inline.
 */
export const postEvent = async (input: PostEventInput): Promise<PostEventResult> => {
  const raw = await postJson("/api/events", input);

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(PostEventResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};
