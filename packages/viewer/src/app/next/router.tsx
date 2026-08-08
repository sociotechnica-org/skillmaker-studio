/**
 * The mounted shell's deliberately small History API router. Issue #208
 * makes the browser URL authoritative for places a teammate can share; panel
 * layout remains local device state and is intentionally absent here.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { getActiveProject, setActiveProject } from "../runtime/projectScope.ts";

export const SKILL_TABS = ["overview", "research", "eval", "publish"] as const;
export type SkillTab = (typeof SKILL_TABS)[number];

export type StudioRoute =
  | { readonly name: "board"; readonly projectSlug?: string }
  | { readonly name: "tasks"; readonly projectSlug?: string }
  | { readonly name: "new-skill"; readonly projectSlug: string }
  | { readonly name: "skill"; readonly projectSlug: string; readonly skillSlug: string; readonly tab: SkillTab; readonly version?: string }
  | { readonly name: "invalid" };

const decode = (part: string): string | undefined => {
  try {
    const value = decodeURIComponent(part);
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
};

export const parseStudioRoute = (pathname: string, search = ""): StudioRoute => {
  const parts = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  const versions = params.getAll("v");
  const version = versions.length === 1 && /^[0-9a-f]{8}$/.test(versions[0] ?? "") ? versions[0] : undefined;
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "board")) return versions.length === 0 ? { name: "board" } : { name: "invalid" };
  if (parts.length === 1 && parts[0] === "tasks") return versions.length === 0 ? { name: "tasks" } : { name: "invalid" };
  if (parts[0] !== "p") return { name: "invalid" };
  const projectSlug = decode(parts[1] ?? "");
  if (projectSlug === undefined) return { name: "invalid" };
  if (parts.length === 2) return versions.length === 0 ? { name: "board", projectSlug } : { name: "invalid" };
  if (parts.length === 3 && parts[2] === "tasks") return versions.length === 0 ? { name: "tasks", projectSlug } : { name: "invalid" };
  if (parts.length === 3 && parts[2] === "new") return versions.length === 0 ? { name: "new-skill", projectSlug } : { name: "invalid" };
  if (parts[2] !== "s") return { name: "invalid" };
  const skillSlug = decode(parts[3] ?? "");
  if (skillSlug === undefined || parts.length > 5) return { name: "invalid" };
  const tab = parts.length === 5 ? parts[4] : "overview";
  if (!SKILL_TABS.includes(tab as SkillTab)) return { name: "invalid" };
  return { name: "skill", projectSlug, skillSlug, tab: tab as SkillTab, ...(version === undefined ? {} : { version }) };
};

export const boardHref = (projectSlug?: string): string => projectSlug === undefined ? "/board" : `/p/${encodeURIComponent(projectSlug)}`;
export const tasksHref = (projectSlug?: string): string => projectSlug === undefined ? "/tasks" : `/p/${encodeURIComponent(projectSlug)}/tasks`;
export const newSkillHref = (projectSlug: string): string => `/p/${encodeURIComponent(projectSlug)}/new`;
export const skillHref = (projectSlug: string, skillSlug: string, tab: SkillTab = "overview", version?: string): string => {
  const path = `/p/${encodeURIComponent(projectSlug)}/s/${encodeURIComponent(skillSlug)}${tab === "overview" ? "" : `/${tab}`}`;
  return version === undefined ? path : `${path}?${new URLSearchParams({ v: version })}`;
};

const routeProject = (route: StudioRoute): string | undefined =>
  route.name === "board" || route.name === "tasks" ? route.projectSlug : route.name === "new-skill" || route.name === "skill" ? route.projectSlug : undefined;

const readLocation = (): StudioRoute => parseStudioRoute(window.location.pathname, window.location.search);

export type StudioRouter = {
  readonly route: StudioRoute;
  readonly navigate: (href: string) => void;
  readonly replace: (href: string) => void;
};

export const useStudioRouter = (): StudioRouter => {
  const [route, setRoute] = useState<StudioRoute>(() => (typeof window === "undefined" ? { name: "board" } : readLocation()));
  const publish = useCallback((href: string, replace: boolean) => {
    const next = parseStudioRoute(new URL(href, window.location.origin).pathname, new URL(href, window.location.origin).search);
    const project = routeProject(next);
    if (project !== undefined) setActiveProject(project);
    window.history[replace ? "replaceState" : "pushState"]({}, "", href);
    setRoute(next);
  }, []);
  const navigate = useCallback((href: string) => publish(href, false), [publish]);
  const replace = useCallback((href: string) => publish(href, true), [publish]);

  useLayoutEffect(() => {
    const project = routeProject(route);
    if (project !== undefined && getActiveProject() !== project) setActiveProject(project);
  }, [route]);
  useEffect(() => {
    const onPopState = () => {
      const next = readLocation();
      const project = routeProject(next);
      if (project !== undefined) setActiveProject(project);
      setRoute(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return { route, navigate, replace };
};
