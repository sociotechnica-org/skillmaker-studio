/**
 * Fetches one reviewable bundle file's content
 * (`GET /api/bundles/:slug/file?path=...`), cancellation-guarded so a
 * response landing after the selection changed (or the component unmounted)
 * never clobbers state. Shared by the card's Files tab (picker-driven
 * selection) and Instructions tab (server-derived fixed path) -- the effect
 * exists ONCE, per the same promotion rule as `dates.ts`'s `formatTimestamp`.
 * `path === undefined` means "nothing selected"; the hook is a no-op.
 */
import { useEffect, useState } from "react";
import { getBundleFile } from "./api.ts";

export interface UseBundleFileContentResult {
  readonly content: string | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
}

export const useBundleFileContent = (slug: string, path: string | undefined): UseBundleFileContentResult => {
  const [content, setContent] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (path === undefined) {
      setContent(undefined);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    getBundleFile(slug, path)
      .then((response) => {
        if (!cancelled) {
          setContent(response.content);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setContent(undefined);
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
  }, [slug, path]);

  return { content, loading, error };
};
