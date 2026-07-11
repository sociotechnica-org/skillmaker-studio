/**
 * Fetches `/api/bundles/:slug` and keeps it fresh: an initial load plus a
 * refetch every time the SSE journal stream fires, mirroring `useBundles`.
 * `slug === undefined` means "no bundle selected" -- the hook is a no-op.
 */
import { useCallback, useEffect, useState } from "react";
import { getBundleDetail } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { BundleDetailResponse } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseBundleDetailResult {
  readonly detail: BundleDetailResponse | undefined;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useBundleDetail = (slug: string | undefined): UseBundleDetailResult => {
  const [detail, setDetail] = useState<BundleDetailResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    if (slug === undefined) {
      setDetail(undefined);
      setError(undefined);
      return;
    }
    setLoading(true);
    getBundleDetail(slug)
      .then((response) => {
        setDetail(response);
        setError(undefined);
      })
      .catch((cause: RuntimeError) => {
        setError(cause);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEventStream("/api/events-stream", refetch);

  return { detail, loading, error, refetch };
};
