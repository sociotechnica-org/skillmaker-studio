/**
 * PROTOTYPE — the skill page (fork pass, 2026-08-05).
 *
 * LIVE DATA. The fixtures are gone. Everything below comes off the same
 * `/api/*` the shipping app reads:
 *
 *   bundle detail   `bundle.oneLiner`, and `dossier` — which the server
 *                   already returns as `{ job?, outOfScope?, basis?,
 *                   evidence?, fitCriterion?, contexts[] }`. Absent keys
 *                   are absent BECAUSE the bundle has no dossier.md. Every
 *                   blank you see is a real gap on disk, not a staged one.
 *   files           `GET /api/bundles/:slug/files`, the real tree
 *   contents        `GET /api/bundles/:slug/file?path=`, on open
 *
 * TYPOGRAPHY. `--font-mono` is NOT a monospace — it's aliased to Special
 * Elite, the distressed typewriter (`Reference - Typography.md`; viewer
 * global.css:28). The standard reserves it for all-caps micro-labels with
 * wide tracking. Jess's own file tree uses it zero times: paths render in
 * the body serif, contents escape to a true monospace (RightPanel:292).
 * Same rules here.
 *
 * TABS ARE EARNED. Research · Eval · Publish are gone — four permanent
 * rooms, three usually empty, standing for topics rather than for anything
 * a skill had accumulated. What's left is Overview plus the files you
 * open. The test a candidate tab must pass: does it REFLECT across several
 * files (risk-map × fixtures × runs) rather than display one of them? If
 * one file answers it, it's a file, not a tab. The earned list is
 * deliberately empty, and the bar reads from it.
 */
import { useCallback, useState } from "react";
import { fetchBundleFile, fetchBundleFiles, useApiData } from "../next/api.ts";
import { apiPath } from "../runtime/projectScope.ts";
import { MADE, TO_BE_MADE } from "./pieces.ts";
import type { BundleFile } from "../next/types.ts";

/** A real monospace — deliberately NOT `font-mono`, which is Special Elite. */
const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";
/** The brand's structural device: all-caps micro-label, wide tracking. */
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted";

const PINNED = ["Overview"] as const;
type PinnedTab = (typeof PINNED)[number];
type OpenTab = { readonly kind: "pinned"; readonly id: PinnedTab } | { readonly kind: "file"; readonly path: string };

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

type Detail = {
  readonly name: string;
  readonly oneLiner: string;
  readonly dossier: WireDossier;
};

const EMPTY_DETAIL: Detail = { name: "", oneLiner: "", dossier: {} };

const fetchDetail = async (slug: string): Promise<Detail> => {
  const response = await fetch(apiPath(`/api/bundles/${encodeURIComponent(slug)}`));
  if (!response.ok) throw new Error(`bundle: ${response.status}`);
  const body = (await response.json()) as {
    bundle?: { name?: unknown; oneLiner?: unknown };
    dossier?: WireDossier;
  };
  return {
    name: typeof body.bundle?.name === "string" ? body.bundle.name : slug,
    oneLiner: typeof body.bundle?.oneLiner === "string" ? body.bundle.oneLiner : "",
    dossier: body.dossier ?? {},
  };
};

// ------------------------------------------------------------- the madlib

/**
 * The sentences: Playmaker's synopsis ("What it does / Reach for it when /
 * The story / Trigger") fused with the dossier's ruled sections. The blank
 * text is the scaffold's own question, shortened — the full one is the
 * tooltip, verbatim from `writeDossierScaffold`.
 */
type Slot = {
  readonly lead: string;
  readonly value: string | null;
  readonly short: string;
  readonly question: string;
  readonly source: string;
};

