/**
 * The Skillmaker Studio shell (IA doc §B, ruled 2026-07-22): one app, many
 * projects, skill at the center. Layout rules encoded here:
 *
 * - Three sections: left sidebar · center column · right panel. The side
 *   sections run full height with "implied" borderless top rows; only the
 *   center header has a bottom border.
 * - The panel toggles are pinned to the window's top corners: identical
 *   position in both states, and they never ride the slide animations.
 * - Sidebars slide open/closed (width transition) and are border-drag
 *   resizable, persisted to localStorage.
 * - The overview (details) is an in-layout column when the right panel is
 *   closed (content slides over), and a click-away-dismissed overlay when
 *   the right panel is open.
 * - The right panel exists on skill pages only.
 */
import { useEffect, useState } from "react";
import { useActiveProject } from "../runtime/projectScope.ts";
import { useProjectBootstrap } from "../runtime/useProjectBootstrap.ts";
import { usePanelResize } from "./hooks.ts";
import { CollapseIcon, ExpandIcon, OverviewIcon, PanelLeftIcon, PanelRightIcon } from "./icons.tsx";
import { NewSkillLauncher } from "./NewSkillLauncher.tsx";
import { RightPanel, type ChatIntro } from "./RightPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { IconButton } from "./ui.tsx";
import { BoardView, OverviewCard, SkillView, TasksView, useSkillPage } from "./views.tsx";
import { TopBarSkillControls } from "./SkillPage.tsx";
import { CURRENT_DRAFT } from "./SkillPage.tsx";
import { boardHref, canonicalStudioHref, skillHref, tasksHref, useStudioRouter, versionPin } from "./router.tsx";

