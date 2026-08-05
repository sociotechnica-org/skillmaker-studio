/**
 * PROTOTYPE — the skill card (tabs-are-pieces pass, 2026-08-05).
 *
 * The four pieces are the tab bar now:
 *
 *   Overview · Job · Method · Prompt · Evals   + whatever files you open
 *
 * Earlier passes had four PERMANENT rooms named for topics (Research, Eval,
 * Publish) and rightly killed them. This is not that. These four tabs are
 * the parts a skill is made of, so every one of them is about this skill
 * and every one has something to say — including "nothing here yet", which
 * is the most useful thing a new skill's card can tell you.
 *
 * OVERVIEW IS SYNTHESIS. It doesn't repeat the tabs; it reads across them.
 * The sentences that ARE written render as plain prose, and everything not
 * written down collects into one honest gap paragraph that names what's
 * missing and sends you to the tab that owns it. A skill with nothing
 * recorded reads as a short, blunt paragraph rather than six dotted blanks.
 *
 * Files still earn their own tabs — click one anywhere and it opens beside
 * the pieces, closable, exactly like a browser.
 *
 * LIVE DATA throughout: bundle detail for the one-liner and the dossier
 * (which the server already returns as `{job, outOfScope, basis, evidence,
 * fitCriterion, contexts}`), the files endpoint for the tree, the file
 * endpoint on open. Absent dossier keys are absent because the bundle has
 * no dossier.md — every gap named below is real.
 *
 * TYPOGRAPHY: `--font-mono` is Special Elite, a display face, not a
 * monospace — reserved for all-caps micro-labels. Paths and file contents
 * use a real monospace via CODE. Solid colour tokens only: alpha-modified
 * ink collapses toward the ground at night.
 */
import { useCallback, useState } from "react";
import { fetchBundleFile, fetchBundleFiles, useApiData } from "../next/api.ts";
import { apiPath } from "../runtime/projectScope.ts";
import { GROUP_TINT, MADE, PIECES, TO_BE_MADE } from "./pieces.ts";
import type { BundleFile } from "../next/types.ts";

/** A real monospace — deliberately NOT `font-mono`, which is Special Elite. */
const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";
/** The brand's structural device: all-caps micro-label, wide tracking. */
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted";

type PieceName = "Job" | "Method" | "Prompt" | "Evals";
type TabId = "Overview" | PieceName;
const TABS: ReadonlyArray<TabId> = ["Overview", "Job", "Method", "Prompt", "Evals"];

type OpenTab = { readonly kind: "pinned"; readonly id: TabId } | { readonly kind: "file"; readonly path: string };

const TAB_ACTIVE =
  "relative z-10 -mb-px flex items-center gap-1.5 rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-display text-[12px] text-ink";
const TAB_IDLE =
  "flex items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-display text-[12px] text-ink-muted hover:bg-well/70 hover:text-ink";

// --------------------------------------------------------------- the wire

/** The dossier as the server already serialises it (core/src/Dossier.ts:32). */
type WireDossier = {
  readonly job?: string;
  readonly outOfScope?: string;
  readonly basis?: string;
  readonly evidence?: string;
  readonly fitCriterion?: string;
  readonly contexts?: ReadonlyArray<{ readonly name?: string }>;
};

type Detail = { readonly name: string; readonly oneLiner: string; readonly dossier: WireDossier };

const EMPTY_DETAIL: Detail = { name: "", oneLiner: "", dossier: {} };

const fetchDetail = async (slug: string): Promise<Detail> => {
  const response = await fetch(apiPath(`/api/bundles/${encodeURIComponent(slug)}`));
  if (!response.ok) throw new Error(`bundle: ${response.status}`);
  const body = (await response.json()) as { bundle?: { name?: unknown; oneLiner?: unknown }; dossier?: WireDossier };
  return {
    name: typeof body.bundle?.name === "string" ? body.bundle.name : slug,
    oneLiner: typeof body.bundle?.oneLiner === "string" ? body.bundle.oneLiner : "",
    dossier: body.dossier ?? {},
  };
};

