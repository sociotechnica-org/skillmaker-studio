/**
 * PROTOTYPE — the skill page (folder pass, 2026-08-05).
 *
 * TYPOGRAPHY FIX. The previous pass was unreadable, and the brand standard
 * says exactly why. `--font-mono` is NOT a monospace — it's aliased to
 * Special Elite, the distressed single-weight typewriter face
 * (`docs/library/brand/Reference - Typography.md`, viewer global.css:28).
 * The standard reserves it for "all-caps mono micro-labels with wide
 * tracking... the recurring structural device" — a garnish, not a body
 * face. I had it on paths, questions, sizes, breadcrumbs: 15 uses.
 *
 * Jess's own file tree (next/RightPanel.tsx) uses `font-mono` ZERO times.
 * Paths render in the body serif; real file contents escape to a true
 * monospace stack explicitly (RightPanel.tsx:292). That's the house rule,
 * and this file now follows it:
 *
 *   font-display  →  the skill's name. Once.
 *   font-mono     →  uppercase micro-labels only ("FILES", "STAGE"). Rare.
 *   body serif    →  every sentence, every folder, every file row.
 *   CODE          →  paths and file contents, in a REAL monospace.
 *
 * LAYOUT. Top half is prose — short sentences, normal font. Bottom half is
 * a folder list: collapsed by default, expand one to find its files. Root
 * files sit above the folders, because that's where they sit on disk.
 */
import { useState } from "react";
import { STAGE_TINT, type ManifestFile, type ProtoSkill, type Slot } from "./data.ts";

/** A real monospace — deliberately NOT `font-mono`, which is Special Elite. */
const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";
/** The brand's structural device: all-caps micro-label, wide tracking. */
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted";

const PINNED = ["Overview", "Research", "Eval", "Publish"] as const;
type PinnedTab = (typeof PINNED)[number];
type OpenTab = { readonly kind: "pinned"; readonly id: PinnedTab } | { readonly kind: "file"; readonly path: string };

const TAB_ACTIVE =
  "relative z-10 -mb-px flex items-center gap-1.5 rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-display text-[12px] text-ink";
const TAB_IDLE =
  "flex items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-display text-[12px] text-ink-muted hover:bg-well/70 hover:text-ink";

const same = (a: OpenTab, b: OpenTab) =>
  a.kind === b.kind && (a.kind === "pinned" ? a.id === (b as typeof a).id : a.path === (b as { path: string }).path);

