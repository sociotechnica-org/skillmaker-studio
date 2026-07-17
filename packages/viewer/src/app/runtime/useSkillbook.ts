/**
 * Fetches `/api/skillbook` for the `/ship` page (was `/skillbook`, #64;
 * renamed from `/port`, #72; data-model.md §2.14 -- hook name stays
 * `useSkillbook` since it mirrors the untouched `/api/skillbook` endpoint
 * it wraps, and it also backs the per-bundle Skillbook chapter). Refetches
 * on every SSE journal event, same as `useCatalog`.
 */
import { useCallback, useEffect, useState } from "react";
import { getSkillbook } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { SkillbookBundle } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseSkillbookResult {
  readonly bundles: ReadonlyArray<SkillbookBundle>;
  /** The workspace's display name -- the Skillbook cover's byline (issue #109 Stage 3). */
  readonly workspaceName: string | undefined;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useSkillbook = (): UseSkillbookResult => {
  const [bundles, setBundles] = useState<ReadonlyArray<SkillbookBundle>>([]);
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getSkillbook()
      .then((response) => {
        setBundles(response.bundles);
        setWorkspaceName(response.workspaceName);
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

  return { bundles, workspaceName, loading, error, refetch };
};
