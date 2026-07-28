/**
 * Selects the ACTIVE PROJECT on app start (machine-registry rulings
 * 2026-07-27): fetches the registry (`GET /api/projects`), keeps the stored
 * selection when it still exists, otherwise picks the first healthy
 * project. Resolves to a status either way -- a serverless `astro dev`
 * page ("no-server") renders placeholders exactly as before.
 */
import { useEffect, useState } from "react";
import { getActiveProject, setActiveProject } from "./projectScope.ts";

export type ProjectBootstrapStatus = "loading" | "ready" | "no-server";

export const useProjectBootstrap = (): ProjectBootstrapStatus => {
  const [status, setStatus] = useState<ProjectBootstrapStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          readonly projects?: ReadonlyArray<{ readonly slug?: unknown; readonly ok?: unknown }>;
        };
        const rows = Array.isArray(body.projects) ? body.projects : [];
        const slugs = rows.map((row) => (typeof row.slug === "string" ? row.slug : null)).filter((s): s is string => s !== null);
        if (cancelled) return;
        const stored = getActiveProject();
        if (stored === null || !slugs.includes(stored)) {
          const firstOk = rows.find((row) => typeof row.slug === "string" && row.ok !== false);
          setActiveProject(typeof firstOk?.slug === "string" ? firstOk.slug : (slugs[0] ?? null));
        }
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("no-server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
};