export function SkillPane({ skill, initialFile = null }: { readonly skill: ProtoSkill; readonly initialFile?: string | null }) {
  const [open, setOpen] = useState<ReadonlyArray<string>>(initialFile === null ? [] : [initialFile]);
  const [active, setActive] = useState<OpenTab>(
    initialFile === null ? { kind: "pinned", id: "Overview" } : { kind: "file", path: initialFile },
  );

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
          return (
            <button key={id} type="button" onClick={() => setActive(tab)} className={same(active, tab) ? TAB_ACTIVE : TAB_IDLE}>
              {id}
            </button>
          );
        })}

        {open.length > 0 && <span className="mx-1.5 mb-2 h-4 w-px bg-border" />}

        {open.map((path) => {
          const tab: OpenTab = { kind: "file", path };
          const name = path.split("/").pop() ?? path;
          return (
            <span key={path} className={same(active, tab) ? TAB_ACTIVE : TAB_IDLE}>
              <button type="button" onClick={() => setActive(tab)} className={`max-w-[150px] truncate ${CODE} text-[11px]`} title={path}>
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
            <FileView skill={skill} path={active.path} />
          ) : active.id === "Overview" ? (
            <Overview skill={skill} onOpenFile={openFile} />
          ) : (
            <p className="text-sm text-ink-muted">Unchanged from the current build — this prototype only remodels Overview.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- top half

function Overview({ skill, onOpenFile }: { readonly skill: ProtoSkill; readonly onOpenFile: (path: string) => void }) {
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-display text-xl">{skill.name}</h1>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${STAGE_TINT[skill.stage]}`}>{skill.stage}</span>
      </div>

      {/* the madlib — plain sentences, body serif, no chrome */}
      <div className="flex flex-col gap-1.5 pt-4">
        {skill.slots.map((slot) => (
          <SlotLine key={slot.lead} slot={slot} onOpenFile={onOpenFile} />
        ))}
      </div>

      <Facts skill={skill} />
      <Files skill={skill} onOpenFile={onOpenFile} />
    </div>
  );
}

/** One sentence. A gap reads as a gap, quietly, and links to where it's written. */
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

function Facts({ skill }: { readonly skill: ProtoSkill }) {
  const facts: ReadonlyArray<readonly [string, string]> = [
    ["Stage", skill.stage],
    ["Version", skill.versionShort ?? "none"],
    ["Drift", skill.drift],
    ["Proven on", skill.provenOn],
    ["Coverage", skill.coverage],
  ];
  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 sm:grid-cols-5">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt className={LABEL}>{k}</dt>
          <dd className="pt-0.5 text-[13px] text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------- bottom half

type Group = { readonly name: string; readonly files: ReadonlyArray<ManifestFile> };

/** Root files first, then one group per top-level folder — like the disk. */
function group(files: ReadonlyArray<ManifestFile>): { readonly root: ReadonlyArray<ManifestFile>; readonly folders: ReadonlyArray<Group> } {
  const root: ManifestFile[] = [];
  const folders: Group[] = [];
  for (const f of files) {
    const cut = f.path.indexOf("/");
    if (cut === -1) {
      root.push(f);
      continue;
    }
    const name = f.path.slice(0, cut);
    const hit = folders.find((g) => g.name === name);
    if (hit === undefined) folders.push({ name, files: [f] });
    else (hit.files as ManifestFile[]).push(f);
  }
  return { root, folders };
}

function Files({ skill, onOpenFile }: { readonly skill: ProtoSkill; readonly onOpenFile: (path: string) => void }) {
  const { root, folders } = group(skill.files);
  const missing = skill.files.filter((f) => f.size === null).length;

  return (
    <>
      <div className="flex items-baseline justify-between pb-1 pt-8">
        <h2 className={LABEL}>Files</h2>
        <p className="text-[12px] text-ink-muted">
          {skill.files.length - missing} here{missing > 0 ? ` · ${missing} not yet` : ""}
        </p>
      </div>

      <div className="rounded border border-border bg-surface">
        {root.map((f) => (
          <FileRow key={f.path} file={f} onOpen={() => onOpenFile(f.path)} indent={false} />
        ))}
        {folders.map((g) => (
          <Folder key={g.name} group={g} onOpenFile={onOpenFile} />
        ))}
      </div>
    </>
  );
}

/** Collapsed by default: a folder is a lid, not a list. */
function Folder({ group: g, onOpenFile }: { readonly group: Group; readonly onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const missing = g.files.filter((f) => f.size === null).length;
  const here = g.files.length - missing;

  return (
    <div className="border-t border-border/70 first:border-t-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-well/60">
        <span className={`inline-block w-3 shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className={`${CODE} text-[13px] text-ink`}>{g.name}/</span>
        <span className="flex-1" />
        <span className="text-[12px] text-ink-muted">
          {here} file{here === 1 ? "" : "s"}
          {missing > 0 && <span className="text-amber-700"> · {missing} not yet</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/50 bg-canvas/40">
          {g.files.map((f) => (
            <FileRow key={f.path} file={f} onOpen={() => onOpenFile(f.path)} indent />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, onOpen, indent }: { readonly file: ManifestFile; readonly onOpen: () => void; readonly indent: boolean }) {
  const here = file.size !== null;
  // Inside a folder the leading directory is redundant — show the tail.
  const label = indent ? file.path.slice(file.path.indexOf("/") + 1) : file.path;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={file.path}
      className={`flex w-full items-baseline gap-2 border-t border-border/50 px-3 py-1.5 text-left first:border-t-0 hover:bg-well/60 ${
        indent ? "pl-8" : ""
      }`}
    >
      <span className={`shrink-0 text-[10px] ${here ? "text-emerald-700" : "text-ink-muted/40"}`}>{here ? "●" : "○"}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${CODE} text-[13px] ${here ? "text-ink" : "text-ink-muted/70"}`}>{label}</span>
        <span className="block text-[12px] leading-snug text-ink-muted">{file.why}</span>
        {!here && file.how !== null && <span className="block text-[12px] leading-snug text-amber-700">{file.how}</span>}
      </span>
      <span className="shrink-0 text-[11px] text-ink-muted/70">{file.size === null ? "not yet" : `${(file.size / 1024).toFixed(1)} KB`}</span>
    </button>
  );
}

// ------------------------------------------------------------- file viewer

function FileView({ skill, path }: { readonly skill: ProtoSkill; readonly path: string }) {
  const file = skill.files.find((f) => f.path === path);
  const content = skill.contents[path];
  const slots = skill.slots.filter((s) => s.source === path && s.value === null);

  return (
    <div className="max-w-3xl">
      <p className={`pb-1 ${CODE} text-[13px] text-ink`}>{path}</p>
      {file !== undefined && <p className="pb-3 text-[13px] text-ink-muted">{file.why}</p>}

      {file !== undefined && file.size === null ? (
        <div className="rounded border border-dashed border-amber-600/60 bg-canvas/60 p-4">
          <p className={LABEL}>This file doesn't exist yet</p>
          {file.how !== null && <p className="pt-2 text-[14px] leading-relaxed text-ink">{file.how}</p>}
          {slots.length > 0 && (
            <>
              <p className="pt-4 text-[13px] text-ink-muted">It would answer:</p>
              <ul className="flex flex-col gap-2 pt-2">
                {slots.map((s) => (
                  <li key={s.lead} className="text-[14px] leading-relaxed text-ink">
                    {s.question}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : content === undefined ? (
        <p className="rounded border border-border bg-surface p-3 text-[13px] text-ink-muted">
          No preview in the prototype — the real viewer renders this from the files endpoint.
        </p>
      ) : (
        <pre className={`overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-surface p-3 text-xs leading-relaxed ${CODE}`}>
          {content}
        </pre>
      )}
    </div>
  );
}
