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
  BundleFileResponse,
  BundlesResponse,
  CatalogResponse,
  CreateBundleResponse,
  EventsResponse,
  FieldReportsResponse,
  HealthResponse,
  IntakeResponse,
  PostEventResponse,
  PublishBundleResponse,
  RecordVersionResponse,
  RunDetailResponse,
  SkillbookResponse,
  StateResponse,
  TodosResponse,
  TriggerRunResponse,
  TriggerStationRunResponse,
} from "./schemas.ts";

export const getHealth = (): Promise<HealthResponse> => fetchJson("/api/health", HealthResponse);

export const getState = (): Promise<StateResponse> => fetchJson("/api/state", StateResponse);

export const getBundles = (): Promise<BundlesResponse> =>
  fetchJson("/api/bundles", BundlesResponse);

export const getBundleDetail = (slug: string): Promise<BundleDetailResponse> =>
  fetchJson(`/api/bundles/${encodeURIComponent(slug)}`, BundleDetailResponse);

/** `GET /api/bundles/:slug/file?path=design.md|output/...` -- the Files tab. */
export const getBundleFile = (slug: string, path: string): Promise<BundleFileResponse> =>
  fetchJson(
    `/api/bundles/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`,
    BundleFileResponse,
  );

/** `GET /api/bundles/:slug/runs/:runId` -- the run-detail panel (data-model.md §2.12). */
export const getRunDetail = (slug: string, runId: string): Promise<RunDetailResponse> =>
  fetchJson(
    `/api/bundles/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    RunDetailResponse,
  );

/** `GET /api/todos[?all=1]` -- the todos panel's data (data-model.md §2.10/§2.11). */
export const getTodos = (includeSwept: boolean): Promise<TodosResponse> =>
  fetchJson(includeSwept ? "/api/todos?all=1" : "/api/todos", TodosResponse);

/** `GET /api/events[?limit=&before=]` -- the Activity page's paginated journal feed. */
export const getEvents = (options: { limit?: number; before?: string } = {}): Promise<EventsResponse> => {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.before !== undefined) {
    params.set("before", options.before);
  }
  const query = params.toString();
  return fetchJson(query.length > 0 ? `/api/events?${query}` : "/api/events", EventsResponse);
};

/** `GET /api/catalog` -- the Lab page's skill-browser rows (was the Catalog page, #64). */
export const getCatalog = (): Promise<CatalogResponse> => fetchJson("/api/catalog", CatalogResponse);

/** `GET /api/skillbook` -- the Ship page's data (was the Skillbook page, #64; was the Port page, #72; data-model.md §2.14). */
export const getSkillbook = (): Promise<SkillbookResponse> => fetchJson("/api/skillbook", SkillbookResponse);

/** `GET /api/field-reports` -- the Receive page's workspace-wide field-report list (issue #67), newest first. */
export const getFieldReports = (): Promise<FieldReportsResponse> =>
  fetchJson("/api/field-reports", FieldReportsResponse);

/** `GET /api/intake` -- the Receive page's dock queue (issue #90), oldest first. */
export const getIntake = (): Promise<IntakeResponse> => fetchJson("/api/intake", IntakeResponse);

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

export type TriggerRunResult =
  | { readonly ok: true; readonly response: TriggerRunResponse }
  | { readonly ok: false; readonly error: string };

/**
 * `POST /api/bundles/:slug/fixtures/:case/run` -- the Evals tab's "Run"
 * button. The server forks the run engine and answers immediately with the
 * run id; progress arrives via the SSE journal stream, not this response.
 */
export const triggerRun = async (
  slug: string,
  caseName: string,
  provider: string | undefined,
  /** Fix 1 (Phase 20 Story 2 friction log F1): an optional model id, forwarded to the server's run-trigger endpoint -- validated once the ACP session connects (the advertised model list isn't known before then). */
  model?: string,
): Promise<TriggerRunResult> => {
  const raw = await postJson(
    `/api/bundles/${encodeURIComponent(slug)}/fixtures/${encodeURIComponent(caseName)}/run`,
    { ...(provider !== undefined ? { provider } : {}), ...(model !== undefined && model.length > 0 ? { model } : {}) },
  );

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(TriggerRunResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};

export type TriggerStationRunResult =
  | { readonly ok: true; readonly response: TriggerStationRunResponse }
  | { readonly ok: false; readonly error: string };

/**
 * `POST /api/bundles/:slug/station-run` -- the Overview tab's "Run station"
 * button (plan.md Phase 10). Same detached shape as `triggerRun`: the
 * server forks `StationEngine.runStation` and answers immediately with the
 * run id; progress (station.started / run.completed / review.requested)
 * arrives via the SSE journal stream.
 */
export const triggerStationRun = async (
  slug: string,
  state: string | undefined,
  provider: string | undefined,
): Promise<TriggerStationRunResult> => {
  const raw = await postJson(`/api/bundles/${encodeURIComponent(slug)}/station-run`, {
    ...(state !== undefined ? { state } : {}),
    ...(provider !== undefined ? { provider } : {}),
  });

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(TriggerStationRunResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};

export type PublishBundleResult =
  | { readonly ok: true; readonly response: PublishBundleResponse }
  | { readonly ok: false; readonly error: string };

/**
 * `POST /api/bundles/:slug/publish` -- the skill card's post-publish
 * "Publish to targets" step (Phase 11B). `target` is optional (default:
 * every configured target), mirroring the CLI's `--target` flag.
 */
export const publishBundle = async (slug: string, target: string | undefined): Promise<PublishBundleResult> => {
  const raw = await postJson(`/api/bundles/${encodeURIComponent(slug)}/publish`, {
    ...(target !== undefined ? { target } : {}),
  });

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(PublishBundleResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};

export type RecordVersionResult =
  | { readonly ok: true; readonly response: RecordVersionResponse }
  | { readonly ok: false; readonly error: string };

/**
 * `POST /api/bundles/:slug/record-version` -- the Versions tab's "Record
 * version" button. Hashing happens server-side (the same core function the
 * CLI uses), not here -- this is a plain typed wrapper, same shape as
 * `postEvent`.
 */
export type CreateBundleResult =
  | { readonly ok: true; readonly response: CreateBundleResponse }
  | { readonly ok: false; readonly error: string };

/** `POST /api/bundles` -- scaffold a new bundle in the idea stage (same as `skillmaker new`). */
export const createBundle = async (slug: string, name: string | undefined): Promise<CreateBundleResult> => {
  const raw = await postJson("/api/bundles", { slug, ...(name !== undefined ? { name } : {}) });

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(CreateBundleResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};

export const recordVersion = async (slug: string, label: string | undefined): Promise<RecordVersionResult> => {
  const raw = await postJson(`/api/bundles/${encodeURIComponent(slug)}/record-version`, {
    ...(label !== undefined ? { label } : {}),
  });

  if (raw.ok) {
    const decoded = await Schema.decodeUnknownPromise(RecordVersionResponse)(raw.body);
    return { ok: true, response: decoded };
  }

  const decodedError = await Schema.decodeUnknownPromise(ApiErrorResponse)(raw.body).catch(() =>
    FALLBACK_ERROR(raw.status),
  );
  return { ok: false, error: decodedError.error };
};
