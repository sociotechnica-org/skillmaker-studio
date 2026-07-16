/**
 * Fetches `/api/field-reports` for the `/receive` page (issue #67). Refetches
 * on every SSE journal event, same as `useSkillbook`/`useBundles` -- posting
 * a field report through Receive's paste form fires `skill.field_report`
 * onto the broadcaster, which lands here immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { getFieldReports } from "./api.ts";
import type { RuntimeError } from "./errors.ts";
import type { FieldReportView } from "./schemas.ts";
import { useEventStream } from "./useEventStream.ts";

export interface UseFieldReportsResult {
  readonly reports: ReadonlyArray<FieldReportView>;
  readonly loading: boolean;
  readonly error: RuntimeError | undefined;
  readonly refetch: () => void;
}

export const useFieldReports = (): UseFieldReportsResult => {
  const [reports, setReports] = useState<ReadonlyArray<FieldReportView>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RuntimeError | undefined>(undefined);

  const refetch = useCallback(() => {
    setLoading(true);
    getFieldReports()
      .then((response) => {
        setReports(response.reports);
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

  return { reports, loading, error, refetch };
};
