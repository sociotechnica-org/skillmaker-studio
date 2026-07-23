/** Center-column views: Board, Tasks, and the Skill page. */
import { CLAIMS, PROJECTS, TASKS } from "./data.ts";
import { STAGES } from "./types.ts";
import { Button, CLAIM_DOT, FADE_R, STAGE_TINT } from "./ui.tsx";

export function BoardView({ onOpenSkill }: { readonly onOpenSkill: (project: string, slug: string) => void }) {
  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Board</h1>
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded border border-border bg-paper p-2">
            <div className={`mb-2 inline-block rounded px-2 py-0.5 font-display text-xs ${STAGE_TINT[stage]}`}>{stage}</div>
            {PROJECTS.flatMap((p) =>
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
  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Tasks</h1>
      <div className="max-w-2xl space-y-2">
        {TASKS.map((t) => (
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

export function OverviewCard({ elevated }: { readonly elevated?: boolean }) {
  return (
    <div className={`w-56 rounded border border-border bg-surface p-3 text-sm ${elevated ? "shadow-xl" : "shadow-md"}`}>
      <div className="flex justify-between"><span className="text-ink-muted">Stage</span><span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">Evals</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Version</span><span className="font-mono text-xs">811e4580</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Drift</span><span className="text-xs">in sync</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Proven on</span><span className="text-xs">Opus 4.6 (1 claim)</span></div>
      <div className="flex justify-between pt-1"><span className="text-ink-muted">Coverage</span><span className="text-xs">2 of 5 claims</span></div>
      <div className="pt-2"><Button label="Publish this version" primary /></div>
    </div>
  );
}

/**
 * The Skill page: content column + the overview column, which occupies
 * layout space and slides/grows in from the right (content slides over).
 */
export function SkillView({ overviewOpen }: { readonly overviewOpen: boolean }) {
  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl p-6">
          <SkillContent />
        </div>
      </div>
      <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${overviewOpen ? "w-[244px]" : "w-0"}`}>
        <div className="sticky top-0 mr-[10px] mt-[10px]">
          <OverviewCard />
        </div>
      </div>
    </div>
  );
}

function SkillContent() {
  return (
    <>
      <section>
        <h2 className="font-display text-lg text-ink-muted">Instructions</h2>
        <div className="mt-1 rounded border border-border bg-surface p-3 text-sm shadow-sm">
          <p className="text-ink-muted">Live SKILL.md, rendered.</p>
          <p className="pt-1">Decompose an already-decided scope into vertical-slice implementation tickets…</p>
          <div className="pt-2"><Button label="Open in Files" /></div>
        </div>
      </section>

      <section className="pt-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-ink-muted">Evals</h2>
          <div className="flex gap-2">
            <Button label="New claim" />
            <Button label="Run all fixtures" primary />
          </div>
        </div>
        <div className="mt-1 space-y-1">
          {CLAIMS.map((c) => (
            <div key={c.id} className="rounded border border-border bg-surface px-3 py-2 shadow-sm">
              <div className="flex items-center gap-2 text-sm">
                <span title={c.status}>{CLAIM_DOT[c.status]}</span>
                <span className="flex-1">{c.sentence}</span>
                <span className="font-mono text-[10px] text-ink-muted">{c.id}</span>
                <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-ink-muted">Opus 4.6: {c.status}</span>
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

      <section className="pt-5">
        <h2 className="font-display text-lg text-ink-muted">Activity</h2>
        <div className="mt-1 rounded border border-border bg-surface p-3 text-xs text-ink-muted shadow-sm">
          run.graded Pass · yesterday — station drafting completed · 2d ago — bundle.created · 2d ago
        </div>
      </section>
    </>
  );
}
