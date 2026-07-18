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

/**
 * The skill card's tabs (issue #109): Overview · Instructions · Models ·
 * Coverage · Research · Lineage, plus Files (the panel's read-only source
 * review, kept as its own tab so `?file=` deep links keep a stable home).
 * Instructions (card-fidelity round) is the skill ITSELF -- the shipped
 * SKILL.md rendered read-only, first content after Overview, so the card
 * never again shows everything *about* the skill and never the skill. The
 * old panel's `evals` and `versions` tab paths survive as aliases (`evals`
 * -> `models`, where the measurements + runs now live; `versions` ->
 * `lineage`, where version records now live in the custody chain) --
 * display-layer only, old deep links keep working.
 */
export type BundleTab = "overview" | "instructions" | "models" | "coverage" | "research" | "lineage" | "files";

const BUNDLE_TABS: ReadonlyArray<BundleTab> = [
  "overview",
  "instructions",
  "models",
  "coverage",
  "research",
  "lineage",
  "files",
];

const isBundleTab = (value: string): value is BundleTab =>
  (BUNDLE_TABS as ReadonlyArray<string>).includes(value);

/** The old panel's tab paths, parsed into their card-era homes so bookmarks survive. */
const BUNDLE_TAB_ALIASES: Readonly<Record<string, BundleTab>> = {
  evals: "models",
  versions: "lineage",
};

/** The Lab's two modes (#83): Bench (default, the triage rows) and Queue (the whole workspace's todos). */
export type LabView = "bench" | "queue";

/** Track's two rooms (#109): Catalog (default, the complete inside index) and Feed (the journal, chronological). */
export type TrackView = "catalog" | "feed";

/**
 * The room a skill card was opened FROM (`?from=`, card-fidelity round 2):
 * the card is the per-skill projection every surface indexes -- it belongs
 * to no single room, so the room that linked in rides along as a display
 * hint (back link + nav highlight) instead of the card hard-wiring itself
 * to Make. Absent/invalid = Make (the default, exactly today's behavior for
 * a direct URL). Display-layer only: route names stay frozen, and the param
 * threads through the card's internal links the same way `?run=`/`?file=`
 * ride their tabs' hrefs.
 */
export type CardOrigin = "improve" | "track" | "ship" | "receive";

const CARD_ORIGINS: ReadonlyArray<CardOrigin> = ["improve", "track", "ship", "receive"];

const parseCardOrigin = (value: string | null): CardOrigin | undefined =>
  value !== null && (CARD_ORIGINS as ReadonlyArray<string>).includes(value) ? (value as CardOrigin) : undefined;

export type Route =
  | { readonly name: "board" }
  | {
      readonly name: "bundle";
      readonly slug: string;
      readonly tab: BundleTab;
      readonly runId: string | undefined;
      readonly file: string | undefined;
      /** `?fixture=<case>` on the Models tab: auto-expand + scroll to that fixture's test body (Coverage's cross-link target). */
      readonly fixture: string | undefined;
      readonly from: CardOrigin | undefined;
    }
  | { readonly name: "lab"; readonly view: LabView; readonly bundle: string | undefined }
  | { readonly name: "track"; readonly view: TrackView; readonly archive: boolean }
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
 *
 * `/lab`'s mode is a URL query, not a path segment (#83): `?view=queue`
 * selects Queue, anything else (including the param's absence) is Bench --
 * old `/lab` and `/catalog` deep links keep working untouched, they just
 * default to Bench like they always rendered. `?bundle=<slug>` is Queue's
 * optional bundle filter (how Bench's per-row open-work signal links in);
 * it round-trips through the querystring on Bench too so a bookmark never
 * silently drops it, even though Bench itself ignores it.
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
    const params = new URLSearchParams(search);
    const view: LabView = params.get("view") === "queue" ? "queue" : "bench";
    const bundle = params.get("bundle") ?? undefined;
    return { name: "lab", view, bundle };
  }
  if (head === "track" && segments.length === 1) {
    const params = new URLSearchParams(search);
    const view: TrackView = params.get("view") === "feed" ? "feed" : "catalog";
    return { name: "track", view, archive: params.get("archive") === "1" };
  }
  // `/activity` survives as an alias into Track's Feed (#109: "Activity's
  // nav entry is replaced by Track... old routes keep working").
  if (head === "activity" && segments.length === 1) {
    return { name: "track", view: "feed", archive: false };
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
    const rawTab = segments[2];
    const tabSegment = rawTab !== undefined ? (BUNDLE_TAB_ALIASES[rawTab] ?? rawTab) : undefined;
    if (tabSegment !== undefined && !isBundleTab(tabSegment)) {
      return { name: "not-found" };
    }
    const params = new URLSearchParams(search);
    const runId = params.get("run") ?? undefined;
    const file = params.get("file") ?? undefined;
    const fixture = params.get("fixture") ?? undefined;
    const from = parseCardOrigin(params.get("from"));
    return { name: "bundle", slug, tab: tabSegment ?? "overview", runId, file, fixture, from };
  }
  return { name: "not-found" };
};

