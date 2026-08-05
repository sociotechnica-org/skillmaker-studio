/**
 * PROTOTYPE — the skill page (redo, 2026-08-05).
 *
 * The brief: simplify, and build it out of what Jess already shipped. So
 * this is a REMIX, not an invention. Everything here already exists in the
 * build; the only thing that changes is WHERE it lives.
 *
 *   kept  · the four folder tabs (Overview · Research · Eval · Publish)
 *   kept  · the file tree, chevrons and all, straight off the right panel
 *   kept  · the five facts from the little overview card
 *           (stage · version · drift · proven on · coverage)
 *   moved · the tree and the file viewer, out of the chat panel and into
 *           the CENTER, which is the whole point:
 *
 *              a viewing surface that is not also the chat window.
 *
 * The Overview tab is therefore two things side by side — a directory on
 * the left, a reading surface on the right. The reading surface opens on a
 * plain-English description of the skill and its three key files; click
 * anything and it shows that file instead. Chat is elsewhere, and stays
 * elsewhere.
 *
 * What's deliberately NOT here: risk heat maps, model split-test tables,
 * growth plays, lineage graphs, composable block wells. That was sketch
 * v0, and it was a card for a product that doesn't exist yet.
 */
import { useState } from "react";
import { STAGE_TINT, type ProtoFile, type ProtoSkill } from "./data.ts";

type Tab = "overview" | "research" | "eval" | "publish";

const TAB_ACTIVE =
  "relative z-10 -mb-px rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-ink";
const TAB_IDLE =
  "rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-ink-muted hover:bg-well/70 hover:text-ink";

export function SkillPane({ skill, initialFile = null }: { readonly skill: ProtoSkill; readonly initialFile?: string | null }) {
  const [tab, setTab] = useState<Tab>("overview");
  // The selected file lives at the page level, not inside the tree, so
  // switching tabs and coming back keeps your place. Seeded from the URL:
  // a file is a place you can link someone to, which it never was when it
  // lived inside a chat panel's tab.
  const [selected, setSelected] = useState<string | null>(initialFile);

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pt-4">
        <div className="flex items-end gap-1">
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "research", label: "Research" },
              { id: "eval", label: "Eval" },
              { id: "publish", label: "Publish" },
            ] as const
          ).map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 border-t border-neutral-900/50 bg-well">
        {tab === "overview" ? (
          <OverviewTab skill={skill} selected={selected} onSelect={setSelected} />
        ) : (
          <div className="px-6 py-5 text-sm text-ink-muted">
            Unchanged from the current build — this prototype only remodels Overview.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- the overview tab

function OverviewTab({
  skill,
  selected,
  onSelect,
}: {
  readonly skill: ProtoSkill;
  readonly selected: string | null;
  readonly onSelect: (path: string | null) => void;
}) {
  return (
    <div className="flex min-h-full">
      {/* the directory — Jess's tree, just living here now */}
      <div className="w-[230px] shrink-0 border-r border-border/70 px-2 py-4">
        <p className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">key files</p>
        {skill.keyFiles.map((k) => (
          <button
            key={k.path}
            type="button"
            onClick={() => onSelect(k.path)}
            title={k.why}
            className={`mb-0.5 block w-full truncate rounded px-2 py-1 text-left font-mono text-[12px] ${
              selected === k.path ? "bg-surface text-ink shadow-sm" : "text-ink hover:bg-surface/60"
            }`}
          >
            {k.path}
          </button>
        ))}

        <p className="px-1 pb-1 pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-muted">all files</p>
        <Tree files={skill.files} selected={selected} onSelect={onSelect} />

        {selected !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="mt-4 px-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted hover:text-ink"
          >
            ← back to overview
          </button>
        )}
      </div>

      {/* the reading surface — NOT the chat window */}
      <div className="min-w-0 flex-1 px-6 py-5">
        {selected === null ? <PlainEnglish skill={skill} onSelect={onSelect} /> : <FileView skill={skill} path={selected} />}
      </div>
    </div>
  );
}

/** The whole "baseball card", as simple as it can honestly be today. */
function PlainEnglish({ skill, onSelect }: { readonly skill: ProtoSkill; readonly onSelect: (path: string) => void }) {
  const facts: ReadonlyArray<readonly [string, string]> = [
    ["Stage", skill.stage],
    ["Version", skill.versionShort ?? "none recorded"],
    ["Drift", skill.drift],
    ["Proven on", skill.provenOn],
    ["Coverage", skill.coverage],
  ];

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-display text-xl">{skill.name}</h1>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STAGE_TINT[skill.stage]}`}>{skill.stage}</span>
      </div>
      <p className="pt-2 font-mono text-[12px] text-ink-muted">{skill.slug}</p>

      <p className="pt-4 text-[15px] leading-relaxed text-ink">{skill.oneLiner}</p>
      <p className="pt-3 text-sm leading-relaxed text-ink-muted">{skill.summary}</p>

      {/* the five facts — the existing overview card, inline and unbolted */}
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">{k}</dt>
            <dd className="pt-0.5 font-mono text-[12px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      {/* the directory, as the thing you actually came for */}
      <h2 className="pb-2 pt-7 font-mono text-[10px] uppercase tracking-wider text-ink-muted">key files</h2>
      <div className="flex flex-col gap-1.5">
        {skill.keyFiles.map((k) => (
          <button
            key={k.path}
            type="button"
            onClick={() => onSelect(k.path)}
            className="rounded border border-border bg-surface px-3 py-2 text-left hover:border-amber-600"
          >
            <span className="font-mono text-[13px] text-ink">{k.path}</span>
            <span className="block pt-0.5 text-[12px] text-ink-muted">{k.why}</span>
          </button>
        ))}
      </div>
      <p className="pt-3 text-[12px] text-ink-muted">Everything else is in the tree on the left.</p>
    </div>
  );
}

