/** Left sidebar: global views (Board, Tasks) + the Projects → skills spine. */
import { useCallback, useEffect, useState } from "react";
import { useActiveProject } from "../runtime/projectScope.ts";
import { fetchTasks, useApiData } from "./api.ts";
import { PROJECTS, TASKS } from "./data.ts";
import { BoardIcon, ChevronIcon, GitHubIcon, HelpIcon, MoonIcon, PlusIcon, SunIcon, TasksIcon } from "./icons.tsx";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import { useJournalTick } from "./liveRefresh.ts";
import { presenceKey, usePresence } from "./presence.ts";
import { fetchProjects } from "./projectsApi.ts";
import { applyTheme, currentTheme, type Theme } from "./theme.ts";
import { FADE_R, IconButton, StageBadge } from "./ui.tsx";
import { boardHref, newSkillHref, skillHref, tasksHref, type StudioRoute } from "./router.tsx";
import type { Project } from "./types.ts";

const VISIBLE_SKILLS = 5;

export function Sidebar({
  route,
  navigate,
  newProjectOpen,
  onNewProjectOpenChange,
}: {
  readonly route: StudioRoute;
  readonly navigate: (href: string) => void;
  /** Dialog open state lives in the shell so the Board's empty-registry welcome can open the SAME dialog. */
  readonly newProjectOpen: boolean;
  readonly onNewProjectOpenChange: (open: boolean) => void;
}) {
  // Placeholder until the live fetch lands; astro dev without the API keeps
  // rendering data.ts's PROJECTS (fetchProjects resolves null there).
  const [projects, setProjects] = useState<ReadonlyArray<Project>>(PROJECTS);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PROJECTS.map((p) => [p.name, true])),
  );
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const activeProject = useActiveProject();
  const tasks = useApiData(fetchTasks, TASKS);
  const openTaskCount = tasks.filter((t) => t.state === "open").length;

  // Presence sweep, bounded to the rows actually on screen: open projects'
  // visible skills only (presence.ts documents the cost discipline).
  const visibleSkills = projects.flatMap((project) =>
    (openProjects[project.name] ?? false)
      ? ((showAll[project.name] ?? false) ? project.skills : project.skills.slice(0, VISIBLE_SKILLS)).map(
          (skill) => ({ project: project.slug, slug: skill.slug }),
        )
      : [],
  );
  const runningSkills = usePresence(visibleSkills);

  const loadProjects = useCallback(() => {
    let cancelled = false;
    void fetchProjects().then((live) => {
      // `null` = server absent: keep whatever is on screen (placeholders).
      // An EMPTY live registry is honest data -- render it empty.
      if (cancelled || live === null) return;
      setProjects(live);
      // New projects start expanded; projects already on screen keep the
      // user's open/closed toggle across refreshes.
      setOpenProjects((current) =>
        Object.fromEntries(live.map((p) => [p.name, current[p.name] ?? true])),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refetch on journal ticks from ANY project ("all" scope): a skill
  // created in a chat session appears under its project without a reload
  // (e2e-readiness log, parked-high). First run happens on mount (tick 0).
  const tick = useJournalTick("all");
  useEffect(() => loadProjects(), [loadProjects, tick]);

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
          active={route.name === "board" && route.projectSlug === undefined}
          href={boardHref()}
          navigate={navigate}
        />
        <NavItem
          label="Tasks"
          icon={<TasksIcon />}
          active={route.name === "tasks"}
          badge={openTaskCount}
          href={tasksHref(route.name === "tasks" ? route.projectSlug : activeProject ?? undefined)}
          navigate={navigate}
        />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-2">
        <div className="group flex items-center pb-1 pl-3 pr-1">
          <span className="flex-1 text-xs uppercase tracking-widest text-ink-muted">Projects</span>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
            title="New project (register a directory)"
            onClick={() => onNewProjectOpenChange(true)}
          >
            <PlusIcon />
          </button>
        </div>
        {projects.map((project) => (
          <ProjectSection
            key={project.slug}
            project={project}
            active={route.name !== "invalid" && "projectSlug" in route && route.projectSlug === project.slug}
            open={openProjects[project.name] ?? false}
            expanded={showAll[project.name] ?? false}
            route={route}
            running={runningSkills}
            onToggle={() => {
              navigate(boardHref(project.slug));
              setOpenProjects({ ...openProjects, [project.name]: !(openProjects[project.name] ?? false) });
            }}
            onToggleExpanded={() => setShowAll({ ...showAll, [project.name]: !(showAll[project.name] ?? false) })}
            onOpenSkill={(slug) => {
              navigate(skillHref(project.slug, slug));
            }}
            onNewSkill={() => {
              navigate(newSkillHref(project.slug));
            }}
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
        <ThemeToggle />
      </div>

      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => onNewProjectOpenChange(false)}
          onRegistered={(slug) => {
            if (slug !== null) {
              // A just-registered project is empty (or newly adopted): land
              // on its New-skill page so the next step is obvious.
              navigate(newSkillHref(slug));
            }
            loadProjects();
          }}
        />
      )}
    </div>
  );
}

/** Sun/moon switch between the parchment and the manuscript at night.
 * The pre-paint script in index.astro applied the saved/OS theme already;
 * we read the DOM after mount (SSR renders neither icon confidently). */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(currentTheme());
  }, []);
  if (theme === null) return <span className="h-7 w-7" />;
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <IconButton
      title={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

function NavItem({
  label,
  icon,
  active,
  badge,
  href,
  navigate,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly active: boolean;
  readonly badge?: number;
  readonly href: string;
  readonly navigate: (href: string) => void;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
      className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left font-display text-sm ${
        active ? "bg-surface shadow-sm" : "text-ink-muted hover:bg-surface/60"
      }`}
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-amber-200 px-2 text-xs">{badge}</span> : null}
    </a>
  );
}

function ProjectSection({
  project,
  active,
  open,
  expanded,
  route,
  running,
  onToggle,
  onToggleExpanded,
  onOpenSkill,
  onNewSkill,
}: {
  readonly project: Project;
  /** True when this is the ACTIVE project -- the one every center view + right panel is scoped to. */
  readonly active: boolean;
  readonly open: boolean;
  readonly expanded: boolean;
  readonly route: StudioRoute;
  /** Project-qualified skills with something running right now (presence sweep). */
  readonly running: ReadonlySet<string>;
  readonly onToggle: () => void;
  readonly onToggleExpanded: () => void;
  readonly onOpenSkill: (slug: string) => void;
  readonly onNewSkill: () => void;
}) {
  const visible = expanded ? project.skills : project.skills.slice(0, VISIBLE_SKILLS);
  const hidden = project.skills.length - VISIBLE_SKILLS;

  return (
    <div className="mb-1">
      <div className={`group flex items-center rounded pr-1 hover:bg-surface/60 ${active ? "bg-surface shadow-sm" : ""}`}>
        <a
          href={boardHref(project.slug)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onToggle();
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-left font-display text-sm"
          title={project.error !== undefined ? `${project.path} — ${project.error}` : project.path}
        >
          <span className="shrink-0 text-ink-muted">
            <ChevronIcon open={open} />
          </span>
          <span className={`min-w-0 flex-1 ${FADE_R} ${project.ok === false ? "text-ink-muted line-through" : ""}`}>
            {project.name}
          </span>
          {/* A registered directory that is missing/broken: reported, never hidden. */}
          {project.ok === false && (
            <span className="shrink-0 rounded bg-red-200 px-1.5 text-[10px] text-red-900" title={project.error}>
              broken
            </span>
          )}
        </a>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          title="New skill · import"
          onClick={onNewSkill}
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
            const active = route.name === "skill" && route.projectSlug === project.slug && route.skillSlug === skill.slug;
            return (
              <a
                key={skill.slug}
                href={skillHref(project.slug, skill.slug)}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onOpenSkill(skill.slug);
                }}
                className={`flex w-full items-center gap-2 rounded py-1 pl-8 pr-2 text-left text-sm ${
                  active ? "bg-surface shadow-sm" : "text-ink-muted hover:bg-surface/60"
                }`}
              >
                <span className={`min-w-0 flex-1 ${FADE_R}`}>{skill.slug}</span>
                {/* attention dot: the bundle awaits review (subtle, left of the badge) */}
                {skill.awaitingReview === true && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Awaiting review" />
                )}
                <StageBadge stage={skill.stage} />
                {/* row-right spinner: an active run or a chat turn in flight */}
                {running.has(presenceKey({ project: project.slug, slug: skill.slug })) && (
                  <span
                    className="h-3 w-3 shrink-0 animate-spin rounded-full border border-amber-500 border-t-transparent"
                    title="Running"
                  />
                )}
              </a>
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
