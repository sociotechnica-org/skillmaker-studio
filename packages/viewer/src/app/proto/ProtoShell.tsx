/**
 * PROTOTYPE — the shell (usability remodel, 2026-08-05).
 *
 * The whole argument, in navigation:
 *
 *   Board  = the VERBS. Everything happening to any skill, right now.
 *            Columns are work states (is it running? does it need me?),
 *            not skill stages. A card is a job, phrased as a verb, and it
 *            names the files it will produce.
 *
 *   Skill  = the NOUNS. The card: what exists, drawn as the bundle's
 *            folders. Nothing is "in progress" here — in-progress things
 *            wear a board ribbon and link back to the Board.
 *
 *   Chat   = a TOOL you point at either one. It is not a place, and it is
 *            emphatically not the other half of Files. Files live on the
 *            card, because files ARE the card.
 *
 * Clicking a board card opens the WORK, not the skill. Clicking a skill
 * opens the card. Those two sentences are the remodel.
 */
import { useEffect, useState } from "react";
import { SPEC, type BlockSpec } from "./catalog.ts";
import { COLUMNS, KIND_TINT, SKILLS, STAGE_TINT, WORK, type Column, type Fill, type Work } from "./data.ts";
import { SkillCard } from "./Card.tsx";

type View = { readonly kind: "board" } | { readonly kind: "skill"; readonly slug: string };
type Drawer =
  | { readonly kind: "file"; readonly spec: BlockSpec; readonly fill: Fill }
  | { readonly kind: "work"; readonly id: string }
  | null;

/** Which work-kind a "start this work" button mints, by drawer. */
const WORK_KIND: Record<string, Work["kind"]> = {
  output: "build",
  research: "research",
  evals: "eval",
  runs: "eval",
  record: "review",
};

/** `#slug` is a skill card; no hash is the Board. Linkable, so a screenshot
    or a Discord message can point at one screen of the argument. */
