/**
 * PROTOTYPE — the shell (fork pass, 2026-08-05).
 *
 * Ruling: stop building a parallel app. This is now a FORK of the real
 * shell (`next/NextShell.tsx`), importing the real components rather than
 * imitating them:
 *
 *   real  Sidebar          projects → skills spine, presence dots, task
 *                          count, the NewProjectDialog, and the theme
 *                          toggle — so DARK MODE works here exactly as it
 *                          does at /
 *   real  BoardView        the shipping stage ladder, unmodified
 *   real  RightPanel       the actual chat session, not a stub
 *   real  usePanelResize   drag-resizable panels, persisted to the same
 *                          localStorage keys
 *   real  api.ts           live `/api/*` data — the skills on screen are
 *                          the ones in your registry
 *
 * TWO CHANGES, and only two:
 *
 *   1. The center's skill page is the prototype's Overview instead of the
 *      four-tab SkillPageView.
 *   2. The right panel is chat only — `showFiles={false}`, a new prop on
 *      the real RightPanel that defaults to true, so `/` is untouched.
 *
 * Plus one ruling carried from earlier: no skill name in the top bar (the
 * sidebar already says it). The bar keeps the version pivot and Publish,
 * because those are controls, not a label.
 */
import { useState } from "react";
import { useProjectBootstrap } from "../runtime/useProjectBootstrap.ts";
import { usePanelResize } from "../next/hooks.ts";
import { CollapseIcon, ExpandIcon, PanelLeftIcon, PanelRightIcon } from "../next/icons.tsx";
import { RightPanel } from "../next/RightPanel.tsx";
import { Sidebar } from "../next/Sidebar.tsx";
import { IconButton } from "../next/ui.tsx";
import { useSkillPage } from "../next/views.tsx";
import { ProtoStatus } from "./Status.tsx";
import { TopBarSkillControls } from "../next/SkillPage.tsx";
import type { CenterView } from "../next/types.ts";
import { SkillPane } from "./Overview.tsx";
import { ProtoTasks } from "./Tasks.tsx";

/** Top-bar bridge — same shape as NextShell's, minus the breadcrumb. */
function TopBarControls({ slug, pinned, onPin }: { readonly slug: string; readonly pinned: string; readonly onPin: (v: string) => void }) {
  const page = useSkillPage(slug);
  return <TopBarSkillControls slug={slug} page={page} pinned={pinned} onPin={onPin} />;
}

export default function ProtoShell() {
  useProjectBootstrap();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [center, setCenter] = useState<CenterView>({ kind: "board" });
  const [pinned, setPinned] = useState<string>("current");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [rightExpanded, setRightExpanded] = useState(false);

  const left = usePanelResize("left", "sm-next-leftw", 256, 180, 440);
  const right = usePanelResize("right", "sm-next-rightw", 320, 240, () =>
    Math.max(340, window.innerWidth - 300 - (sidebarOpen ? left.width : 0)),
  );
  const dragging = left.dragging || right.dragging;

  const onSkillPage = center.kind === "skill";
  const rightShown = onSkillPage && rightOpen;
  const expanded = rightShown && rightExpanded;

  return (
    <div className={`relative flex h-screen overflow-hidden bg-canvas ${dragging ? "cursor-col-resize select-none" : ""}`}>
      {/* corner-pinned toggles — the real shell's, verbatim */}
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
          title={rightOpen ? "Hide chat" : "Show chat"}
          className="absolute right-2 top-2 z-20"
        >
          <PanelRightIcon />
        </IconButton>
      )}

      <aside
        className={`relative shrink-0 overflow-hidden border-border bg-paper ${
          left.dragging ? "" : "transition-[width] duration-200 ease-out"
        } ${sidebarOpen ? "border-r" : ""}`}
        style={{ width: sidebarOpen ? left.width : 0 }}
      >
        <div className="h-full" style={{ width: left.width }}>
          <Sidebar
            center={center}
            onNavigate={setCenter}
            newProjectOpen={newProjectOpen}
            onNewProjectOpenChange={setNewProjectOpen}
            boardLabel="Status"
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

      <div className={`relative flex min-w-[300px] flex-col ${expanded ? "hidden" : "flex-1"}`}>
        {/* The bar keeps its controls and loses its label: the skill's name
            is already in the sidebar, and was reading as a second title. */}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
          {!sidebarOpen && <span className="w-7 shrink-0" />}
          <span className="flex-1" />
          {center.kind === "skill" && <TopBarControls slug={center.slug} pinned={pinned} onPin={setPinned} />}
          {onSkillPage && !rightOpen && <span className="w-7 shrink-0" />}
        </header>

        <main className="relative flex-1 overflow-y-auto">
          {center.kind === "board" && (
            <ProtoStatus onOpenSkill={(project, slug) => setCenter({ kind: "skill", project: project.name, slug })} />
          )}
          {center.kind === "tasks" && (
            <ProtoTasks
              onOpenSkill={(project, slug) => setCenter({ kind: "skill", project: project.name, slug })}
            />
          )}
          {center.kind === "new-skill" && (
            <div className="p-6 text-sm text-ink-muted">The new-skill launcher is unchanged — not part of this prototype.</div>
          )}
          {center.kind === "skill" && <SkillPane key={center.slug} slug={center.slug} />}
        </main>
      </div>

      {/* right panel — the REAL one, with its Files tab suppressed */}
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
          {onSkillPage && <RightPanel skill={center.slug} width={expanded ? 9999 : right.width} showFiles={false} />}
        </div>
      </aside>
    </div>
  );
}
