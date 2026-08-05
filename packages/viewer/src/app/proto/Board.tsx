/**
 * PROTOTYPE — the Board (pieces pass, 2026-08-05).
 *
 * The five equal columns are gone, because a skill does not have five
 * equal parts. It has four, in two groups of two, plus a status layer that
 * was never a column at all:
 *
 *   ┌ What it is ─────────────┐      ┌ What goes out ──────────┐
 *   │   Job        Method     │  ──▶ │   Prompt       Evals    │
 *   │   stays here, informs   │      │   leaves, runs elsewhere│
 *   └─────────────────────────┘      └─────────────────────────┘
 *                                     └ Release: what's true of
 *                                       the two that left
 *
 * The arrow is load-bearing: Job and Method don't go anywhere, they INFORM
 * the two that do. Colour carries the same fact — teal for the pieces that
 * stay, gold for the pieces that leave — so the asymmetry is readable
 * before a word is.
 *
 * CONSEQUENCE worth ruling on: `published` no longer has a column, so a
 * published skill's card sits under Prompt wearing a "live" mark. That
 * follows from "publish isn't a piece", but it moves cards, which makes it
 * more than a rename. Flagged rather than assumed.
 */
import { fetchProjects, useApiStatus } from "../next/api.ts";
import { FADE_R } from "../next/ui.tsx";
import type { Project, Stage } from "../next/types.ts";
import { GROUP_EDGE, GROUP_LABEL, GROUP_TINT, GROUP_TITLE, PIECES, RELEASE, type Group, type Piece } from "./pieces.ts";

/** The display `Stage` each wire literal maps onto in the real app's types. */
const STAGE_OF: Record<string, Stage> = {
  idea: "Idea",
  researching: "Research",
  drafting: "Drafting",
  evaluating: "Evals",
  published: "Published",
};

type Card = { readonly project: Project; readonly slug: string; readonly live: boolean };

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

  /** Cards for a piece. Published skills fold into Prompt, marked live. */
  const cardsFor = (piece: Piece): ReadonlyArray<Card> => {
    const stage = STAGE_OF[piece.wire] ?? "Idea";
    const own = projects.flatMap((project) =>
      project.skills.filter((s) => s.stage === stage).map((s) => ({ project, slug: s.slug, live: false })),
    );
    if (piece.wire !== "drafting") return own;
    const live = projects.flatMap((project) =>
      project.skills.filter((s) => s.stage === "Published").map((s) => ({ project, slug: s.slug, live: true })),
    );
    return [...own, ...live];
  };

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl">The skill</h1>
      <p className="max-w-3xl pb-5 pt-1 text-sm leading-relaxed text-ink-muted">
        Four pieces. Two of them stay here and inform the other two; two of them leave and run somewhere else.
      </p>

      <div className="flex flex-wrap items-stretch gap-3">
        <GroupBox group="informs" cardsFor={cardsFor} onOpenSkill={onOpenSkill} />

        {/* the arrow is the claim: the first two feed the second two */}
        <div className="flex items-center px-1 text-2xl text-ink-muted/50" aria-hidden="true">
          ▶
        </div>

        <GroupBox group="ships" cardsFor={cardsFor} onOpenSkill={onOpenSkill} />
      </div>

      {/* Release — a status layer over the pieces that left, not a column */}
      <div className="mt-3 max-w-3xl rounded border border-dashed border-border bg-paper/40 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-sm">{RELEASE.name}</span>
          <span className="text-[12px] text-ink-muted">{RELEASE.is}</span>
        </div>
        <ul className="flex flex-col gap-1 pt-2">
          {RELEASE.asks.map((q) => (
            <li key={q} className="flex items-baseline gap-2 text-[13px] text-ink">
              <span className="text-ink-muted/50">?</span>
              {q}
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[12px] leading-snug text-amber-700">{RELEASE.unresolved}</p>
      </div>

      <p className="pt-4 text-xs text-ink-muted">All projects · Archived: drawer</p>
    </div>
  );
}

function GroupBox({
  group,
  cardsFor,
  onOpenSkill,
}: {
  readonly group: Group;
  readonly cardsFor: (piece: Piece) => ReadonlyArray<Card>;
  readonly onOpenSkill: (project: Project, slug: string) => void;
}) {
  const pieces = PIECES.filter((p) => p.group === group);
  return (
    <div className={`min-w-[340px] flex-1 rounded-lg border ${GROUP_EDGE[group]} p-3`}>
      <div className="flex flex-wrap items-baseline gap-2 pb-2">
        <h2 className="font-display text-sm">{GROUP_TITLE[group]}</h2>
        <span className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">{GROUP_LABEL[group]}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {pieces.map((piece) => (
          <div key={piece.wire} className="rounded border border-border bg-paper p-2">
            <div className={`mb-1 inline-block rounded px-2 py-0.5 font-display text-xs ${GROUP_TINT[group]}`}>{piece.name}</div>
            <p className="pb-0.5 text-[12px] leading-snug text-ink">{piece.is}</p>
            <p className="pb-2 text-[11px] leading-snug text-ink-muted">
              <span className="[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">{piece.makes}</span>
            </p>
            {cardsFor(piece).map((card) => (
              <button
                key={`${card.project.name}/${card.slug}`}
                type="button"
                onClick={() => onOpenSkill(card.project, card.slug)}
                className="mb-2 block w-full rounded bg-surface p-2 text-left shadow-sm hover:shadow"
              >
                <div className={`font-display text-sm ${FADE_R}`}>{card.slug}</div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xs text-ink-muted ${FADE_R}`}>{card.project.name}</span>
                  {card.live && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">live</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