const slotsFrom = (detail: Detail): ReadonlyArray<Slot> => {
  const d = detail.dossier;
  const contexts = d.contexts ?? [];
  return [
    {
      lead: "It",
      // The dossier's Job when written; otherwise bundle.json's one-liner,
      // which every bundle has. Never blank in practice.
      value: d.job ?? (detail.oneLiner === "" ? null : detail.oneLiner),
      short: "what it does",
      question: "One line: what does this skill do?",
      source: "dossier.md",
    },
    {
      lead: "Don't use it to",
      value: d.outOfScope ?? null,
      short: "what it must not be used for",
      question: "Paired with Job (Model Cards): what should this explicitly NOT be used for?",
      source: "dossier.md",
    },
    {
      lead: "It runs",
      value: contexts.length === 0 ? null : contexts.map((c) => c.name ?? "unnamed").join(", "),
      short: "what comes before and after it",
      question: "Walk the last real time this ran: what came right before it, and what happened right after?",
      source: "dossier.md",
    },
    {
      lead: "It's built on",
      value: d.basis ?? null,
      short: "whose method it follows",
      question:
        "A named framework, or someone's way of doing it — record who, so an ambiguous case has a source of truth to ask.",
      source: "dossier.md",
    },
    {
      lead: "Evidence",
      value: d.evidence ?? null,
      short: "whether performance data exists",
      question: "Does performance data exist? Where does it live? Do we have permission to use it?",
      source: "dossier.md",
    },
    {
      lead: "You'd know it worked if",
      value: d.fitCriterion ?? null,
      short: "the one pass/fail test",
      question:
        "If you had to write one pass/fail test today, what would it check? The answer seeds the first fixture's answer key.",
      source: "dossier.md",
    },
  ];
};

// ------------------------------------------------------------- the files

/**
 * Files a bundle COULD have. A convention list, not a schema — each one is
 * something the product already knows how to make, so a blank can say how.
 * Anything the tree actually returns wins; these fill the holes.
 */
const COULD_EXIST: ReadonlyArray<{ readonly path: string; readonly why: string; readonly how: string }> = [
  { path: "design.md", why: "Intent and workflow.", how: "The researching station writes it, or write it by hand." },
  { path: "dossier.md", why: "Context of use — the sentences above.", how: "Run skillmaker dossier to scaffold it." },
  { path: "output/SKILL.md", why: "What ships.", how: "The drafting station writes it from design.md." },
  { path: "evals/risk-map.md", why: "The ways it can go wrong.", how: "The evaluating station authors it once there's a draft." },
];

type Row = { readonly path: string; readonly size: number | null; readonly why: string | null; readonly how: string | null };

const rowsFrom = (files: ReadonlyArray<BundleFile>): ReadonlyArray<Row> => {
  const have = new Set(files.map((f) => f.path));
  const known = new Map(COULD_EXIST.map((c) => [c.path, c]));
  const present: Row[] = files.map((f) => ({
    path: f.path,
    size: f.size,
    why: known.get(f.path)?.why ?? null,
    how: null,
  }));
  const missing: Row[] = COULD_EXIST.filter((c) => !have.has(c.path)).map((c) => ({
    path: c.path,
    size: null,
    why: c.why,
    how: c.how,
  }));
  return [...present, ...missing];
};

type Group = { readonly name: string; readonly rows: ReadonlyArray<Row> };

function group(rows: ReadonlyArray<Row>): { readonly root: ReadonlyArray<Row>; readonly folders: ReadonlyArray<Group> } {
  const root: Row[] = [];
  const folders: Group[] = [];
  for (const r of rows) {
    const cut = r.path.indexOf("/");
    if (cut === -1) {
      root.push(r);
      continue;
    }
    const name = r.path.slice(0, cut);
    const hit = folders.find((g) => g.name === name);
    if (hit === undefined) folders.push({ name, rows: [r] });
    else (hit.rows as Row[]).push(r);
  }
  return { root, folders };
}

// --------------------------------------------------------------- the page

