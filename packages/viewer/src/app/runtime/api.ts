/**
 * Typed wrappers over the `/api/*` endpoints served by `packages/cli`'s
 * server module. Each function is a plain async function -- no `Effect`
 * escapes this directory.
 */
import { fetchJson } from "./client.ts";
import { BundlesResponse, HealthResponse, StateResponse } from "./schemas.ts";

export const getHealth = (): Promise<HealthResponse> => fetchJson("/api/health", HealthResponse);

export const getState = (): Promise<StateResponse> => fetchJson("/api/state", StateResponse);

export const getBundles = (): Promise<BundlesResponse> =>
  fetchJson("/api/bundles", BundlesResponse);