/** Appends `?from=<origin>` (plus any extra params) to a bundle path -- absent origin = Make = no param at all, so today's URLs stay byte-identical. */
const withBundleParams = (
  base: string,
  from: CardOrigin | undefined,
  extra?: Readonly<Record<string, string>>,
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra ?? {})) {
    params.set(key, value);
  }
  if (from !== undefined) {
    params.set("from", from);
  }
  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
};

/** The canonical URL for a bundle's tab -- `overview` has no path suffix; `from` is the origin room the card should display under (absent = Make). */
export const bundleHref = (slug: string, tab: BundleTab = "overview", from?: CardOrigin): string =>
  withBundleParams(
    tab === "overview" ? `/bundles/${encodeURIComponent(slug)}` : `/bundles/${encodeURIComponent(slug)}/${tab}`,
    from,
  );

/** The canonical URL for a bundle's Skillbook chapter, now docked at Ship. */
export const shipBundleHref = (slug: string): string => `/ship/${encodeURIComponent(slug)}`;

/**
 * The Lab's URL for a given mode, optionally filtered to one bundle's todos
 * (#83) -- Bench's default view has no query string at all, so the
 * long-lived bare `/lab` URL is exactly what `labHref("bench")` produces.
 */
export const labHref = (view: LabView, bundle?: string): string => {
  const params = new URLSearchParams();
  if (view === "queue") {
    params.set("view", "queue");
  }
  if (bundle !== undefined) {
    params.set("bundle", bundle);
  }
  const query = params.toString();
  return query.length > 0 ? `/lab?${query}` : "/lab";
};

/**
 * Track's URL for a room, with the Archive drawer's open state as a query
 * flag (#109) -- the drawer is a fold of the Catalog, so its open state is a
 * bookmarkable view, not local state. The default room's bare URL is
 * exactly `/track`.
 */
export const trackHref = (view: TrackView = "catalog", options?: { readonly archive?: boolean }): string => {
  const params = new URLSearchParams();
  if (view === "feed") {
    params.set("view", "feed");
  }
  if (options?.archive === true) {
    params.set("archive", "1");
  }
  const query = params.toString();
  return query.length > 0 ? `/track?${query}` : "/track";
};

/** The Models tab (the measurements + runs read-out), optionally with a run selected via `?run=`; `from` preserves the card's origin room. */
export const bundleRunHref = (slug: string, runId: string | undefined, from?: CardOrigin): string =>
  withBundleParams(
    `/bundles/${encodeURIComponent(slug)}/models`,
    from,
    runId === undefined ? undefined : { run: runId },
  );

/** The Files tab with a specific source file pre-selected via `?file=`; `from` preserves the card's origin room. */
export const bundleFileHref = (slug: string, file: string, from?: CardOrigin): string =>
  withBundleParams(`/bundles/${encodeURIComponent(slug)}/files`, from, { file });

/** The Models tab with one fixture's test body auto-expanded via `?fixture=` -- Coverage's cross-link to the test it references. */
export const bundleFixtureHref = (slug: string, caseName: string, from?: CardOrigin): string =>
  withBundleParams(`/bundles/${encodeURIComponent(slug)}/models`, from, { fixture: caseName });

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
  title?: string | undefined;
  children: ReactNode;
  onClick?: (() => void) | undefined;
}> = ({ href, className, title, children, onClick }) => {
  const { navigate } = useRouter();
  return (
    <a
      href={href}
      className={className}
      title={title}
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