function viewFromHash(): View {
  if (typeof window === "undefined") return { kind: "board" };
  const slug = window.location.hash.replace(/^#/, "");
  return slug !== "" && SKILLS.some((s) => s.slug === slug) ? { kind: "skill", slug } : { kind: "board" };
}

export default function ProtoShell() {
  const [view, setViewState] = useState<View>({ kind: "board" });
  const [work, setWork] = useState<ReadonlyArray<Work>>(WORK);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [minted, setMinted] = useState(0);
  const [showThesis, setShowThesis] = useState(true);

  useEffect(() => {
    setViewState(viewFromHash());
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setView = (next: View) => {
    setViewState(next);
    const hash = next.kind === "skill" ? `#${next.slug}` : "";
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash === "" ? window.location.pathname : hash);
  };

  const skill = view.kind === "skill" ? SKILLS.find((s) => s.slug === view.slug) : undefined;

  const startWork = (spec: BlockSpec, slug: string) => {
    const id = `new-${minted + 1}`;
    setMinted(minted + 1);
    setWork([
      ...work,
      {
        id,
        title: spec.work,
        skill: slug,
        column: "Queued",
        produces: [spec.id],
        kind: WORK_KIND[spec.folder] ?? "build",
        detail: `Fills the ${spec.label} block — writes ${spec.path}.`,
        log: [],
        age: "queued just now",
      },
    ]);
    setDrawer({ kind: "work", id });
  };

  const openWork = work.find((w) => drawer?.kind === "work" && w.id === drawer.id);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar ------------------------------------------------------- */}
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-border bg-paper px-3 py-4">
        <p className="pb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700">prototype</p>

        <button
          type="button"
          onClick={() => {
            setView({ kind: "board" });
            setDrawer(null);
          }}
          className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-display text-sm ${
            view.kind === "board" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface hover:text-ink"
          }`}
        >
          <span>Board</span>
          <span className="font-mono text-[10px] text-ink-muted">{work.filter((w) => w.column !== "Landed").length} live</span>
        </button>
        <p className="px-2 pb-1 pt-1 text-[11px] text-ink-muted">where the work is</p>

        <p className="px-2 pb-1 pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-muted">skills</p>
        {SKILLS.map((s) => {
          const live = work.filter((w) => w.skill === s.slug && w.column !== "Landed").length;
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => {
                setView({ kind: "skill", slug: s.slug });
                setDrawer(null);
              }}
              className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                view.kind === "skill" && view.slug === s.slug ? "bg-surface shadow-sm" : "hover:bg-surface"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-ink">{s.slug}</span>
                <span className="block truncate text-[11px] text-ink-muted">{s.oneLiner}</span>
              </span>
              {live > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" title={`${live} on the board`} />}
            </button>
          );
        })}
        <p className="px-2 pb-1 pt-1 text-[11px] text-ink-muted">the stuff of each skill</p>
      </aside>

      {/* center -------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="font-display text-sm">{view.kind === "board" ? "Board" : (skill?.slug ?? "unknown")}</span>
          {view.kind === "skill" && skill !== undefined && (
            <>
              <span className={`rounded px-1.5 font-mono text-[10px] ${STAGE_TINT[skill.stage]}`}>{skill.stage}</span>
              {work.filter((w) => w.skill === skill.slug && w.column !== "Landed").length > 0 && (
                <button
                  type="button"
                  onClick={() => setView({ kind: "board" })}
                  className="rounded border border-amber-600 bg-amber-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-800"
                >
                  {work.filter((w) => w.skill === skill.slug && w.column !== "Landed").length} jobs on the board ▸
                </button>
              )}
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setShowThesis(!showThesis)}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-muted hover:text-ink"
          >
            {showThesis ? "hide" : "show"} the argument
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          {showThesis && (
            <div className="border-b border-amber-600/30 bg-amber-100/50 px-6 py-2.5 text-[12px] leading-snug text-ink">
              <strong className="font-display">The argument:</strong> the <strong>Board</strong> is verbs — everything happening, phrased as a job,
              each one naming the file it will produce. A <strong>skill</strong> is nouns — its card, drawn as its folders, where every block is a file
              and every blank is a job you haven't started. Chat is a tool you point at either; it has no files of its own.
            </div>
          )}

          {view.kind === "board" && (
            <Board
              work={work}
              onOpenWork={(id) => setDrawer({ kind: "work", id })}
              onOpenSkill={(slug) => {
                setView({ kind: "skill", slug });
                setDrawer(null);
              }}
            />
          )}

          {view.kind === "skill" && skill !== undefined && (
            <div className="p-6">
              <SkillCard
                key={skill.slug}
                skill={skill}
                work={work}
                onOpenFile={(spec, fill) => setDrawer({ kind: "file", spec, fill })}
                onStartWork={(spec) => startWork(spec, skill.slug)}
                onOpenWork={(id) => setDrawer({ kind: "work", id })}
              />
            </div>
          )}
        </main>
      </div>

      {/* right drawer — a file, or a job. Never a permanent fixture. ---- */}
      {drawer !== null && (
        <aside className="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-border bg-paper">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
              {drawer.kind === "file" ? "file" : "job"}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => setDrawer(null)} className="rounded px-2 font-mono text-[11px] text-ink-muted hover:text-ink">
              close
            </button>
          </div>

          {drawer.kind === "file" && (
            <div className="flex-1 overflow-y-auto p-4">
              <p className="font-mono text-[12px] text-ink">{drawer.spec.path}</p>
              <p className="pb-3 pt-1 text-[11px] text-ink-muted">{drawer.spec.blurb}</p>
              <FilePeek fill={drawer.fill} />
              <div className="flex flex-wrap gap-2 pt-4">
                <DrawerAction label="Edit" />
                <DrawerAction label="Ask chat about this file" />
                <DrawerAction label="History" />
              </div>
              <p className="pt-3 text-[11px] leading-snug text-ink-muted">
                Chat opens <em>pointed at this file</em> — that's the whole relationship. Files are not a chat tab.
              </p>
            </div>
          )}

          {drawer.kind === "work" && openWork !== undefined && (
            <div className="flex-1 overflow-y-auto p-4">
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_TINT[openWork.kind]}`}>{openWork.kind}</span>
              <h2 className="pt-2 font-display text-lg leading-tight">{openWork.title}</h2>
              <p className="font-mono text-[11px] text-ink-muted">
                {openWork.skill} · {openWork.age}
              </p>
              <p className="pt-3 text-[12px] leading-snug text-ink">{openWork.detail}</p>

              <p className="pb-1 pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-muted">produces</p>
              <div className="flex flex-col gap-1">
                {openWork.produces.map((id) => {
                  const spec = SPEC[id];
                  if (spec === undefined) return null;
                  return (
                    <div key={id} className="rounded border border-border bg-surface px-2 py-1.5">
                      <span className="text-[12px]">{spec.label}</span>
                      <span className="block font-mono text-[10px] text-ink-muted">{spec.path}</span>
                    </div>
                  );
                })}
              </div>

              {openWork.log.length > 0 && (
                <>
                  <p className="pb-1 pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-muted">what's happened</p>
                  <ul className="flex flex-col gap-1">
                    {openWork.log.map((l, i) => (
                      <li key={`${l}-${i}`} className="font-mono text-[11px] text-ink-muted">
                        · {l}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="flex flex-wrap gap-2 pt-4">
                <DrawerAction label={openWork.column === "Needs you" ? "Answer it" : "Open the session"} primary />
                <DrawerAction label="Ask chat" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setView({ kind: "skill", slug: openWork.skill });
                }}
                className="pt-3 font-mono text-[10px] uppercase tracking-wider text-ink-muted hover:text-ink"
              >
                see this skill's card ▸
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function DrawerAction({ label, primary }: { readonly label: string; readonly primary?: boolean }) {
  return (
    <span
      className={`rounded px-2.5 py-1 font-display text-[12px] ${
        primary === true ? "bg-amber-600 text-white" : "border border-border bg-surface text-ink-muted"
      }`}
    >
      {label}
    </span>
  );
}

function FilePeek({ fill }: { readonly fill: Fill }) {
  if (fill.kind === "prose") {
    return (
      <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-3 font-sans text-[12px] leading-snug text-ink">{fill.text}</pre>
    );
  }
  if (fill.kind === "files") {
    return (
      <ul className="flex flex-col gap-1">
        {fill.files.map((f) => (
          <li key={f.name} className="rounded border border-border bg-surface px-2 py-1.5 text-[12px]">
            <span className="font-mono text-ink">{f.name}</span>
            <span className="block text-[11px] text-ink-muted">{f.note}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="rounded border border-border bg-surface p-3 text-[12px] text-ink-muted">Derived from this drawer — no single file to open.</p>;
}

// ------------------------------------------------------------------- board

function Board({
  work,
  onOpenWork,
  onOpenSkill,
}: {
  readonly work: ReadonlyArray<Work>;
  readonly onOpenWork: (id: string) => void;
  readonly onOpenSkill: (slug: string) => void;
}) {
  return (
    <div className="p-6">
      <h1 className="font-display text-2xl">Board</h1>
      <p className="pb-4 pt-1 text-sm text-ink-muted">
        Every job in flight, across every skill. Columns are work states — a stage belongs to a skill, not to a job.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = work.filter((w) => w.column === col);
          return (
            <div key={col} className="rounded border border-border bg-paper p-2">
              <div className="flex items-baseline justify-between pb-2">
                <span className={`rounded px-2 py-0.5 font-display text-xs ${COLUMN_TINT[col]}`}>{col}</span>
                <span className="font-mono text-[10px] text-ink-muted">{items.length}</span>
              </div>
              {items.length === 0 && <p className="px-1 pb-2 text-[11px] text-ink-muted">Nothing here.</p>}
              {items.map((w) => (
                <div key={w.id} className="mb-2 rounded border border-border bg-surface p-2 shadow-sm">
                  <button type="button" onClick={() => onOpenWork(w.id)} className="block w-full text-left">
                    <span className={`rounded px-1.5 font-mono text-[9px] uppercase ${KIND_TINT[w.kind]}`}>{w.kind}</span>
                    <span className="block pt-1 font-display text-[13px] leading-snug text-ink">{w.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSkill(w.skill)}
                    className="block truncate font-mono text-[10px] text-ink-muted hover:text-ink"
                    title="Open this skill's card"
                  >
                    {w.skill} ▸
                  </button>
                  <div className="flex flex-wrap gap-1 pt-1.5">
                    {w.produces.map((id) => {
                      const spec = SPEC[id];
                      if (spec === undefined) return null;
                      return (
                        <span key={id} className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[9px] text-ink-muted" title={spec.path}>
                          → {spec.label}
                        </span>
                      );
                    })}
                  </div>
                  <p className="pt-1 font-mono text-[10px] text-ink-muted/70">{w.age}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="pt-4 text-[11px] text-ink-muted">
        Each card names the blocks it fills. That chip is the join: finish the job, the block on the card stops being gray.
      </p>
    </div>
  );
}

const COLUMN_TINT: Record<Column, string> = {
  Queued: "bg-neutral-200 text-neutral-700",
  Running: "bg-amber-100 text-amber-800",
  "Needs you": "bg-red-100 text-red-700",
  Landed: "bg-emerald-100 text-emerald-800",
};
