/**
 * A hand-rolled client router (ui-pass-spec.md §4.2): six flat routes, one
 * dynamic segment (`:slug`), one query param (`run`) -- not enough surface
 * to justify a router dependency (`packages/viewer/package.json` pulls in
 * none, and no other workspace package does either). `navigate()` calls
 * `history.pushState` then updates React state, the same mechanic the old
 * PMS Studio used successfully for its one `openPlayCard` entry point
 * (ui-pass-spec.md §1.2), just applied consistently to every navigation
 * instead of only one.
 */
import { createContext, useCallback, useContext, useEffect, useState, type FC, type ReactNode } from "react";

export type BundleTab = "overview" | "files" | "versions" | "evals";

const BUNDLE_TABS: ReadonlyArray<BundleTab> = ["overview", "files", "versions", "evals"];

const isBundleTab = (value: string): value is BundleTab =>
  (BUNDLE_TABS as ReadonlyArray<string>).includes(value);

export type Route =
  | { readonly name: "board" }
  | {
      readonly name: "bundle";
      readonly slug: string;
      readonly tab: BundleTab;
      readonly runId: string | undefined;
      readonly file: string | undefined;
    }
  | { readonly name: "lab" }
  | { readonly name: "activity" }
  | { readonly name: "ship" }
  | { readonly name: "ship-bundle"; readonly slug: string }
  | { readonly name: "receive" }
  | { readonly name: "not-found" };

/**
 * Pure -- parses a pathname + search string into a `Route`. Exported for
 * tests. `/lab`, `/ship(/:slug)`, and `/receive` are canonical (#72, the
 * Board · Lab · Ship · Receive · Activity rename that splits Port into its
 * two jobs). `/catalog`, `/port(/:slug)`, and `/skillbook(/:slug)` are kept
 * as aliases parsing to the same routes so bookmarks and any deep links
 * survive -- this is display-layer only, the server API paths behind these
 * pages (`/api/catalog`, `/api/skillbook`) are untouched.
 */
export const parseRoute = (pathname: string, search: string): Route => {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const head =
    segments[0] === "catalog"
      ? "lab"
      : segments[0] === "skillbook" || segments[0] === "port"
        ? "ship"
        : segments[0];

  if (segments.length === 0) {
    return { name: "board" };
  }
  if (head === "lab" && segments.length === 1) {
    return { name: "lab" };
  }
  if (head === "activity" && segments.length === 1) {
    return { name: "activity" };
  }
  if (head === "ship" && segments.length === 1) {
    return { name: "ship" };
  }
  if (head === "ship" && segments[1] !== undefined && segments.length === 2) {
    return { name: "ship-bundle", slug: decodeURIComponent(segments[1]) };
  }
  if (head === "receive" && segments.length === 1) {
    return { name: "receive" };
  }
  if (segments[0] === "bundles" && segments[1] !== undefined && segments.length <= 3) {
    const slug = decodeURIComponent(segments[1]);
    const tabSegment = segments[2];
    if (tabSegment !== undefined && !isBundleTab(tabSegment)) {
      return { name: "not-found" };
    }
    const params = new URLSearchParams(search);
    const runId = params.get("run") ?? undefined;
    const file = params.get("file") ?? undefined;
    return { name: "bundle", slug, tab: tabSegment ?? "overview", runId, file };
  }
  return { name: "not-found" };
};

/** The canonical URL for a bundle's tab -- `overview` has no path suffix. */
export const bundleHref = (slug: string, tab: BundleTab = "overview"): string =>
  tab === "overview" ? `/bundles/${encodeURIComponent(slug)}` : `/bundles/${encodeURIComponent(slug)}/${tab}`;

/** The canonical URL for a bundle's Skillbook chapter, now docked at Ship. */
export const shipBundleHref = (slug: string): string => `/ship/${encodeURIComponent(slug)}`;

/** The Evals tab, optionally with a run selected via `?run=`. */
export const bundleRunHref = (slug: string, runId: string | undefined): string => {
  const base = bundleHref(slug, "evals");
  return runId === undefined ? base : `${base}?run=${encodeURIComponent(runId)}`;
};

/** The Files tab with a specific source file pre-selected via `?file=`. */
export const bundleFileHref = (slug: string, file: string): string =>
  `${bundleHref(slug, "files")}?file=${encodeURIComponent(file)}`;

interface RouterState {
  readonly route: Route;
  readonly navigate: (path: string) => void;
}

const RouterContext = createContext<RouterState | undefined>(undefined);

/**
 * `App` is rendered once during Astro's static-build SSR pass (before
 * `client:load` hydration takes over in the browser) -- `window` doesn't
 * exist there, so this falls back to the board route for that pass only;
 * hydration immediately re-derives the real route from `window.location`.
 */
const currentRoute = (): Route =>
  typeof window === "undefined" ? { name: "board" } : parseRoute(window.location.pathname, window.location.search);

export const RouterProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onPopState = (): void => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string): void => {
    if (`${window.location.pathname}${window.location.search}` === path) {
      return;
    }
    window.history.pushState(null, "", path);
    setRoute(currentRoute());
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
};

export const useRouter = (): RouterState => {
  const context = useContext(RouterContext);
  if (context === undefined) {
    throw new Error("useRouter must be used inside a <RouterProvider>");
  }
  return context;
};

/**
 * A real `<a href>` intercepted client-side -- exactly one navigation
 * mechanism for every destination (ui-pass-spec.md §3.4#3 fixes the old
 * Studio's Board-pushState-vs-Catalog-full-reload split). Falls through to
 * a normal browser navigation on modified clicks (new tab, etc.).
 */
export const Link: FC<{
  href: string;
  className?: string | undefined;
  children: ReactNode;
  onClick?: (() => void) | undefined;
}> = ({ href, className, children, onClick }) => {
  const { navigate } = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onClick?.();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
};
