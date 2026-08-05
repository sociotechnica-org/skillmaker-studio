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
import { useCallback, useEffect, useState } from "react";
import { fetchBundleFile, fetchBundleFiles, useApiData } from "../next/api.ts";
import { apiPath } from "../runtime/projectScope.ts";
import { GROUP_TINT, PIECES, TO_BE_MADE } from "./pieces.ts";
import {
  OFFERS,
  OFFER_BY_PATH,
  missingFor,
  readMarks,
  writeMarks,
  type Marks,
  type OfferState,
} from "./offers.ts";
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

type Row = { readonly path: string; readonly size: number | null; readonly why: string | null; readonly how: string | null };

/** Every file the bundle has, plus every offer it hasn't taken up yet. */
const rowsFrom = (files: ReadonlyArray<BundleFile>): ReadonlyArray<Row> => {
  const have = new Set(files.map((f) => f.path));
  const present: Row[] = files.map((f) => ({
    path: f.path,
    size: f.size,
    why: OFFER_BY_PATH[f.path]?.why ?? null,
    how: null,
  }));
  const absent: Row[] = OFFERS.filter((o) => !have.has(o.path)).map((o) => ({
    path: o.path,
    size: null,
    why: o.why,
    how: o.how,
  }));
  return [...present, ...absent];
};

/**
 * Which piece a file belongs to. A folder is where a file happens to sit on
 * disk; a piece is what it's FOR. Unmatched files stay visible on the tab
 * they land on rather than being dropped.
 */
const PIECE_OF = (path: string): PieceName | null => {
  if (path === "dossier.md") return "Job";
  if (path === "design.md" || path.startsWith("research/")) return "Method";
  if (path.startsWith("output/")) return "Prompt";
  // runs/ under Evals: a run is what an eval produced. Arguable -- it's also
  // "how'd it do", which is a Release question. Flagged, not settled.
  if (path.startsWith("evals/") || path.startsWith("runs/")) return "Evals";
  return null;
};

/**
 * Desire lives in `offers.ts` now — see the ruling there. The card's job is
 * to present each blank as a choice with two buttons, not as a deficiency
 * with a count.
 */
function useMarks(slug: string): readonly [Marks, (path: string, state: OfferState) => void, () => void] {
  const [marks, setMarks] = useState<Marks>({});
  useEffect(() => setMarks(readMarks(slug)), [slug]);
  // Functional update, not `{...marks}`: two marks in the same tick (a
  // maker clicking "Build this" twice quickly, or a test doing it in one
  // pass) both read the same stale closure otherwise, and the first one is
  // silently lost. Caught by driving the browser, not by typecheck.
  const set = (path: string, state: OfferState) => {
    setMarks((current) => {
      const next = { ...current, [path]: state };
      writeMarks(slug, next);
      return next;
    });
  };
  const resetAll = () => {
    setMarks({});
    writeMarks(slug, {});
  };
  return [marks, set, resetAll] as const;
}

// --------------------------------------------------------------- the page

