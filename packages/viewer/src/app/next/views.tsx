/** Center-column views: Board, Tasks, and the Skill page. */
import { useCallback } from "react";
import { fetchProjects, fetchSkillPage, fetchTasks, useApiData, useApiStatus } from "./api.ts";
import { PROJECTS, SKILL_PAGE, TASKS } from "./data.ts";
import { SkillPageView } from "./SkillPage.tsx";
import { STAGES } from "./types.ts";
import { Button, FADE_R, STAGE_TINT } from "./ui.tsx";
import type { Project, SkillPage } from "./types.ts";

/** One fetch per skill page, shared by content, overview column, and overlay. */
export function useSkillPage(slug: string): SkillPage {
  const fetcher = useCallback(() => fetchSkillPage(slug), [slug]);
  return useApiData(fetcher, SKILL_PAGE);
}

export function BoardView({
  onOpenSkill,
  onCreateProject,
}: {
  readonly onOpenSkill: (project: Project, slug: string) => void;
  /** Opens the shell's New-project dialog (the Sidebar's own). */
  readonly onCreateProject: () => void;
}) {
  // "all" scope: the Board renders every project, so any project's journal
  // append (new skill, stage change) refreshes it -- not just the active one.
  const { data, status } = useApiStatus(fetchProjects, { scope: "all" });
  const projects = data ?? PROJECTS;

  // First-run welcome (e2e-readiness blocker): a LIVE server with an EMPTY
  // registry renders a centered next action, not five empty stage columns.
  // Serverless astro dev (status "error") keeps the placeholder board.
  if (status === "live" && projects.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="pb-16 text-center">
          <h1 className="pb-2 font-display text-2xl">Welcome to Skillmaker Studio</h1>
          <p className="pb-5 text-sm text-ink-muted">
            Register a project — a directory where your skills will live — and start your first skill.
          </p>
          <button
            type="button"
            className="cursor-pointer rounded bg-amber-600 px-4 py-2 font-display text-sm text-white shadow hover:bg-amber-700"
            onClick={onCreateProject}
          >
            Create your first project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Board</h1>
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded border border-border bg-paper p-2">
            <div className={`mb-2 inline-block rounded px-2 py-0.5 font-display text-xs ${STAGE_TINT[stage]}`}>{stage}</div>
            {projects.flatMap((p) =>
              p.skills
                .filter((s) => s.stage === stage)
                .map((s) => (
                  <button
                    key={`${p.name}/${s.slug}`}
                    type="button"
                    onClick={() => onOpenSkill(p, s.slug)}
                    className="mb-2 block w-full rounded bg-surface p-2 text-left shadow-sm hover:shadow"
                  >
                    <div className={`font-display text-sm ${FADE_R}`}>{s.slug}</div>
                    <div className={`text-xs text-ink-muted ${FADE_R}`}>{p.name}</div>
                  </button>
                )),
            )}
          </div>
        ))}
      </div>
      <p className="pt-3 text-xs text-ink-muted">All projects · Archived: drawer</p>
    </div>
  );
}

export function TasksView() {
  const { data, status } = useApiStatus(fetchTasks);
  const tasks = data ?? TASKS;
  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Tasks</h1>
      {status !== "loading" && tasks.length === 0 && (
        <p className="text-sm text-ink-muted">No open tasks.</p>
      )}
      <div className="max-w-2xl space-y-2">
        {tasks.map((t) => (
          <div key={t.title} className="flex items-center justify-between rounded border border-border bg-surface p-3 shadow-sm">
            <div className="min-w-0">
              <div className={`text-sm ${FADE_R}`}>{t.title}</div>
              <div className="text-xs text-ink-muted">{t.origin}</div>
            </div>
            <Button label={t.state === "open" ? "Start" : "In progress"} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewCard({ slug, elevated }: { readonly slug: string; readonly elevated?: boolean }) {
  const page = useSkillPage(slug);
  return (
    <div className={`w-56 rounded border border-border bg-surface p-3 text-sm ${elevated ? "shadow-xl" : "shadow-md"}`}>
      <div className="flex justify-between"><span className="text-ink-muted">Stage</span><span className={`rounded px-1.5 text-xs ${STAGE_TINT[page.stage]}`}>{page.stage}</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Version</span><span className="font-mono text-xs">{page.versionShort ?? "none"}</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Drift</span><span className="text-xs">{page.drift}</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Proven on</span><span className="text-xs">{page.provenOn}</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Coverage</span><span className="text-xs">{page.coverage}</span></div>
    </div>
  );
}

/**
 * The Skill page: content column + the overview column, which occupies
 * layout space and slides/grows in from the right (content slides over).
 */
export function SkillView({
  slug,
  pinned,
  overviewOpen,
  onOpenFile,
}: {
  readonly slug: string;
  readonly pinned: string;
  readonly overviewOpen: boolean;
  readonly onOpenFile: (path: string) => void;
}) {
  const page = useSkillPage(slug);
  // The overview card FLOATS OVER the page (z-10) so the full-bleed tab
  // surface and its separator run beneath it uninterrupted; the content
  // makes room via right padding, not a layout column that would notch
  // the surface.
  return (
    <div className="relative flex min-h-full">
      <div className="min-w-0 flex-1">
        <SkillPageView slug={slug} page={page} pinned={pinned} onOpenFile={onOpenFile} rightInset={overviewOpen} />
      </div>
      {overviewOpen && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[244px]">
          <div className="pointer-events-auto sticky top-[10px] mr-[10px] mt-[10px]">
            <OverviewCard slug={slug} />
          </div>
        </div>
      )}
    </div>
  );
}