/** Top-bar bridge: owns nothing, fetches the shared skill page for the controls. */
function TopBarControls({ slug, pinned, onPin }: { readonly slug: string; readonly pinned: string; readonly onPin: (v: string) => void }) {
  const page = useSkillPage(slug);
  const fullHash = pinned === CURRENT_DRAFT ? CURRENT_DRAFT : page.versions.find((version) => version.shortHash === pinned)?.hash ?? CURRENT_DRAFT;
  return <TopBarSkillControls slug={slug} page={page} pinned={fullHash} onPin={onPin} />;
}
export default function NextShell() {
  // Machine registry (2026-07-27 rulings): resolve the ACTIVE project up
  // front -- stored selection if still registered, else the first healthy
  // project. Hooks re-fetch when the selection lands/changes.
  const bootstrapStatus = useProjectBootstrap();
  const activeProject = useActiveProject();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(() => {
    try {
      return localStorage.getItem("sm-next-right-open") !== "false";
    } catch {
      return true;
    }
  });
  const { route, navigate, replace } = useStudioRouter();
  const [overviewOpen, setOverviewOpen] = useState(true);
  // A center-panel "open in Files" request: RightPanel consumes + clears it.
  const [fileRequest, setFileRequest] = useState<string | null>(null);
  const [overviewOverlay, setOverviewOverlay] = useState(false);
  // Set by the new-skill launcher: the chat panel starts a session for this
  // skill whose first prompt is the launcher's message, then clears it.
  const [chatIntro, setChatIntro] = useState<(ChatIntro & { readonly projectSlug: string }) | null>(null);
  // New-project dialog state lives HERE (not in Sidebar) so the Board's
  // empty-registry welcome opens the very same dialog (e2e-readiness
  // blocker: first run must offer a next action).
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("sm-next-right-open", String(rightOpen));
    } catch {
      // The layout is still useful when storage is unavailable.
    }
  }, [rightOpen]);

  const left = usePanelResize("left", "sm-next-leftw", 256, 180, 440);
  // The right panel may eat almost everything: the center keeps ~300px.
  const right = usePanelResize("right", "sm-next-rightw", 320, 240, () =>
    Math.max(340, window.innerWidth - 300 - (sidebarOpen ? left.width : 0)),
  );
  const dragging = left.dragging || right.dragging;

  const [rightExpanded, setRightExpanded] = useState(false);
  // `/` is retained as a compatibility entry point, but never remains a
  // history destination once the client shell owns the route.
  useEffect(() => {
    if (route.name === "invalid") replace(boardHref());
    else if (window.location.pathname === "/") replace(boardHref());
    else if (route.name === "tasks" && route.projectSlug === undefined) {
      // Wait for the registry to validate the persisted selection. A stale
      // localStorage value must not manufacture a project-scoped Tasks URL.
      if (bootstrapStatus === "ready" && activeProject !== null) replace(tasksHref(activeProject));
    }
    else {
      const canonical = canonicalStudioHref(route);
      if (`${window.location.pathname}${window.location.search}` !== canonical) replace(canonical);
    }
  }, [activeProject, bootstrapStatus, replace, route]);
  useEffect(() => {
    if (route.name !== "board" && route.name !== "tasks" && route.name !== "new-skill" && route.name !== "skill") return;
    const projectSlug = route.name === "new-skill" || route.name === "skill" ? route.projectSlug : route.projectSlug;
    if (projectSlug === undefined) return;
    let cancelled = false;
    void fetch("/api/projects", { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { projects?: unknown };
      if (!Array.isArray(body.projects) || cancelled) return;
      const project = body.projects.find((row): row is { slug: string; skills?: unknown } =>
        typeof row === "object" && row !== null && (row as { slug?: unknown }).slug === projectSlug && (row as { ok?: unknown }).ok !== false,
      );
      if (project === undefined) replace(boardHref());
      else if (route.name === "skill" && Array.isArray(project.skills) && !project.skills.some((skill) =>
        typeof skill === "object" && skill !== null && (skill as { slug?: unknown }).slug === route.skillSlug,
      )) replace(boardHref());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [replace, route]);

  const onSkillPage = route.name === "skill";
  const rightShown = onSkillPage && rightOpen;
  const expanded = rightShown && rightExpanded;
  const title =
    route.name === "board" ? "Board" : route.name === "tasks" ? "Tasks" : route.name === "new-skill" ? "New skill" : route.name === "skill" ? route.skillSlug : "Board";

  // Overview rules: with the right panel CLOSED, the overview is an
  // in-layout column (persists, content slides over). With the right panel
  // OPEN, the toggle shows the overview as a transient OVERLAY hovering
  // above the content — any click elsewhere dismisses it.
  const overviewShown = overviewOpen && !rightShown;
  const toggleOverview = () => {
    if (rightShown) setOverviewOverlay(!overviewOverlay);
    else setOverviewOpen(!overviewOpen);
  };
  const dismissOverlay = (e: React.MouseEvent) => {
    if (!overviewOverlay) return;
    const el = e.target as HTMLElement;
    if (el.closest("[data-overview-overlay]") || el.closest("[data-overview-toggle]")) return;
    setOverviewOverlay(false);
  };

  return (
    <div
      className={`relative flex h-screen overflow-hidden bg-canvas ${dragging ? "cursor-col-resize select-none" : ""}`}
      onMouseDownCapture={dismissOverlay}
    >
      {/* corner-pinned toggles — never move between states or during slides */}
      <IconButton
        active={sidebarOpen}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="absolute left-2 top-2 z-20"
      >
        <PanelLeftIcon />
      </IconButton>
      {rightShown && (
        <IconButton
          active={rightExpanded}
          onClick={() => setRightExpanded(!rightExpanded)}
          title={rightExpanded ? "Restore layout" : "Expand panel"}
          className="absolute right-10 top-2 z-20"
        >
          {rightExpanded ? <CollapseIcon /> : <ExpandIcon />}
        </IconButton>
      )}
      {onSkillPage && (
        <IconButton
          active={rightOpen}
          onClick={() => setRightOpen(!rightOpen)}
          title={rightOpen ? "Hide panel" : "Show panel"}
          className="absolute right-2 top-2 z-20"
        >
          <PanelRightIcon />
        </IconButton>
      )}

      {/* left sidebar — slides, resizable */}
      <aside
        className={`relative shrink-0 overflow-hidden border-border bg-paper ${
          left.dragging ? "" : "transition-[width] duration-200 ease-out"
        } ${sidebarOpen ? "border-r" : ""}`}
        style={{ width: sidebarOpen ? left.width : 0 }}
      >
        <div className="h-full" style={{ width: left.width }}>
          <Sidebar
            route={route}
            navigate={navigate}
            newProjectOpen={newProjectOpen}
            onNewProjectOpenChange={setNewProjectOpen}
          />
        </div>
        {sidebarOpen && (
          <div
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize hover:bg-amber-400/40"
            onMouseDown={left.onDragStart}
            title="Drag to resize"
          />
        )}
      </aside>

      {/* center column — hidden entirely while the right panel is expanded */}
      <div className={`relative flex min-w-[300px] flex-col ${expanded ? "hidden" : "flex-1"}`}>
        {route.name === "skill" && overviewOverlay && (
          <div data-overview-overlay className="absolute right-[10px] top-[54px] z-30">
            <OverviewCard slug={route.skillSlug} elevated />
          </div>
        )}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
          {!sidebarOpen && <span className="w-7 shrink-0" />}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            {(route.name === "skill" || route.name === "new-skill") && (
              <span className="shrink-0 whitespace-nowrap font-display text-sm text-ink-muted">{route.projectSlug} /</span>
            )}
            {/* long slugs truncate — the h-11 bar must never wrap or overflow */}
            <span className="truncate font-display text-sm" title={title}>{title}</span>
            {onSkillPage && <span className="text-ink-muted">···</span>}
          </div>
          {route.name === "skill" && <TopBarControls slug={route.skillSlug} pinned={route.version ?? CURRENT_DRAFT} onPin={(hash) => {
            const version = hash === CURRENT_DRAFT ? undefined : versionPin(hash);
            navigate(skillHref(route.projectSlug, route.skillSlug, route.tab, version));
          }} />}
          {onSkillPage && (
            <IconButton
              active={overviewShown || overviewOverlay}
              onClick={toggleOverview}
              title={overviewShown || overviewOverlay ? "Hide overview" : "Show overview"}
              data-overview-toggle
            >
              <OverviewIcon />
            </IconButton>
          )}
          {onSkillPage && !rightOpen && <span className="w-7 shrink-0" />}
        </header>
        <main className="relative flex-1 overflow-y-auto">
          {route.name === "board" && (
            <BoardView
              projectSlug={route.projectSlug}
              onOpenSkill={(project, slug) => navigate(skillHref(project.slug, slug))}
              onCreateProject={() => setNewProjectOpen(true)}
            />
          )}
          {route.name === "tasks" && route.projectSlug !== undefined && <TasksView />}
          {route.name === "tasks" && route.projectSlug === undefined && <p className="p-6 text-sm text-ink-muted">Register or repair a project to view its tasks.</p>}
          {route.name === "skill" && (
            <SkillView
              slug={route.skillSlug}
              pinned={route.version ?? CURRENT_DRAFT}
              tab={route.tab}
              onTabChange={(tab) => navigate(skillHref(route.projectSlug, route.skillSlug, tab, route.version))}
              tabHref={(tab) => skillHref(route.projectSlug, route.skillSlug, tab, route.version)}
              onStaleVersion={() => replace(skillHref(route.projectSlug, route.skillSlug, route.tab))}
              overviewOpen={overviewShown}
              onOpenFile={(path) => {
                setRightOpen(true);
                setFileRequest(path);
              }}
            />
          )}
          {route.name === "new-skill" && (
            <NewSkillLauncher
              key={route.projectSlug}
              project={route.projectSlug}
              onCreated={(slug, provider, message, model, effort) => {
                // The launcher disappears; the conversation continues in the
                // right panel (session started with this very message).
                setChatIntro({
                  slug,
                  projectSlug: route.projectSlug,
                  provider,
                  message,
                  ...(model !== undefined ? { model } : {}),
                  ...(effort !== undefined ? { effort } : {}),
                });
                navigate(skillHref(route.projectSlug, slug));
                setRightOpen(true);
              }}
              onAdopted={(slug) => navigate(skillHref(route.projectSlug, slug))}
            />
          )}
        </main>
      </div>

      {/* right panel — skill pages only; slides, resizable */}
      <aside
        className={`relative overflow-hidden border-border bg-paper ${
          right.dragging || expanded ? "" : "transition-[width] duration-200 ease-out"
        } ${rightShown ? "border-l" : ""} ${expanded ? "flex-1" : "shrink-0"}`}
        style={expanded ? undefined : { width: rightShown ? right.width : 0 }}
      >
        {rightShown && !expanded && (
          <div
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize hover:bg-amber-400/40"
            onMouseDown={right.onDragStart}
            title="Drag to resize"
          />
        )}
        <div className="h-full" style={expanded ? undefined : { width: right.width }}>
          {route.name === "skill" && (
            <RightPanel
              key={`${route.projectSlug}/${route.skillSlug}`}
              skill={route.skillSlug}
              width={expanded ? 9999 : right.width}
              fileRequest={fileRequest}
              onFileRequestHandled={() => setFileRequest(null)}
              intro={chatIntro !== null && chatIntro.projectSlug === route.projectSlug && chatIntro.slug === route.skillSlug ? chatIntro : null}
              onIntroConsumed={() => setChatIntro(null)}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
