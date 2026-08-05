/**
 * PROTOTYPE — Tasks, the work board (2026-08-05).
 *
 * Director: "Tasks is actually where we want work to be done... Tasks
 * should be a kanban board that ready-auto-fires the project plan card of
 * each triggered piece."
 *
 * So this board's cards are not skills and not stages. Each card is ONE
 * WANTED PIECE of one skill — a work order the maker asked for by pressing
 * the green button on that skill's card. Nothing appears here because it's
 * missing; things appear here because somebody said they want them.
 *
 * Two columns, and the split is derived, never dragged:
 *
 *   Blocked   wanted, but something it's made FROM doesn't exist yet. The
 *             card says what it's waiting on and why, in the words of the
 *             skill that enforces it.
 *   Ready     wanted, and everything it needs is in place. This is the
 *             auto-fire column: readiness is the trigger, not a second
 *             click. You declare desire once and the graph decides when.
 *
 * A card leaves the board by being MADE — the file exists, so the want is
 * satisfied and there is nothing left to track. That's why there's no Done
 * column: done work lives on the skill's card as a made piece, which is
 * the whole point of the pieces model.
 *
 * HONEST LIMIT: nothing here invokes an agent. The Ready column shows the
 * station that WOULD run, read from the same `stations.json` wiring the
 * engine uses (`doer` + `skill` + `produces`). Wiring the green button to
 * `StationEngine.runStation` is the next real step, and it is deliberately
 * not faked — a card that claims to be running when nothing is would be
 * worse than no card.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchBundleFiles, fetchProjects, useApiData } from "../next/api.ts";
import { setActiveProject } from "../runtime/projectScope.ts";
import { GROUP_TINT, PIECES } from "./pieces.ts";
import { OFFERS, isReady, markedSlugs, missingFor, readMarks, type Wanted } from "./offers.ts";
import type { Project } from "../next/types.ts";

const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted";

type Card = Wanted & { readonly slug: string; readonly project: Project | null };

export function ProtoTasks({ onOpenSkill }: { readonly onOpenSkill: (project: Project, slug: string) => void }) {
  const projects = useApiData(fetchProjects, [] as ReadonlyArray<Project>);
  const [cards, setCards] = useState<ReadonlyArray<Card>>([]);
  const [loading, setLoading] = useState(true);

  // Which skills have marks is a browser fact; whether each wanted thing is
  // blocked is a disk fact. So: read the marks, then ask the server what
  // exists for exactly those skills. No fan-out over the whole registry.
  const load = useCallback(async () => {
    const slugs = markedSlugs();
    const built: Card[] = [];
    for (const slug of slugs) {
      const marks = readMarks(slug);
      const wantedPaths = Object.entries(marks)
        .filter(([, state]) => state === "wanted")
        .map(([path]) => path);
      if (wantedPaths.length === 0) continue;

      let have: ReadonlySet<string>;
      try {
        have = new Set((await fetchBundleFiles(slug)).map((f) => f.path));
      } catch {
        have = new Set();
      }
      for (const path of wantedPaths) {
        const offer = OFFERS.find((o) => o.path === path);
        // A want whose file now EXISTS has been satisfied — it drops off
        // the board rather than sitting in a Done column.
        if (offer === undefined || have.has(path)) continue;
        const project = projects.find((p) => p.skills.some((s) => s.slug === slug)) ?? null;
        built.push({ offer, missing: missingFor(offer, have), slug, project });
      }
    }
    setCards(built);
    setLoading(false);
  }, [projects]);

  useEffect(() => {
    void load();
    // marks change on the skill card, which is a different route in the same
    // tab — refresh when the window regains focus so the board isn't stale
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const blocked = cards.filter((c) => !isReady(c));
  const ready = cards.filter((c) => isReady(c));

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl">Tasks</h1>
      <p className="max-w-2xl pb-5 pt-1 text-sm leading-relaxed text-ink-muted">
        One card per piece somebody asked for. Nothing lands here for being missing — only for being{" "}
        <span className="text-ink">wanted</span>. A card leaves when the piece exists.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Column
          title="Blocked"
          hint="wanted, but waiting on something it's made from"
          cards={blocked}
          onOpenSkill={onOpenSkill}
        />
        <Column
          title="Ready"
          hint="everything it needs is in place — readiness is the trigger"
          cards={ready}
          onOpenSkill={onOpenSkill}
        />
      </div>

      {!loading && cards.length === 0 && (
        <p className="max-w-2xl pt-5 text-sm leading-relaxed text-ink-muted">
          Nothing wanted yet. Open a skill and press <span className="text-ink">Build this</span> on a piece you want — it shows up
          here, blocked or ready.
        </p>
      )}
    </div>
  );
}

function Column({
  title,
  hint,
  cards,
  onOpenSkill,
}: {
  readonly title: string;
  readonly hint: string;
  readonly cards: ReadonlyArray<Card>;
  readonly onOpenSkill: (project: Project, slug: string) => void;
}) {
  const ready = title === "Ready";
  return (
    <div className={`rounded border bg-paper p-3 ${ready ? "border-emerald-700/50" : "border-border"}`}>
      <div className="flex items-baseline gap-2 pb-0.5">
        <h2 className="font-display text-sm">{title}</h2>
        <span className="text-[12px] text-ink-muted">{cards.length}</span>
      </div>
      <p className="pb-3 text-[12px] leading-snug text-ink-muted">{hint}</p>

      {cards.length === 0 && <p className="text-[12px] text-ink-muted">Nothing here.</p>}

      {cards.map((c) => {
        const piece = PIECES.find((p) => p.name === c.offer.piece);
        return (
          <div key={`${c.slug}:${c.offer.path}`} className="mb-2 rounded border border-border bg-surface p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {piece !== undefined && (
                <span className={`rounded px-1.5 py-0.5 font-display text-[11px] ${GROUP_TINT[piece.group]}`}>{c.offer.piece}</span>
              )}
              <button
                type="button"
                onClick={() => c.project !== null && (setActiveProject(c.project.slug), onOpenSkill(c.project, c.slug))}
                className={`truncate ${CODE} text-[11px] text-ink-muted hover:text-ink`}
              >
                {c.slug}
              </button>
            </div>

            <p className={`pt-1.5 ${CODE} text-[13px] text-ink`}>{c.offer.path}</p>
            <p className="text-[12px] leading-snug text-ink-muted">{c.offer.why}</p>

            {isReady(c) ? (
              <div className="pt-2">
                <p className="text-[12px] leading-snug text-ink">{c.offer.how}</p>
                {c.offer.station !== null ? (
                  <p className="pt-1.5 text-[11px] text-ink-muted">
                    would run <span className={CODE}>{c.offer.station}</span> — from this bundle&rsquo;s{" "}
                    <span className={CODE}>stations.json</span>
                  </p>
                ) : (
                  <p className="pt-1.5 text-[11px] text-ink-muted">No station claims this file — it&rsquo;s written by hand today.</p>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded border border-dashed border-border bg-canvas/40 p-2">
                <p className={LABEL}>Waiting on</p>
                <p className={`pt-0.5 ${CODE} text-[12px] text-ink`}>{c.missing.join(", ")}</p>
                {c.offer.needsBecause !== null && (
                  <p className="pt-1 text-[12px] leading-snug text-ink-muted">{c.offer.needsBecause}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