// ------------------------------------------------------------- the madlib

/**
 * Each sentence belongs to a PIECE, which is what lets Overview synthesise
 * and each tab own its share. Note that Prompt has no sentence: nothing in
 * the data model records what model a skill is written for. That silence is
 * the honest surfacing of `MODEL_SELECTION_IS_UNRECORDED` in pieces.ts.
 */
type Slot = {
  readonly piece: PieceName;
  readonly lead: string;
  readonly value: string | null;
  /** How the gap reads in Overview's synthesis — a noun phrase. */
  readonly gap: string;
  /** The scaffold's full question, verbatim, for the piece tab. */
  readonly question: string;
  readonly source: string;
};

const slotsFrom = (detail: Detail): ReadonlyArray<Slot> => {
  const d = detail.dossier;
  const contexts = d.contexts ?? [];
  return [
    {
      piece: "Job",
      lead: "It",
      value: d.job ?? (detail.oneLiner === "" ? null : detail.oneLiner),
      gap: "what it does",
      question: "One line: what does this skill do?",
      source: "dossier.md",
    },
    {
      piece: "Job",
      lead: "Don't use it to",
      value: d.outOfScope ?? null,
      gap: "what it must not be used for",
      question: "Paired with Job (Model Cards): what should this explicitly NOT be used for?",
      source: "dossier.md",
    },
    {
      piece: "Job",
      lead: "It runs",
      value: contexts.length === 0 ? null : contexts.map((c) => c.name ?? "unnamed").join(", "),
      gap: "where it actually gets used",
      question: "Walk the last real time this ran: what came right before it, and what happened right after?",
      source: "dossier.md",
    },
    {
      piece: "Method",
      lead: "It's built on",
      value: d.basis ?? null,
      gap: "whose method it follows",
      question:
        "A named framework, or someone's way of doing it — record who, so an ambiguous case has a source of truth to ask.",
      source: "dossier.md",
    },
    {
      piece: "Evals",
      lead: "Evidence",
      value: d.evidence ?? null,
      gap: "whether performance data exists",
      question: "Does performance data exist? Where does it live? Do we have permission to use it?",
      source: "dossier.md",
    },
    {
      piece: "Evals",
      lead: "You'd know it worked if",
      value: d.fitCriterion ?? null,
      gap: "the one pass/fail test",
      question:
        "If you had to write one pass/fail test today, what would it check? The answer seeds the first fixture's answer key.",
      source: "dossier.md",
    },
  ];
};

// ------------------------------------------------------------- the files

/**
 * Files a bundle COULD have. A convention list, not a schema — each is
 * something the product already knows how to make, so a blank can say how.
 */
const COULD_EXIST: ReadonlyArray<{ readonly path: string; readonly why: string; readonly how: string }> = [
  { path: "design.md", why: "Intent and workflow.", how: "The researching station writes it, or write it by hand." },
  { path: "dossier.md", why: "Context of use — the sentences on this card.", how: "Run skillmaker dossier to scaffold it." },
  { path: "output/SKILL.md", why: "What ships.", how: "The drafting station writes it from design.md." },
  { path: "evals/risk-map.md", why: "The ways it can go wrong.", how: "The evaluating station authors it once there's a draft." },
];

type Row = { readonly path: string; readonly size: number | null; readonly why: string | null; readonly how: string | null };

const rowsFrom = (files: ReadonlyArray<BundleFile>): ReadonlyArray<Row> => {
  const have = new Set(files.map((f) => f.path));
  const known = new Map(COULD_EXIST.map((c) => [c.path, c]));
  const present: Row[] = files.map((f) => ({ path: f.path, size: f.size, why: known.get(f.path)?.why ?? null, how: null }));
  const missing: Row[] = COULD_EXIST.filter((c) => !have.has(c.path)).map((c) => ({
    path: c.path,
    size: null,
    why: c.why,
    how: c.how,
  }));
  return [...present, ...missing];
};

