/**
 * PROTOTYPE — the skill card (usability remodel, 2026-08-05).
 *
 * The card is the SKILL PAGE, and the skill page is the noun: what exists.
 * It is drawn as the bundle's folders, because that's what it is — every
 * block names a path. Nothing here starts work by itself; blocks that are
 * blank hand you off to the Board, which is where work lives.
 *
 * Squarespace behaviours, all real in this prototype:
 *   · blank blocks show as gray wells — "this file could exist"
 *   · ✕ removes a block you don't want; (+) adds one back
 *   · ↑ ↓ reorder; 📌 pins a block into the glance band at the top
 *   · the glance band is not a separate concept — it's just pinned blocks
 *   · layout persists per skill (localStorage), so the card is YOURS
 */
import { useEffect, useState } from "react";
import { CATALOG, FOLDERS, FOLDER_JOB, FOLDER_LABEL, SPEC, type BlockSpec, type Folder, type Span } from "./catalog.ts";
import { FOLDER_PATH_TINT, FOLDER_TINT, STAGE_TINT, type Fill, type ProtoSkill, type Work } from "./data.ts";

const SPAN_CLASS: Record<Span, string> = {
  2: "col-span-6 sm:col-span-3 lg:col-span-2",
  3: "col-span-6 lg:col-span-3",
  6: "col-span-6",
};

const HEAT_CLASS: Record<string, string> = {
  "0": "bg-emerald-100 text-emerald-900",
  "2": "bg-amber-300 text-amber-900",
  "3": "bg-red-300 text-red-900",
  "-1": "border border-dashed border-border text-ink-muted",
};

const TONE_CLASS: Record<string, string> = {
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700",
};

// ------------------------------------------------------------------ layout

export type Layout = {
  /** Block ids, in card order. Removing a block drops it from here. */
  readonly order: ReadonlyArray<string>;
  /** Block ids shown in the glance band. A subset of `order`. */
  readonly pinned: ReadonlyArray<string>;
};

const DEFAULT_PINNED = ["passrate", "coverage", "install"];

function defaultLayout(): Layout {
  return { order: CATALOG.map((b) => b.id), pinned: DEFAULT_PINNED };
}

export function useLayout(slug: string): readonly [Layout, (next: Layout) => void, () => void] {
  const key = `sm-proto-layout-${slug}`;
  const [layout, setLayout] = useState<Layout>(defaultLayout);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setLayout(raw === null ? defaultLayout() : (JSON.parse(raw) as Layout));
    } catch {
      setLayout(defaultLayout());
    }
  }, [key]);

  const write = (next: Layout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  const reset = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
    setLayout(defaultLayout());
  };
  return [layout, write, reset] as const;
}

// -------------------------------------------------------------------- card

