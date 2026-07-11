/**
 * Fetches `/api/skillbook` for the `/skillbook` page (data-model.md §2.14).
 * Refetches on every SSE journal event, same as `useCatalog`.
 */
import { useCallback, useEffect, useState } from "react";
import { getSkillbook } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { SkillbookBundle } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseSkillbookResult {
  readonly workspaceName: string | undefined;
  readonly bundles: ReadonlyArray<SkillbookBundle>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useSkillbook = (): UseSkillbookResult => {
  const [workspaceName, setWorkspaceName] = useState<string | undefined>(undefined);
  const [bundles, setBundles] = useState<ReadonlyArray<SkillbookBundle>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getSkillbook()
      .then((response) => {
        setWorkspaceName(response.workspaceName);
        setBundles(response.bundles);
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

  return { workspaceName, bundles, loading, error, refetch };
};
