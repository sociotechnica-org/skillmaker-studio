/**
 * The next shell (IA doc §B, ruled 2026-07-22): one app, many projects,
 * skill at the center. Layout rules encoded here:
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
import { useState } from "react";
import { usePanelResize } from "./hooks.ts";
import { CollapseIcon, ExpandIcon, OverviewIcon, PanelLeftIcon, PanelRightIcon } from "./icons.tsx";
import { RightPanel } from "./RightPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { IconButton } from "./ui.tsx";
import { BoardView, OverviewCard, SkillView, TasksView } from "./views.tsx";
import type { CenterView } from "./types.ts";

export default function NextShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [center, setCenter] = useState<CenterView>({ kind: "skill", project: "skills", slug: "to-tickets" });
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [overviewOverlay, setOverviewOverlay] = useState(false);

  const left = usePanelResize("left", "sm-next-leftw", 256, 180, 440);
  const right = usePanelResize("right", "sm-next-rightw", 320, 240, 560);
  const dragging = left.dragging || right.dragging;

  const [rightExpanded, setRightExpanded] = useState(false);
  const onSkillPage = center.kind === "skill";
  const rightShown = onSkillPage && rightOpen;
  const expanded = rightShown && rightExpanded;
  const title = center.kind === "board" ? "Board" : center.kind === "tasks" ? "Tasks" : center.slug;

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
          <Sidebar center={center} onNavigate={setCenter} />
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
      <div className={`relative flex min-w-0 flex-col ${expanded ? "hidden" : "flex-1"}`}>
        {onSkillPage && overviewOverlay && (
          <div data-overview-overlay className="absolute right-[10px] top-[54px] z-30">
            <OverviewCard elevated />
          </div>
        )}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
          {!sidebarOpen && <span className="w-7 shrink-0" />}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            {center.kind === "skill" && <span className="font-display text-sm text-ink-muted">{center.project} /</span>}
            <span className="font-display text-sm">{title}</span>
            {onSkillPage && <span className="text-ink-muted">···</span>}
          </div>
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
          {center.kind === "board" && <BoardView onOpenSkill={(project, slug) => setCenter({ kind: "skill", project, slug })} />}
          {center.kind === "tasks" && <TasksView />}
          {center.kind === "skill" && <SkillView overviewOpen={overviewShown} />}
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
          {onSkillPage && <RightPanel skill={center.slug} width={expanded ? 9999 : right.width} />}
        </div>
      </aside>
    </div>
  );
}
