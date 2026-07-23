/** Center-column views: Board, Tasks, and the Skill page. */
import { useCallback, useState } from "react";
import { MarkdownContent } from "../components/Markdown.tsx";
import { fetchProjects, fetchSkillPage, fetchTasks, useApiData, useApiStatus } from "./api.ts";
import { PROJECTS, SKILL_PAGE, TASKS } from "./data.ts";
import { STAGES } from "./types.ts";
import { Button, CLAIM_DOT, FADE_R, STAGE_TINT } from "./ui.tsx";
import type { SkillPage } from "./types.ts";

/** One fetch per skill page, shared by content, overview column, and overlay. */
export function useSkillPage(slug: string): SkillPage {
  const fetcher = useCallback(() => fetchSkillPage(slug), [slug]);
  return useApiData(fetcher, SKILL_PAGE);
}

export function BoardView({ onOpenSkill }: { readonly onOpenSkill: (project: string, slug: string) => void }) {
  const projects = useApiData(fetchProjects, PROJECTS);
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
                    onClick={() => onOpenSkill(p.name, s.slug)}
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
  // Placeholders only when the server is absent — never flash them at a
  // live server that's about to answer (possibly with an empty list).
  const tasks = status === "error" ? TASKS : (data ?? []);
  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Tasks</h1>
      {status === "live" && tasks.length === 0 && (
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
export function SkillView({ slug, overviewOpen }: { readonly slug: string; readonly overviewOpen: boolean }) {
  const page = useSkillPage(slug);
  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl p-6">
          <SkillContent page={page} />
        </div>
      </div>
      <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${overviewOpen ? "w-[244px]" : "w-0"}`}>
        <div className="sticky top-0 mr-[10px] mt-[10px]">
          <OverviewCard slug={slug} />
        </div>
      </div>
    </div>
  );
}

function SkillContent({ page }: { readonly page: SkillPage }) {
  const [tab, setTab] = useState<"instructions" | "evals">("instructions");
  return (
    <>
      {/* center tab selector — pill for active, quiet text for the rest */}
      <div className="flex items-center gap-1 pb-4">
        {(
          [
            { id: "instructions", label: "Instructions" },
            { id: "evals", label: "Evals" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1 font-display text-sm ${
              tab === t.id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "instructions" && (
      <section>
        <div className="mt-1 rounded border border-border bg-surface p-3 text-sm shadow-sm">
          {page.instructions === null ? (
            <p className="text-ink-muted">No SKILL.md yet.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <MarkdownContent markdown={page.instructions} />
            </div>
          )}
          <div className="pt-2"><Button label="Open in Files" /></div>
        </div>
      </section>
      )}

      {tab === "evals" && (
      <section>
        <div className="flex items-center justify-end">
          <div className="flex gap-2">
            <Button label="New claim" />
            <Button label="Run all fixtures" primary />
          </div>
        </div>
        <div className="mt-1 space-y-1">
          {page.claims.map((c) => (
            <div key={c.id} className="rounded border border-border bg-surface px-3 py-2 shadow-sm">
              <div className="flex items-center gap-2 text-sm">
                <span title={c.status}>{CLAIM_DOT[c.status]}</span>
                <span className="flex-1">{c.sentence}</span>
                <span className="font-mono text-[10px] text-ink-muted">{c.id}</span>
                <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-ink-muted">{c.status}</span>
              </div>
              <div className="pl-6 text-xs text-ink-muted">
                {c.fixtures > 0 ? (
                  `${c.fixtures} fixture · expand ▸`
                ) : (
                  <button type="button" className="underline hover:text-ink" title="Mints a task">
                    no fixture — add to Tasks
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      <section className="pt-5">
        <h2 className="font-display text-lg text-ink-muted">Activity</h2>
        <div className="mt-1 rounded border border-border bg-surface p-3 text-xs text-ink-muted shadow-sm">
          {page.events.map((e, i) => (
            <span key={`${e.type}-${i}`}>
              {i > 0 && " — "}
              {e.type} · {e.at}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}
