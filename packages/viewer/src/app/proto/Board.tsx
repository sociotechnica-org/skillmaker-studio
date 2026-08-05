/**
 * PROTOTYPE — the Board (naming pass, 2026-08-05).
 *
 * A fork of `next/views.tsx` BoardView. Same data, same grid, same cards —
 * the only change is what the columns SAY, and it's the point of the pass:
 *
 *   before   a stage chip:  Idea · Research · Drafting · Evals · Published
 *   after    a station:     the making-act, the question it answers, and
 *                           the file that comes out of it
 *
 * That third line is the chain made visible. `stations.json` already says
 * `produces: ["design.md", "output/SKILL.md"]` per station; the Board has
 * simply never shown it, so a column read as "a bucket cards sit in"
 * instead of "a bench where a named thing gets made".
 *
 * Held deliberately: the columns still track the same wire stages, so a
 * card is in the same place it was. This is a vocabulary change, not a
 * workflow change.
 */
import { fetchProjects, useApiStatus } from "../next/api.ts";
import { FADE_R, STAGE_TINT } from "../next/ui.tsx";
import type { Project, Stage } from "../next/types.ts";
import { MODE_LABEL, STATIONS } from "./stations.ts";

/** The prototype's station name -> the display `Stage` the wire maps onto. */
const STAGE_OF: Record<string, Stage> = {
  idea: "Idea",
  researching: "Research",
  drafting: "Drafting",
  evaluating: "Evals",
  published: "Published",
};

export function ProtoBoard({
  onOpenSkill,
  onCreateProject,
}: {
  readonly onOpenSkill: (project: Project, slug: string) => void;
  readonly onCreateProject: () => void;
}) {
  const { data, status } = useApiStatus(fetchProjects, { scope: "all" });
  const projects = data ?? [];

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
      <h1 className="font-display text-2xl">Making</h1>
      <p className="pb-4 pt-1 text-sm text-ink-muted">
        Five benches. Each answers a question and leaves a file behind — but only three of them are benches we work at.
        The last two are things other tools do, that this one has to stay on top of.
      </p>

      <div className="grid grid-cols-5 gap-3">
        {STATIONS.map((station) => {
          const stage = STAGE_OF[station.wire] ?? "Idea";
          const cards = projects.flatMap((p) => p.skills.filter((s) => s.stage === stage).map((s) => ({ p, s })));
          return (
            <div
              key={station.wire}
              className={`rounded p-2 ${
                station.mode === "made-here"
                  ? "border border-border bg-paper"
                  : "border border-dashed border-border bg-paper/40"
              }`}
            >
              <div className={`mb-1 inline-block rounded px-2 py-0.5 font-display text-xs ${STAGE_TINT[stage]}`}>
                {station.name}
              </div>
              {/* the lines that turn a bucket into a bench */}
              <p className="pb-0.5 text-[12px] leading-snug text-ink">{station.question}</p>
              <p className="text-[11px] leading-snug text-ink-muted">
                makes <span className="[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">{station.makes}</span>
              </p>
              {/* the honest bit: whose hands do the work */}
              <p
                className={`pb-2 pt-1 text-[10px] uppercase tracking-[0.1em] ${
                  station.mode === "made-here" ? "text-ink-muted/60" : "text-amber-700/80"
                }`}
              >
                {MODE_LABEL[station.mode]}
              </p>

              {cards.map(({ p, s }) => (
                <button
                  key={`${p.name}/${s.slug}`}
                  type="button"
                  onClick={() => onOpenSkill(p, s.slug)}
                  className="mb-2 block w-full rounded bg-surface p-2 text-left shadow-sm hover:shadow"
                >
                  <div className={`font-display text-sm ${FADE_R}`}>{s.slug}</div>
                  <div className={`text-xs text-ink-muted ${FADE_R}`}>{p.name}</div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <p className="pt-3 text-xs text-ink-muted">All projects · Archived: drawer</p>
    </div>
  );
}
