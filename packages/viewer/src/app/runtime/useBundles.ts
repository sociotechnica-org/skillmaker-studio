/**
 * Fetches `/api/bundles` and keeps it fresh: an initial load plus a refetch
 * every time the SSE journal stream fires (Board page, Phase 3).
 */
import { useCallback, useEffect, useState } from "react";
import { getBundles } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { BundleRecord } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseBundlesResult {
  readonly bundles: ReadonlyArray<BundleRecord>;
  /** bundle slug -> fixture count, for the board's subtle fixture-count indicator (plan.md Phase 7). */
  readonly fixtureCounts: Readonly<Record<string, number>>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
}

export const useBundles = (): UseBundlesResult => {
  const [bundles, setBundles] = useState<ReadonlyArray<BundleRecord>>([]);
  const [fixtureCounts, setFixtureCounts] = useState<Readonly<Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    getBundles()
      .then((response) => {
        setBundles(response.bundles);
        setFixtureCounts(response.fixtureCounts);
        setError(undefined);
      })
      .catch((cause: RuntimeError) => {
        setError(cause);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEventStream("/api/events-stream", refetch);

  return { bundles, fixtureCounts, loading, error };
};
