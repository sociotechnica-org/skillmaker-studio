/**
 * Fetches `/api/todos` and keeps it fresh: an initial load plus a refetch
 * every time the SSE journal stream fires, mirroring `useBundles`.
 */
import { useCallback, useEffect, useState } from "react";
import { getTodos } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { TodoRecord } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseTodosResult {
  readonly todos: ReadonlyArray<TodoRecord>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useTodos = (includeSwept: boolean): UseTodosResult => {
  const [todos, setTodos] = useState<ReadonlyArray<TodoRecord>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    getTodos(includeSwept)
      .then((response) => {
        setTodos(response.todos);
        setError(undefined);
      })
      .catch((cause: RuntimeError) => {
        setError(cause);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [includeSwept]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEventStream("/api/events-stream", refetch);

  return { todos, loading, error, refetch };
};