function FileView({ skill, path }: { readonly skill: ProtoSkill; readonly path: string }) {
  const content = skill.contents[path];
  const why = skill.keyFiles.find((k) => k.path === path)?.why;

  return (
    <div className="max-w-3xl">
      {/* breadcrumb, same as the panel's */}
      <div className="flex flex-wrap items-center gap-1 pb-1 text-xs">
        <span className="text-ink-muted">{skill.slug}</span>
        {path.split("/").map((segment, i, all) => (
          <span key={`${segment}-${i}`} className="flex items-center gap-1">
            <span className="text-ink-muted">›</span>
            <span className={i === all.length - 1 ? "font-display" : "text-ink-muted"}>{segment}</span>
          </span>
        ))}
      </div>
      {why !== undefined && <p className="pb-3 text-[12px] text-ink-muted">{why}</p>}

      {content === undefined ? (
        <p className="rounded border border-border bg-surface p-3 text-sm text-ink-muted">
          No preview in the prototype — the real viewer renders this from <span className="font-mono">/api/bundles/…/files</span>.
        </p>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-surface p-3 text-xs leading-relaxed [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
          {content}
        </pre>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- tree

type TreeDir = { readonly name: string; readonly path: string; readonly dirs: TreeDir[]; readonly files: ProtoFile[] };

/** Same shape as the right panel's buildTree — a flat path list, nested. */
function buildTree(files: ReadonlyArray<ProtoFile>): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = segments.slice(0, i + 1).join("/");
      let next = node.dirs.find((d) => d.path === dirPath);
      if (next === undefined) {
        next = { name: segments[i] ?? "", path: dirPath, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}

function Tree({
  files,
  selected,
  onSelect,
}: {
  readonly files: ReadonlyArray<ProtoFile>;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}) {
  return <DirChildren dir={buildTree(files)} depth={0} selected={selected} onSelect={onSelect} />;
}

function DirChildren({
  dir,
  depth,
  selected,
  onSelect,
}: {
  readonly dir: TreeDir;
  readonly depth: number;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}) {
  return (
    <>
      {dir.dirs.map((d) => (
        <DirSection key={d.path} dir={d} depth={depth} selected={selected} onSelect={onSelect} />
      ))}
      {dir.files.map((f) => {
        const name = f.path.split("/").pop() ?? f.path;
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            title={f.path}
            className={`block w-full truncate rounded py-0.5 pr-1 text-left text-[12px] ${
              f.path === selected ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface/60"
            }`}
            style={{ paddingLeft: 18 + depth * 12 }}
          >
            {name}
          </button>
        );
      })}
    </>
  );
}

function DirSection({
  dir,
  depth,
  selected,
  onSelect,
}: {
  readonly dir: TreeDir;
  readonly depth: number;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}) {
  // Deep fixture/run directories start closed — the tree should open on
  // something a person can read, not 30 transcript rows.
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={dir.path}
        className="flex w-full items-center gap-1 rounded py-0.5 text-left text-[12px] text-ink-muted hover:bg-surface/60"
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <span className={`inline-block shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className="min-w-0 flex-1 truncate">{dir.name}/</span>
      </button>
      {open && <DirChildren dir={dir} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </div>
  );
}
