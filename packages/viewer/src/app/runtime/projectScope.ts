/**
 * The viewer's ACTIVE PROJECT (machine-registry re-architecture, director
 * rulings 2026-07-27): the server now serves every registered project at
 * `/api/projects/:project/...`, so every project-scoped request the viewer
 * makes must carry the selected project's slug. This module is the ONE
 * place that knows the mapping:
 *
 * - a tiny module-level store for the selected slug (persisted to
 *   localStorage so a reload lands where you were), with a subscribe hook
 *   for React;
 * - `apiPath(path)`: rewrites a legacy-shaped `/api/<rest>` path onto the
 *   active project (`/api/projects/<slug>/<rest>`), passing MACHINE-level
 *   routes (health, chat/providers, the registry itself, fs browsing, the
 *   SSE stream) through untouched. Call sites keep reading exactly as they
 *   always did; the scoping happens at the fetch boundary.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "sm-active-project";

const readStored = (): string | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

let activeProject: string | null = readStored();
const listeners = new Set<() => void>();

export const getActiveProject = (): string | null => activeProject;

export const setActiveProject = (slug: string | null): void => {
  if (slug === activeProject) return;
  activeProject = slug;
  try {
    if (typeof localStorage !== "undefined") {
      if (slug === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, slug);
    }
  } catch {
    // Storage unavailable (private mode) -- selection still works in-memory.
  }
  for (const listener of listeners) listener();
};

export const subscribeActiveProject = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** React view of the active project slug; re-renders on selection change. */
export const useActiveProject = (): string | null =>
  useSyncExternalStore(subscribeActiveProject, getActiveProject, () => null);

/** Routes that live at MACHINE level and must never be project-prefixed. */
const isMachinePath = (path: string): boolean =>
  path === "/api/health" ||
  path === "/api/chat/providers" ||
  path === "/api/events-stream" ||
  path === "/api/projects" ||
  path.startsWith("/api/projects/") ||
  path.startsWith("/api/fs/");

/**
 * A legacy-shaped `/api/<rest>` path, scoped onto the active project.
 * With no project selected yet (first paint before the bootstrap fetch)
 * the path is returned unscoped -- the request 404s quietly and the
 * hooks' placeholder/error fallbacks hold until selection lands.
 */
export const apiPath = (path: string, project: string | null = activeProject): string => {
  if (!path.startsWith("/api/") || isMachinePath(path)) return path;
  if (project === null) return path;
  return `/api/projects/${encodeURIComponent(project)}${path.slice("/api".length)}`;
};
