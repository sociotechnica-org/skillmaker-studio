/**
 * Fetches `/api/catalog` for the `/lab` skill-browser page (was `/catalog`,
 * #64 -- hook name stays `useCatalog` since it mirrors the untouched
 * `/api/catalog` endpoint it wraps). Refetches on every SSE journal event,
 * same as `useBundles`/`useTodos`.
 */
import { useCallback, useEffect, useState } from "react";
import { getCatalog } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { CatalogEntry } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseCatalogResult {
  readonly entries: ReadonlyArray<CatalogEntry>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useCatalog = (): UseCatalogResult => {
  const [entries, setEntries] = useState<ReadonlyArray<CatalogEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getCatalog()
      .then((response) => {
        setEntries(response.entries);
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

  return { entries, loading, error, refetch };
};
