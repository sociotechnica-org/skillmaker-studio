/** Fetches `/api/state` once for the header (workspace name). */
import { useEffect, useState } from "react";
import { getState } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { StateResponse } from "./schemas.ts";

export interface UseWorkspaceResult {
  readonly state: StateResponse | undefined;
  readonly error: RuntimeError | undefined;
}

export const useWorkspace = (): UseWorkspaceResult => {
  const [state, setState] = useState<StateResponse | undefined>(undefined);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  useEffect(() => {
    getState()
      .then(setState)
      .catch((cause: RuntimeError) => setError(cause));
  }, []);

  return { state, error };
};