export function SkillPane({ slug }: { readonly slug: string }) {
  const detail = useApiData(useCallback(() => fetchDetail(slug), [slug]), EMPTY_DETAIL);
  const files = useApiData(useCallback(() => fetchBundleFiles(slug), [slug]), [] as ReadonlyArray<BundleFile>);

  const [open, setOpen] = useState<ReadonlyArray<string>>([]);
  const [active, setActive] = useState<OpenTab>({ kind: "pinned", id: "Overview" });

  const rows = rowsFrom(files);

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
        {PINNED.map((id) => {
          const tab: OpenTab = { kind: "pinned", id };
          const on = active.kind === "pinned" && active.id === id;
          return (
            <button key={id} type="button" onClick={() => setActive(tab)} className={on ? TAB_ACTIVE : TAB_IDLE}>
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
          ) : (
            <Overview detail={detail} rows={rows} onOpenFile={openFile} />
          )}
        </div>
      </div>
    </div>
  );
}

function Overview({
  detail,
  rows,
  onOpenFile,
}: {
  readonly detail: Detail;
  readonly rows: ReadonlyArray<Row>;
  readonly onOpenFile: (path: string) => void;
}) {
  const { root, folders } = group(rows);
  const missing = rows.filter((r) => r.size === null).length;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-xl">{detail.name}</h1>

      <div className="flex flex-col gap-1.5 pt-4">
        {slotsFrom(detail).map((slot) => (
          <SlotLine key={slot.lead} slot={slot} onOpenFile={onOpenFile} />
        ))}
      </div>

      {/* The five facts — stage · version · drift · proven on · coverage —
          were here. Cut 2026-08-05 to be earned back. */}

      <div className="flex items-baseline justify-between pb-1 pt-8">
        <h2 className={LABEL}>Files</h2>
        <p className="text-[12px] text-ink-muted">
          {rows.length - missing} {MADE}
          {missing > 0 ? ` · ${missing} ${TO_BE_MADE}` : ""}
        </p>
      </div>

      <div className="rounded border border-border bg-surface">
        {root.map((r) => (
          <FileRow key={r.path} row={r} onOpen={() => onOpenFile(r.path)} indent={false} />
        ))}
        {folders.map((g) => (
          <Folder key={g.name} group={g} onOpenFile={onOpenFile} />
        ))}
        {rows.length === 0 && <p className="px-3 py-2 text-[12px] text-ink-muted">No files — is the server running?</p>}
      </div>
    </div>
  );
}

function SlotLine({ slot, onOpenFile }: { readonly slot: Slot; readonly onOpenFile: (path: string) => void }) {
  return (
    <p className="text-[15px] leading-relaxed">
      <span className="text-ink-muted">{slot.lead} </span>
      {slot.value === null ? (
        <button
          type="button"
          onClick={() => onOpenFile(slot.source)}
          title={slot.question}
          className="text-left italic text-ink-muted/60 underline decoration-dotted underline-offset-4 hover:text-amber-700"
        >
          {slot.short} — not recorded
        </button>
      ) : (
        <span className="text-ink">{slot.value}</span>
      )}
    </p>
  );
}

function Folder({ group: g, onOpenFile }: { readonly group: Group; readonly onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const missing = g.rows.filter((r) => r.size === null).length;
  const here = g.rows.length - missing;

  return (
    <div className="border-t border-border/70 first:border-t-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-well/60">
        <span className={`inline-block w-3 shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className={`${CODE} text-[13px] text-ink`}>{g.name}/</span>
        <span className="flex-1" />
        <span className="text-[12px] text-ink-muted">
          {here} {MADE}
          {missing > 0 && (
            <span className="text-amber-700">
              {" "}
              · {missing} {TO_BE_MADE}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/50 bg-canvas/40">
          {g.rows.map((r) => (
            <FileRow key={r.path} row={r} onOpen={() => onOpenFile(r.path)} indent />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ row, onOpen, indent }: { readonly row: Row; readonly onOpen: () => void; readonly indent: boolean }) {
  const here = row.size !== null;
  const label = indent ? row.path.slice(row.path.indexOf("/") + 1) : row.path;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={row.path}
      className={`flex w-full items-baseline gap-2 border-t border-border/50 px-3 py-1.5 text-left first:border-t-0 hover:bg-well/60 ${
        indent ? "pl-8" : ""
      }`}
    >
      <span className={`shrink-0 text-[10px] ${here ? "text-emerald-700" : "text-ink-muted/40"}`}>{here ? "●" : "○"}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${CODE} text-[13px] ${here ? "text-ink" : "text-ink-muted/70"}`}>{label}</span>
        {row.why !== null && <span className="block text-[12px] leading-snug text-ink-muted">{row.why}</span>}
        {!here && row.how !== null && <span className="block text-[12px] leading-snug text-amber-700">{row.how}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-ink-muted/70">{row.size === null ? TO_BE_MADE : `${(row.size / 1024).toFixed(1)} KB`}</span>
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