export function SkillCard({
  skill,
  work,
  onOpenFile,
  onStartWork,
  onOpenWork,
}: {
  readonly skill: ProtoSkill;
  readonly work: ReadonlyArray<Work>;
  readonly onOpenFile: (spec: BlockSpec, fill: Fill) => void;
  readonly onStartWork: (spec: BlockSpec) => void;
  readonly onOpenWork: (id: string) => void;
}) {
  const [layout, setLayout, reset] = useLayout(skill.slug);
  const [showPossible, setShowPossible] = useState(true);
  const [drawer, setDrawer] = useState<Folder | "all">("all");
  const [adding, setAdding] = useState<Folder | null>(null);

  /** Work in flight, indexed by the block it will fill. The live join. */
  const inFlight = new Map<string, Work>();
  for (const w of work) {
    if (w.skill !== skill.slug || w.column === "Landed") continue;
    for (const id of w.produces) if (!inFlight.has(id)) inFlight.set(id, w);
  }

  const present = layout.order.filter((id) => SPEC[id] !== undefined);
  const removed = CATALOG.filter((b) => !present.includes(b.id));

  const filled = present.filter((id) => skill.fills[id] !== undefined).length;
  const drawers: ReadonlyArray<Folder> = drawer === "all" ? FOLDERS : [drawer];

  const move = (id: string, delta: number) => {
    const next = [...present];
    const i = next.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= next.length) return;
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    setLayout({ ...layout, order: next });
  };
  const removeBlock = (id: string) =>
    setLayout({ order: present.filter((x) => x !== id), pinned: layout.pinned.filter((x) => x !== id) });
  const addBlock = (id: string) => {
    setLayout({ ...layout, order: [...present, id] });
    setAdding(null);
  };
  const togglePin = (id: string) =>
    setLayout({
      ...layout,
      pinned: layout.pinned.includes(id) ? layout.pinned.filter((x) => x !== id) : [...layout.pinned, id],
    });

  return (
    <article className="card-shadow-lg rounded-lg border-2 border-ink bg-surface">
      <div className="h-2 rounded-t-md bg-amber-500" />

      {/* identity band ------------------------------------------------- */}
      <div className="px-6 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700">skill card</p>
            <p className="mt-1 break-words font-mono text-2xl leading-tight">{skill.slug}</p>
            <p className="mt-1.5 text-sm leading-snug text-ink-muted">{skill.oneLiner}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {skill.tags.map((t) => (
                <span key={t} className="rounded-full border border-border bg-canvas px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STAGE_TINT[skill.stage]}`}>
              {skill.stage} · {skill.version}
            </span>
            <span className="font-mono text-[10px] text-ink-muted">
              {filled} of {present.length} blocks filled
            </span>
          </div>
        </div>

        {/* glance band = pinned blocks, nothing more --------------------- */}
        <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          {layout.pinned.map((id) => {
            const spec = SPEC[id];
            if (spec === undefined) return null;
            const fill = skill.fills[id];
            return (
              <div key={id} className="group relative bg-surface px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{spec.label}</p>
                {fill === undefined ? (
                  <>
                    <p className="mt-0.5 font-mono text-lg leading-none text-ink-muted/40">——</p>
                    <p className="font-mono text-[10px] text-ink-muted/70">not measured</p>
                  </>
                ) : fill.kind === "stat" ? (
                  <>
                    <p className={`mt-0.5 font-mono text-lg leading-none ${fill.tone === undefined ? "" : TONE_CLASS[fill.tone] ?? ""}`}>{fill.value}</p>
                    <p className="font-mono text-[10px] text-ink-muted">{fill.sub}</p>
                  </>
                ) : (
                  <p className="mt-0.5 font-mono text-[11px] text-ink-muted">see block below</p>
                )}
                <button
                  type="button"
                  title="Unpin from the glance band"
                  onClick={() => togglePin(id)}
                  className="absolute right-1.5 top-1.5 rounded px-1 font-mono text-[10px] text-ink-muted opacity-0 hover:bg-canvas group-hover:opacity-100"
                >
                  unpin
                </button>
              </div>
            );
          })}
          {layout.pinned.length === 0 && (
            <p className="bg-surface px-3 py-4 text-center font-mono text-[11px] text-ink-muted sm:col-span-3">
              Nothing pinned. Pin any block to put its headline up here.
            </p>
          )}
        </div>
      </div>

      {/* drawer spine — the bundle's folders, as tabs -------------------- */}
      <div className="mt-5 flex flex-wrap items-end gap-1 border-b border-ink/25 px-5">
        <DrawerTab label="the whole card" active={drawer === "all"} onClick={() => setDrawer("all")} />
        {FOLDERS.map((f) => (
          <DrawerTab key={f} label={FOLDER_LABEL[f]} active={drawer === f} onClick={() => setDrawer(f)} />
        ))}
        <span className="flex-1" />
        <label className="flex cursor-pointer items-center gap-1.5 pb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          <input type="checkbox" checked={showPossible} onChange={(e) => setShowPossible(e.target.checked)} className="cursor-pointer accent-amber-600" />
          show the possible
        </label>
        <button type="button" onClick={reset} className="pb-2 pl-3 font-mono text-[10px] uppercase tracking-wider text-ink-muted hover:text-ink">
          reset layout
        </button>
      </div>

      {/* the drawers ---------------------------------------------------- */}
      <div className="bg-well px-5 pb-6 pt-4">
        {drawers.map((folder) => {
          const ids = present.filter((id) => SPEC[id]?.folder === folder);
          const shown = ids.filter((id) => showPossible || skill.fills[id] !== undefined || inFlight.has(id));
          const hidden = ids.length - shown.length;
          const addable = removed.filter((b) => b.folder === folder);
          const filledHere = ids.filter((id) => skill.fills[id] !== undefined).length;

          return (
            <section key={folder} className="pb-6 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
                <div>
                  <h3 className={`font-mono text-sm ${FOLDER_TINT[folder]}`}>{FOLDER_LABEL[folder]}</h3>
                  <p className="text-[11px] text-ink-muted">{FOLDER_JOB[folder]}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                  {filledHere} of {ids.length} filled
                </span>
              </div>

              <div className="grid grid-cols-6 gap-3">
                {shown.map((id) => {
                  const spec = SPEC[id];
                  if (spec === undefined) return null;
                  return (
                    <Block
                      key={id}
                      spec={spec}
                      fill={skill.fills[id]}
                      work={inFlight.get(id)}
                      pinned={layout.pinned.includes(id)}
                      onOpen={() => {
                        const f = skill.fills[id];
                        if (f !== undefined) onOpenFile(spec, f);
                      }}
                      onStart={() => onStartWork(spec)}
                      onOpenWork={onOpenWork}
                      onPin={() => togglePin(id)}
                      onRemove={() => removeBlock(id)}
                      onUp={() => move(id, -1)}
                      onDown={() => move(id, 1)}
                    />
                  );
                })}

                {/* the (+) tile — always last in the drawer */}
                <div className={SPAN_CLASS[3]}>
                  {adding === folder ? (
                    <div className="rounded-md border border-dashed border-amber-600 bg-surface p-3">
                      <p className="pb-2 font-mono text-[10px] uppercase tracking-wider text-amber-700">add a block to {FOLDER_LABEL[folder]}</p>
                      {addable.length === 0 && <p className="text-[11px] text-ink-muted">Every block this drawer offers is already on the card.</p>}
                      <div className="flex flex-col gap-1">
                        {addable.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => addBlock(b.id)}
                            className="rounded border border-border bg-canvas px-2 py-1.5 text-left hover:border-amber-600"
                          >
                            <span className="text-[12px]">{b.label}</span>
                            <span className="block font-mono text-[10px] text-ink-muted">{b.path}</span>
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => setAdding(null)} className="pt-2 font-mono text-[10px] uppercase text-ink-muted hover:text-ink">
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(folder)}
                      className="flex h-full min-h-[54px] w-full items-center justify-center rounded-md border border-dashed border-border text-ink-muted hover:border-amber-600 hover:text-amber-700"
                    >
                      <span className="font-mono text-[11px] uppercase tracking-wider">
                        + add a block{addable.length > 0 ? ` · ${addable.length} off the card` : ""}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPossible(true)}
                  className="pt-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted hover:text-ink"
                >
                  {hidden} more block{hidden === 1 ? "" : "s"} possible here — show them
                </button>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink/15 bg-paper-dark/40 px-6 py-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">every block is a file · every blank is a job</span>
        <span className="font-mono text-[10px] text-ink-muted">{skill.project}</span>
      </div>
    </article>
  );
}

function DrawerTab({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px rounded-t-lg border border-b-0 px-3 font-mono text-[11px] uppercase tracking-wide ${
        active ? "border-ink/40 bg-well pb-2 pt-2.5 text-ink" : "border-border bg-canvas py-1.5 text-ink-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// ------------------------------------------------------------------- block

function Block({
  spec,
  fill,
  work,
  pinned,
  onOpen,
  onStart,
  onOpenWork,
  onPin,
  onRemove,
  onUp,
  onDown,
}: {
  readonly spec: BlockSpec;
  readonly fill: Fill | undefined;
  readonly work: Work | undefined;
  readonly pinned: boolean;
  readonly onOpen: () => void;
  readonly onStart: () => void;
  readonly onOpenWork: (id: string) => void;
  readonly onPin: () => void;
  readonly onRemove: () => void;
  readonly onUp: () => void;
  readonly onDown: () => void;
}) {
  const blank = fill === undefined;

  return (
    <div
      className={`group relative flex flex-col rounded-md ${SPAN_CLASS[spec.span]} ${
        blank ? "border border-dashed border-border bg-canvas/50" : "border border-border bg-surface"
      }`}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <div className="min-w-0">
          <p className={`font-mono text-[10px] uppercase tracking-[0.12em] ${blank ? "text-ink-muted/60" : "text-ink-muted"}`}>{spec.label}</p>
          <p className={`truncate font-mono text-[10px] ${blank ? "text-ink-muted/40" : FOLDER_PATH_TINT[spec.folder]}`} title={spec.path}>
            {spec.path}
          </p>
        </div>
        {/* hover controls — the card is editable, quietly */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Ctl label="↑" title="Move up" onClick={onUp} />
          <Ctl label="↓" title="Move down" onClick={onDown} />
          <Ctl label={pinned ? "unpin" : "pin"} title="Show this block's headline in the glance band" onClick={onPin} />
          {spec.core === true ? (
            <span className="px-1 font-mono text-[10px] text-ink-muted/50" title="Core block — without this there is no skill">
              core
            </span>
          ) : (
            <Ctl label="✕" title="Remove this block from the card" onClick={onRemove} />
          )}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 px-3 pb-3 pt-2">
        {blank ? (
          <>
            <p className="text-[12px] leading-snug text-ink-muted/80">{spec.blurb}</p>
            {work === undefined ? (
              <button
                type="button"
                onClick={onStart}
                className="mt-2 rounded border border-dashed border-amber-600 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-700 hover:bg-amber-100"
              >
                {spec.work} ▸
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenWork(work.id)}
                className="mt-2 flex items-center gap-1.5 rounded border border-amber-600 bg-amber-100 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-800"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600" />
                on the board · {work.age}
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={onOpen} className="block w-full text-left" title={`Open ${spec.path}`}>
            <FillView fill={fill} />
          </button>
        )}
      </div>

      {work !== undefined && !blank && (
        <button
          type="button"
          onClick={() => onOpenWork(work.id)}
          className="flex items-center gap-1.5 border-t border-amber-600/40 bg-amber-100/60 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-800"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600" />
          being changed on the board · {work.title}
        </button>
      )}
    </div>
  );
}

function Ctl({ label, title, onClick }: { readonly label: string; readonly title: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded px-1 font-mono text-[10px] text-ink-muted hover:bg-canvas hover:text-ink"
    >
      {label}
    </button>
  );
}

// ------------------------------------------------------------- fill views

function FillView({ fill }: { readonly fill: Fill }) {
  switch (fill.kind) {
    case "prose":
      return (
        <div>
          <pre className="max-h-40 overflow-hidden whitespace-pre-wrap font-sans text-[12px] leading-snug text-ink [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
            {fill.text}
          </pre>
          <p className="pt-1 font-mono text-[10px] text-ink-muted">{fill.meta}</p>
        </div>
      );
    case "list":
      return (
        <ul className="flex flex-col gap-1">
          {fill.items.map((it) => (
            <li key={it.t} className="flex items-baseline gap-2 text-[12px]">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                <span className="text-ink">{it.t}</span>
                {it.d !== undefined && <span className="text-ink-muted"> — {it.d}</span>}
              </span>
            </li>
          ))}
        </ul>
      );
    case "files":
      return (
        <ul className="flex flex-col gap-1">
          {fill.files.map((f) => (
            <li key={f.name} className="text-[12px]">
              <span className="font-mono text-ink">{f.name}</span>
              <span className="text-ink-muted"> — {f.note}</span>
            </li>
          ))}
        </ul>
      );
    case "stat":
      return (
        <div>
          <p className={`font-mono text-2xl leading-none ${fill.tone === undefined ? "" : TONE_CLASS[fill.tone] ?? ""}`}>{fill.value}</p>
          <p className="pt-1 font-mono text-[10px] text-ink-muted">{fill.sub}</p>
        </div>
      );
    case "heat":
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {fill.groups.map((g) => (
            <div key={g.cat} className="flex flex-col gap-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{g.cat}</p>
              {g.cells.map((c) => (
                <span
                  key={c.label}
                  className={`rounded px-2 py-1 text-center font-mono text-[11px] ${HEAT_CLASS[String(c.heat)] ?? ""}`}
                >
                  {c.label}
                </span>
              ))}
              <p className="text-[10px] leading-tight text-ink-muted">{g.note}</p>
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              {fill.head.map((h, i) => (
                <th key={`${h}-${i}`} className="pb-1 pr-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fill.rows.map((r, ri) => (
              <tr key={`r${ri}`} className="border-t border-border">
                {r.map((c, ci) => (
                  <td key={`c${ci}`} className={`py-1.5 pr-2 ${ci === 0 ? "font-mono text-ink" : "text-ink-muted"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "lineage":
      return (
        <div className="flex flex-col gap-1">
          {fill.nodes.map((n) => (
            <div key={n.name} className={`flex items-baseline gap-2 text-[12px] ${n.mark === "└─" ? "pl-4" : ""}`}>
              <span className={`font-mono ${n.self === true ? "text-amber-700" : "text-ink-muted"}`}>{n.mark}</span>
              <span>
                <span className={`font-mono ${n.self === true ? "text-ink" : "text-ink"}`}>{n.name}</span>
                <span className="text-ink-muted"> · {n.note}</span>
              </span>
            </div>
          ))}
        </div>
      );
  }
}