export function SkillPane({ slug }: { readonly slug: string }) {
  const detail = useApiData(useCallback(() => fetchDetail(slug), [slug]), EMPTY_DETAIL);
  const files = useApiData(useCallback(() => fetchBundleFiles(slug), [slug]), [] as ReadonlyArray<BundleFile>);

  const [open, setOpen] = useState<ReadonlyArray<string>>([]);
  const [active, setActive] = useState<OpenTab>({ kind: "pinned", id: "Overview" });
  const [marks, mark, resetMarks] = useMarks(slug);

  // A cleared blank leaves the card; a file that EXISTS is never hidden,
  // whatever the maker cleared.
  const allRows = rowsFrom(files);
  const rows = allRows.filter((r) => r.size !== null || marks[r.path] !== "cleared");
  const slots = slotsFrom(detail);
  const have = new Set(files.map((f) => f.path));
  const clearedCount = Object.values(marks).filter((m) => m === "cleared").length;

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
          return (
            <button key={id} type="button" onClick={() => setActive({ kind: "pinned", id })} className={on ? TAB_ACTIVE : TAB_IDLE}>
              {/* colour says which half of the skill this piece is: the two
                  that stay and inform, or the two that leave and run.
                  NO GAP COUNT -- see the ruling in pieces.ts: a count reads
                  as a score against the maker, and a blank they left on
                  purpose is not a deficiency. */}
              {piece !== undefined && <span className={`h-1.5 w-1.5 rounded-full ${GROUP_TINT[piece.group]}`} />}
              {id}
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
            <Overview
              detail={detail}
              slots={slots}
              rows={rows}
              onGoTo={(id) => setActive({ kind: "pinned", id })}
              marks={marks}
              have={have}
              onMark={mark}
              clearedCount={clearedCount}
              onRestoreAll={resetMarks}
            />
          ) : (
            <PieceTab name={active.id} slots={slots} rows={rows} onOpenFile={openFile} onMark={mark} />
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
  marks,
  have,
  onGoTo,
  onMark,
  clearedCount,
  onRestoreAll,
}: {
  readonly detail: Detail;
  readonly slots: ReadonlyArray<Slot>;
  readonly rows: ReadonlyArray<Row>;
  readonly marks: Marks;
  readonly have: ReadonlySet<string>;
  readonly onGoTo: (id: TabId) => void;
  readonly onMark: (path: string, state: OfferState) => void;
  readonly clearedCount: number;
  readonly onRestoreAll: () => void;
}) {
  const said = slots.filter((s) => s.value !== null);
  const unmade = rows.filter((r) => r.size === null);
  const wanted = unmade.filter((r) => marks[r.path] === "wanted");
  const open = unmade.filter((r) => marks[r.path] !== "wanted");

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

      {/* WANTED — the only thing worth tracking. These are work orders the
          maker asked for; they live on the Tasks board until they exist. */}
      {wanted.length > 0 && (
        <div className="mt-6 rounded border border-emerald-700/50 bg-canvas/40 p-3">
          <p className={LABEL}>You asked for</p>
          <div className="flex flex-col pt-1">
            {wanted.map((r) => {
              const offer = OFFER_BY_PATH[r.path];
              const missing = offer === undefined ? [] : missingFor(offer, have);
              return (
                <div key={r.path} className="border-t border-border/50 py-2 first:border-t-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`${CODE} text-[14px] text-ink`}>{r.path}</span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => onMark(r.path, "offered")}
                      className="text-[11px] text-ink-muted hover:text-ink"
                    >
                      never mind
                    </button>
                  </div>
                  {missing.length === 0 ? (
                    <p className="text-[12px] leading-snug text-emerald-700">Ready — nothing in its way.</p>
                  ) : (
                    <p className="text-[12px] leading-snug text-amber-800">Blocked — waiting on {missing.join(", ")}.</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="pt-2 text-[12px] text-ink-muted">These are on the Tasks board.</p>
        </div>
      )}

      {/* EMPTY SPACE — offers, not deficiencies. Two buttons, never a count:
          build it (a want, trackable) or clear it away (not how I work). */}
      {open.length > 0 && (
        <div className="mt-4 rounded border border-dashed border-border bg-canvas/40 p-3">
          <p className={LABEL}>Empty space</p>
          <p className="pb-2 pt-1 text-[12px] leading-snug text-ink-muted">
            Room the product left you. Ask for what you want; clear away what your process doesn&rsquo;t use.
          </p>
          <div className="flex flex-col">
            {open.map((r) => {
              const offer = OFFER_BY_PATH[r.path];
              const missing = offer === undefined ? [] : missingFor(offer, have);
              return (
                <OfferRow
                  key={r.path}
                  path={r.path}
                  detail={r.how ?? ""}
                  where={PIECE_OF(r.path) ?? "Job"}
                  missing={missing}
                  onGo={() => {
                    const p = PIECE_OF(r.path);
                    if (p !== null) onGoTo(p as TabId);
                  }}
                  onWant={() => onMark(r.path, "wanted")}
                  onClear={() => onMark(r.path, "cleared")}
                />
              );
            })}
          </div>
        </div>
      )}

      {clearedCount > 0 && (
        <p className="pt-3 text-[12px] text-ink-muted">
          {clearedCount} cleared away.{" "}
          <button type="button" onClick={onRestoreAll} className="underline decoration-dotted underline-offset-4 hover:text-ink">
            Bring them back
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * One piece of empty space, as a choice. Two buttons and no count: BUILD
 * THIS is the green one — the thing the product actually tracks — and ✕
 * says "not how I work". A blocked offer can still be wanted: you declare
 * desire now, and readiness fires it later.
 */
function OfferRow({
  path,
  detail,
  where,
  missing,
  onGo,
  onWant,
  onClear,
}: {
  readonly path: string;
  readonly detail: string;
  readonly where: string;
  readonly missing: ReadonlyArray<string>;
  readonly onGo: () => void;
  readonly onWant: () => void;
  readonly onClear: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 border-t border-border/50 py-2 first:border-t-0">
      <span className="pt-1 text-[10px] text-ink-muted" aria-hidden="true">
        ○
      </span>
      <button type="button" onClick={onGo} className="min-w-0 flex-1 text-left">
        <span className={`block ${CODE} text-[14px] text-ink`}>{path}</span>
        {detail !== "" && <span className="block text-[12px] leading-snug text-ink-muted">{detail}</span>}
        {missing.length > 0 && (
          <span className="block text-[12px] leading-snug text-amber-800">Needs {missing.join(", ")} first.</span>
        )}
      </button>
      <span className="shrink-0 pt-1 text-[11px] text-ink-muted">{where}</span>
      <button
        type="button"
        onClick={onWant}
        title={missing.length > 0 ? "Want it — it'll wait on the Tasks board until it can happen" : "Want it — ready to go"}
        className="shrink-0 rounded border border-emerald-700/60 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
      >
        Build this
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Clear this away — my process doesn't use it"
        className="shrink-0 rounded px-1 text-[11px] text-ink-muted opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

// ------------------------------------------------------------ piece tabs

function PieceTab({
  name,
  slots,
  rows,
  onOpenFile,
  onMark,
}: {
  readonly name: PieceName;
  readonly slots: ReadonlyArray<Slot>;
  readonly rows: ReadonlyArray<Row>;
  readonly onOpenFile: (path: string) => void;
  readonly onMark: (path: string, state: OfferState) => void;
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
          <FileRow key={r.path} row={r} onOpen={() => onOpenFile(r.path)} onClear={() => onMark(r.path, "cleared")} />
        ))}
        {files.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-muted">No files yet.</p>}
      </div>
    </div>
  );
}

function FileRow({ row, onOpen, onClear }: { readonly row: Row; readonly onOpen: () => void; readonly onClear: () => void }) {
  const here = row.size !== null;
  return (
    <div
      className="group flex w-full items-baseline gap-2 border-t border-border/50 px-3 py-1.5 text-left first:border-t-0 hover:bg-well/60"
    >
    <button type="button" onClick={onOpen} title={row.path} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
      <span className={`shrink-0 text-[10px] ${here ? "text-emerald-700" : "text-ink-muted"}`}>{here ? "●" : "○"}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${CODE} text-[13px] ${here ? "text-ink" : "text-ink-muted"}`}>{row.path}</span>
        {row.why !== null && <span className="block text-[12px] leading-snug text-ink-muted">{row.why}</span>}
        {!here && row.how !== null && <span className="block text-[12px] leading-snug text-amber-800">{row.how}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-ink-muted">{row.size === null ? TO_BE_MADE : `${(row.size / 1024).toFixed(1)} KB`}</span>
    </button>
    {/* only a blank can be declined -- a file that exists is never hidden */}
    {!here && (
      <button
        type="button"
        onClick={onClear}
        title="Clear this away — my process doesn't use it"
        className="shrink-0 rounded px-1 text-[11px] text-ink-muted opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100"
      >
        ✕
      </button>
    )}
    </div>
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
