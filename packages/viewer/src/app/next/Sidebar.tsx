/** Left sidebar: global views (Board, Tasks) + the Projects → skills spine. */
import { useState } from "react";
import { fetchTasks, useApiData } from "./api.ts";
import { PROJECTS, TASKS } from "./data.ts";
import { BoardIcon, ChevronIcon, GitHubIcon, HelpIcon, PlusIcon, TasksIcon } from "./icons.tsx";
import { FADE_R, StageBadge } from "./ui.tsx";
import type { CenterView } from "./types.ts";

const VISIBLE_SKILLS = 5;

export function Sidebar({
  center,
  onNavigate,
}: {
  readonly center: CenterView;
  readonly onNavigate: (view: CenterView) => void;
}) {
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PROJECTS.map((p) => [p.name, true])),
  );
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const tasks = useApiData(fetchTasks, TASKS);
  const openTaskCount = tasks.filter((t) => t.state === "open").length;

  return (
    <div className="flex h-full flex-col">
      {/* implied top section — no bottom border; the fixed corner toggle
          overlays this row, wordmark sits on the line beneath */}
      <div className="h-11 shrink-0" />
      <div className="px-4 pb-2">
        <span className="font-display text-lg tracking-tight">SKILLMAKER STUDIO</span>
      </div>

      <nav className="px-2">
        <NavItem
          label="Board"
          icon={<BoardIcon />}
          active={center.kind === "board"}
          onClick={() => onNavigate({ kind: "board" })}
        />
        <NavItem
          label="Tasks"
          icon={<TasksIcon />}
          active={center.kind === "tasks"}
          badge={openTaskCount}
          onClick={() => onNavigate({ kind: "tasks" })}
        />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-2">
        <div className="group flex items-center pb-1 pl-3 pr-1">
          <span className="flex-1 text-xs uppercase tracking-widest text-ink-muted">Projects</span>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
            title="Register a project directory"
          >
            <PlusIcon />
          </button>
        </div>
        {PROJECTS.map((project) => (
          <ProjectSection
            key={project.name}
            project={project}
            open={openProjects[project.name] ?? false}
            expanded={showAll[project.name] ?? false}
            center={center}
            onToggle={() => setOpenProjects({ ...openProjects, [project.name]: !(openProjects[project.name] ?? false) })}
            onToggleExpanded={() => setShowAll({ ...showAll, [project.name]: !(showAll[project.name] ?? false) })}
            onOpenSkill={(slug) => onNavigate({ kind: "skill", project: project.name, slug })}
          />
        ))}
      </div>

      <div className="flex items-center gap-1 border-t border-border px-3 py-2">
        <a
          href="https://github.com/sociotechnica-org/skillmaker-studio"
          target="_blank"
          rel="noreferrer"
          className="rounded p-1.5 text-ink-muted hover:bg-surface hover:text-ink"
          title="GitHub"
        >
          <GitHubIcon />
        </a>
        <a href="#" className="rounded p-1.5 text-ink-muted hover:bg-surface hover:text-ink" title="Docs">
          <HelpIcon />
        </a>
      </div>
    </div>
  );
}

function NavItem({
  label,
  icon,
  active,
  badge,
  onClick,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly active: boolean;
  readonly badge?: number;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left font-display text-sm ${
        active ? "bg-surface shadow-sm" : "text-ink-muted hover:bg-surface/60"
      }`}
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-amber-200 px-2 text-xs">{badge}</span> : null}
    </button>
  );
}

function ProjectSection({
  project,
  open,
  expanded,
  center,
  onToggle,
  onToggleExpanded,
  onOpenSkill,
}: {
  readonly project: (typeof PROJECTS)[number];
  readonly open: boolean;
  readonly expanded: boolean;
  readonly center: CenterView;
  readonly onToggle: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenSkill: (slug: string) => void;
}) {
  const visible = expanded ? project.skills : project.skills.slice(0, VISIBLE_SKILLS);
  const hidden = project.skills.length - VISIBLE_SKILLS;

  return (
    <div className="mb-1">
      <div className="group flex items-center rounded pr-1 hover:bg-surface/60">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-left font-display text-sm"
          title={project.path}
        >
          <span className="shrink-0 text-ink-muted">
            <ChevronIcon open={open} />
          </span>
          <span className={`min-w-0 flex-1 ${FADE_R}`}>{project.name}</span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          title="New skill · import"
        >
          <PlusIcon />
        </button>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-150 ease-out ${
          open ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {visible.map((skill) => {
            const active = center.kind === "skill" && center.project === project.name && center.slug === skill.slug;
            return (
              <button
                key={skill.slug}
                type="button"
                onClick={() => onOpenSkill(skill.slug)}
                className={`flex w-full items-center gap-2 rounded py-1 pl-8 pr-2 text-left text-sm ${
                  active ? "bg-surface shadow-sm" : "text-ink-muted hover:bg-surface/60"
                }`}
              >
                <span className={`min-w-0 flex-1 ${FADE_R}`}>{skill.slug}</span>
                <StageBadge stage={skill.stage} />
              </button>
            );
          })}
          {hidden > 0 && (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="py-0.5 pl-8 text-left text-xs text-ink-muted hover:text-ink"
            >
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
