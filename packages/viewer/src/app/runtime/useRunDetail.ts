/**
 * Fetches `/api/bundles/:slug/runs/:runId` and keeps it fresh, mirroring
 * `useBundleDetail`: an initial load plus a refetch every time the SSE
 * journal stream fires (a grade lands as a `run.graded` journal event, so
 * grading history and the run's verdict stay live with no extra plumbing).
 * `runId === undefined` means "no run selected" -- the hook is a no-op.
 */
import { useCallback, useEffect, useState } from "react";
import { getRunDetail } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { RunDetailResponse } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseRunDetailResult {
  readonly detail: RunDetailResponse | undefined;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useRunDetail = (slug: string, runId: string | undefined): UseRunDetailResult => {
  const [detail, setDetail] = useState<RunDetailResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    if (runId === undefined) {
      setDetail(undefined);
      setError(undefined);
      return;
    }
    setLoading(true);
    getRunDetail(slug, runId)
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
  }, [slug, runId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEventStream("/api/events-stream", refetch);

  return { detail, loading, error, refetch };
};
