/**
 * Fetches one fixture's readable test body
 * (`GET /api/bundles/:slug/fixtures/:case`), cancellation-guarded --
 * `useBundleFileContent`'s sibling, same contract: `caseName === undefined`
 * means "not expanded", the hook is a no-op, so fixture bodies load LAZILY
 * on expand and never eagerly for every row (card-fidelity round 2).
 */
import { useEffect, useState } from "react";
import { getFixtureDetail } from "./api.ts";
import type { FixtureDetailResponse } from "./schemas.ts";

export interface UseFixtureDetailResult {
  readonly detail: FixtureDetailResponse | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export const useFixtureDetail = (slug: string, caseName: string | undefined): UseFixtureDetailResult => {
  const [detail, setDetail] = useState<FixtureDetailResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (caseName === undefined) {
      setDetail(undefined);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    getFixtureDetail(slug, caseName)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setDetail(undefined);
          setError(cause.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, caseName]);

  return { detail, loading, error };
};