/**
 * Which piece a file belongs to. A folder is where a file happens to sit on
 * disk; a piece is what it's FOR. Anything unmatched stays visible under
 * Overview's tally rather than being dropped.
 */
const PIECE_OF = (path: string): PieceName | null => {
  if (path === "dossier.md") return "Job";
  if (path === "design.md" || path.startsWith("research/")) return "Method";
  if (path.startsWith("output/")) return "Prompt";
  // runs/ under Evals: a run is what an eval produced. Arguable — it's also
  // "how'd it do", which is a Release question. Flagged, not settled.
  if (path.startsWith("evals/") || path.startsWith("runs/")) return "Evals";
  return null;
};

// --------------------------------------------------------------- the page

export function SkillPane({ slug }: { readonly slug: string }) {
  const detail = useApiData(useCallback(() => fetchDetail(slug), [slug]), EMPTY_DETAIL);
  const files = useApiData(useCallback(() => fetchBundleFiles(slug), [slug]), [] as ReadonlyArray<BundleFile>);

  const [open, setOpen] = useState<ReadonlyArray<string>>([]);
  const [active, setActive] = useState<OpenTab>({ kind: "pinned", id: "Overview" });

  const rows = rowsFrom(files);
  const slots = slotsFrom(detail);

  const openFile = (path: string) => {
    if (!open.includes(path)) setOpen([...open, path]);
    setActive({ kind: "file", path });
  };

  const closeFile = (path: string) => {
    const next = open.filter((p) => p !== path);
    setOpen(next);
    if (active.kind === "file" && active.path === path) {
      const i = open.indexOf(path);
      const neighbour = next[Math.min(i, next.length - 1)];
      setActive(neighbour === undefined ? { kind: "pinned", id: "Overview" } : { kind: "file", path: neighbour });
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-end gap-1 px-6 pt-4">
        {TABS.map((id) => {
          const on = active.kind === "pinned" && active.id === id;
          const piece = PIECES.find((p) => p.name === id);
          const gaps =
            id === "Overview" ? 0 : rows.filter((r) => r.size === null && PIECE_OF(r.path) === id).length +
              slots.filter((s) => s.piece === id && s.value === null).length;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActive({ kind: "pinned", id })}
              className={on ? TAB_ACTIVE : TAB_IDLE}
              title={gaps > 0 ? `${id}: ${gaps} ${TO_BE_MADE}` : undefined}
            >
              {/* colour says which half of the skill this piece is: the two
                  that stay and inform, or the two that leave and run */}
              {piece !== undefined && <span className={`h-1.5 w-1.5 rounded-full ${GROUP_TINT[piece.group]}`} />}
              {id}
              {/* A bare number next to a tab reads as "how many things are in
                  here" -- the opposite of what it means. The hollow ring is
                  the same mark a file row uses for something not yet made, so
                  "○3" reads as "three still to be made" in the card's own
                  vocabulary rather than as a contents count. */}
              {gaps > 0 && (
                <span className="text-[10px] text-amber-800">
                  <span aria-hidden="true">○</span>
                  {gaps}
                </span>
              )}
            </button>
          );
        })}

        {open.length > 0 && <span className="mx-1.5 mb-2 h-4 w-px bg-border" />}

        {open.map((path) => {
          const on = active.kind === "file" && active.path === path;
          const name = path.split("/").pop() ?? path;
          return (
            <span key={path} className={on ? TAB_ACTIVE : TAB_IDLE}>
              <button
                type="button"
                onClick={() => setActive({ kind: "file", path })}
                className={`max-w-[150px] truncate ${CODE} text-[11px]`}
                title={path}
              >
                {name}
              </button>
              <button
                type="button"
                onClick={() => closeFile(path)}
                title={`Close ${path}`}
                className="-mr-1 rounded px-1 text-ink-muted hover:bg-canvas hover:text-ink"
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex-1 border-t border-neutral-900/50 bg-well">
        <div className="px-6 py-6">
          {active.kind === "file" ? (
            <FileView slug={slug} path={active.path} row={rows.find((r) => r.path === active.path)} />
          ) : active.id === "Overview" ? (
            <Overview detail={detail} slots={slots} rows={rows} onGoTo={(id) => setActive({ kind: "pinned", id })} />
          ) : (
            <PieceTab name={active.id} slots={slots} rows={rows} onOpenFile={openFile} />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- synthesis

/**
 * Overview reads ACROSS the four tabs rather than repeating them. What's
 * written renders as prose; what isn't collects into one gap paragraph.
 */
function Overview({
  detail,
  slots,
  rows,
  onGoTo,
}: {
  readonly detail: Detail;
  readonly slots: ReadonlyArray<Slot>;
  readonly rows: ReadonlyArray<Row>;
  readonly onGoTo: (id: TabId) => void;
}) {
  const said = slots.filter((s) => s.value !== null);
  const unsaid = slots.filter((s) => s.value === null);
  const unmade = rows.filter((r) => r.size === null);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-xl">{detail.name}</h1>

      {said.length === 0 ? (
        <p className="pt-4 text-[15px] leading-relaxed text-ink-muted">Nothing about this skill has been written down yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5 pt-4">
          {said.map((s) => (
            <p key={s.lead} className="text-[15px] leading-relaxed">
              <span className="text-ink-muted">{s.lead} </span>
              <span className="text-ink">{s.value}</span>
            </p>
          ))}
        </div>
      )}

      {/* the honest part: one paragraph, not six dotted blanks */}
      {(unsaid.length > 0 || unmade.length > 0) && (
        <div className="mt-6 rounded border border-dashed border-border bg-canvas/40 p-3">
          <p className={LABEL}>Not written down</p>
          {unsaid.length > 0 && (
            <p className="pt-1.5 text-[14px] leading-relaxed text-ink">
              {joinPhrases(unsaid.map((s) => s.gap))}.
            </p>
          )}
          {unmade.length > 0 && (
            <p className="pt-1.5 text-[14px] leading-relaxed text-ink">
              {unmade.length === 1 ? "One file is" : `${unmade.length} files are`} still {TO_BE_MADE}:{" "}
              {joinPhrases(unmade.map((r) => r.path))}.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-3">
            {PIECES.map((p) => {
              const n =
                unsaid.filter((s) => s.piece === p.name).length + unmade.filter((r) => PIECE_OF(r.path) === p.name).length;
              if (n === 0) return null;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => onGoTo(p.name as TabId)}
                  className="rounded border border-border px-2 py-1 text-[12px] text-ink-muted hover:border-amber-600 hover:text-ink"
                >
                  {p.name} · {n} open
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="pt-6 text-[12px] text-ink-muted">
        {rows.length - unmade.length} {MADE}
        {unmade.length > 0 ? ` · ${unmade.length} ${TO_BE_MADE}` : ""} across the four pieces.
      </p>
    </div>
  );
}

/** "a, b and c" — a sentence, not a comma-separated dump. */
function joinPhrases(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ------------------------------------------------------------ piece tabs

function PieceTab({
  name,
  slots,
  rows,
  onOpenFile,
}: {
  readonly name: PieceName;
  readonly slots: ReadonlyArray<Slot>;
  readonly rows: ReadonlyArray<Row>;
  readonly onOpenFile: (path: string) => void;
}) {
  const piece = PIECES.find((p) => p.name === name);
  const mine = slots.filter((s) => s.piece === name);
  const files = rows.filter((r) => PIECE_OF(r.path) === name);

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-display text-xl">{name}</h1>
        {piece !== undefined && <span className="text-[13px] text-ink-muted">{piece.is}</span>}
      </div>
      {piece !== undefined && (
        <p className="pt-1 text-[12px] text-ink-muted">
          {piece.group === "informs" ? "Stays here — it informs the prompt and the evals." : "Leaves here — it runs somewhere else."}
        </p>
      )}

      {mine.length > 0 && (
        <div className="flex flex-col gap-2 pt-5">
          {mine.map((s) =>
            s.value === null ? (
              // The lead and the scaffold's question don't compose into a
              // sentence ("Don't use it to Paired with Job (Model Cards):
              // what should..."), so close the sentence honestly first and
              // put the question underneath as the prompt it is.
              <div key={s.lead}>
                <p className="text-[15px] leading-relaxed">
                  <span className="text-ink-muted">{s.lead} </span>
                  <span className="italic text-ink-muted">— not recorded</span>
                </p>
                <p className="pl-4 text-[13px] leading-snug text-ink-muted">
                  {s.question} <span className={`${CODE} text-[11px]`}>{s.source}</span>
                </p>
              </div>
            ) : (
              <p key={s.lead} className="text-[15px] leading-relaxed">
                <span className="text-ink-muted">{s.lead} </span>
                <span className="text-ink">{s.value}</span>
              </p>
            ),
          )}
        </div>
      )}

      {/* the model-selection silence, said out loud where it belongs */}
      {name === "Prompt" && (
        <p className="mt-5 rounded border border-dashed border-border bg-canvas/40 p-3 text-[14px] leading-relaxed text-ink">
          Nothing records which model this prompt is written for. <span className="text-ink-muted">
            bundle.json's <span className={CODE}>targets</span> names agents, not models; the chat panel picks per session; a run
            records whatever it happened to use.
          </span>
        </p>
      )}

      <h2 className={`${LABEL} pb-1 pt-7`}>Files</h2>
      <div className="rounded border border-border bg-surface">
        {files.map((r) => (
          <FileRow key={r.path} row={r} onOpen={() => onOpenFile(r.path)} />
        ))}
        {files.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-muted">No files yet.</p>}
      </div>
    </div>
  );
}

function FileRow({ row, onOpen }: { readonly row: Row; readonly onOpen: () => void }) {
  const here = row.size !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={row.path}
      className="flex w-full items-baseline gap-2 border-t border-border/50 px-3 py-1.5 text-left first:border-t-0 hover:bg-well/60"
    >
      <span className={`shrink-0 text-[10px] ${here ? "text-emerald-700" : "text-ink-muted"}`}>{here ? "●" : "○"}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${CODE} text-[13px] ${here ? "text-ink" : "text-ink-muted"}`}>{row.path}</span>
        {row.why !== null && <span className="block text-[12px] leading-snug text-ink-muted">{row.why}</span>}
        {!here && row.how !== null && <span className="block text-[12px] leading-snug text-amber-800">{row.how}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-ink-muted">{row.size === null ? TO_BE_MADE : `${(row.size / 1024).toFixed(1)} KB`}</span>
    </button>
  );
}

function FileView({ slug, path, row }: { readonly slug: string; readonly path: string; readonly row: Row | undefined }) {
  const absent = row !== undefined && row.size === null;
  const content = useApiData(
    useCallback(() => (absent ? Promise.resolve("") : fetchBundleFile(slug, path)), [slug, path, absent]),
    null as string | null,
  );

  return (
    <div className="max-w-3xl">
      <p className={`pb-1 ${CODE} text-[13px] text-ink`}>{path}</p>
      {row?.why != null && <p className="pb-3 text-[13px] text-ink-muted">{row.why}</p>}

      {absent ? (
        <div className="rounded border border-dashed border-amber-600/60 bg-canvas/60 p-4">
          <p className={LABEL}>Still {TO_BE_MADE}</p>
          {row.how !== null && <p className="pt-2 text-[14px] leading-relaxed text-ink">{row.how}</p>}
        </div>
      ) : content === null ? (
        <p className="text-[13px] text-ink-muted">Loading…</p>
      ) : (
        <pre className={`overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-surface p-3 text-xs leading-relaxed ${CODE}`}>
          {content}
        </pre>
      )}
    </div>
  );
}
