/**
 * Fetches `/api/events` (paginated) for the Activity page: an initial page,
 * a `loadMore()` that appends the next page via `nextCursor`, and a refetch
 * (back to the first page) every time the SSE journal stream fires --
 * mirroring `useBundles`/`useTodos`'s refetch-on-SSE pattern.
 */
import { useCallback, useEffect, useState } from "react";
import { getEvents } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { EventView } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

const PAGE_SIZE = 50;

export interface UseEventsResult {
  readonly events: ReadonlyArray<EventView>;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: RuntimeError | undefined;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
}

export const useEvents = (): UseEventsResult => {
  const [events, setEvents] = useState<ReadonlyArray<EventView>>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getEvents({ limit: PAGE_SIZE })
      .then((response) => {
        setEvents(response.events);
        setCursor(response.nextCursor ?? undefined);
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

  const loadMore = useCallback(() => {
    if (cursor === undefined || loadingMore) {
      return;
    }
    setLoadingMore(true);
    getEvents({ limit: PAGE_SIZE, before: cursor })
      .then((response) => {
        setEvents((current) => [...current, ...response.events]);
        setCursor(response.nextCursor ?? undefined);
        setError(undefined);
      })
      .catch((cause: RuntimeError) => {
        setError(cause);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [cursor, loadingMore]);

  return { events, loading, loadingMore, error, hasMore: cursor !== undefined, loadMore };
};
