/**
 * Fetches `/api/intake` for the `/receive` page's dock queue (issue #90).
 * Refetches on every SSE journal event, same as `useFieldReports` --
 * `skillmaker receive` runs CLI-side, so the viewer never writes here, only
 * watches the journal for the next `skill.received` to show up.
 */
import { useCallback, useEffect, useState } from "react";
import { getIntake } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { IntakeCrateView, RecentlyRoutedView, SalvagedCrateView } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseIntakeResult {
  readonly crates: ReadonlyArray<IntakeCrateView>;
  /** issue #91: the last few `skill.routed` facts, newest first -- a disposed crate's trace after it leaves `crates`. */
  readonly recentlyRouted: ReadonlyArray<RecentlyRoutedView>;
  /** issue #109: the Archive drawer's salvaged population -- the FULL salvage fold, newest first. */
  readonly salvaged: ReadonlyArray<SalvagedCrateView>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useIntake = (): UseIntakeResult => {
  const [crates, setCrates] = useState<ReadonlyArray<IntakeCrateView>>([]);
  const [recentlyRouted, setRecentlyRouted] = useState<ReadonlyArray<RecentlyRoutedView>>([]);
  const [salvaged, setSalvaged] = useState<ReadonlyArray<SalvagedCrateView>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getIntake()
      .then((response) => {
        setCrates(response.crates);
        setRecentlyRouted(response.recentlyRouted);
        setSalvaged(response.salvaged);
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

  return { crates, recentlyRouted, salvaged, loading, error, refetch };
};
