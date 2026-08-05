/**
 * PROTOTYPE — the skill page (madlibs pass, 2026-08-05).
 *
 * Three moves, all from the director's sketch:
 *
 * 1. OVERVIEW IS UNDIVIDED. No rail, no split, no two-column reading
 *    surface. One column, top to bottom. Static — it is a thing you read,
 *    not a workspace.
 *
 * 2. MADLIB SENTENCES ON TOP. Plain sentences about the skill, each one a
 *    lead-in plus a slot. The slots come from prior art we already own —
 *    Playmaker's synopsis fused with the dossier, whose six sections were
 *    ruled and shipped (packages/core/src/Dossier.ts:32). An unfilled slot
 *    renders in place, gray, carrying the scaffold's own question. That is
 *    the library card's rule, not a new one: "an unanswered section is an
 *    honest gap, not a defect... named plainly, and nothing blocks on it."
 *
 * 3. THEN THE FILES — and this is where the blanks live. Every file the
 *    bundle has, plus every file it could have, in one list. A missing one
 *    is gray and says how to bring it into being (`skillmaker dossier`,
 *    `skillmaker fixture add`, run the researching station).
 *
 * Opening a file opens A NEW TAB, like a browser. Overview · Research ·
 * Eval · Publish are pinned; files pile up to their right with a ✕ each.
 * Want to read twelve files at once? Twelve tabs. Viewing is solved by
 * the tab system, so Overview never has to become a workspace.
 */
import { useState } from "react";
import { STAGE_TINT, type ManifestFile, type ProtoSkill, type Slot } from "./data.ts";

const PINNED = ["Overview", "Research", "Eval", "Publish"] as const;
type PinnedTab = (typeof PINNED)[number];
/** A tab is one of the four pinned surfaces, or an open file path. */
type OpenTab = { readonly kind: "pinned"; readonly id: PinnedTab } | { readonly kind: "file"; readonly path: string };

const TAB_ACTIVE =
  "relative z-10 -mb-px flex items-center gap-1.5 rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-ink";
const TAB_IDLE =
  "flex items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-ink-muted hover:bg-well/70 hover:text-ink";

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
    // Closing the tab you're on falls back to its neighbour, then Overview
    // — the same thing a browser does.
    if (active.kind === "file" && active.path === path) {
      const i = open.indexOf(path);
      const neighbour = next[Math.min(i, next.length - 1)];
      setActive(neighbour === undefined ? { kind: "pinned", id: "Overview" } : { kind: "file", path: neighbour });
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* the tab bar — four pinned surfaces, then whatever you've opened */}
      <div className="flex flex-wrap items-end gap-1 px-6 pt-4">
        {PINNED.map((id) => {
          const tab: OpenTab = { kind: "pinned", id };
          return (
            <button key={id} type="button" onClick={() => setActive(tab)} className={same(active, tab) ? TAB_ACTIVE : TAB_IDLE}>
              {id}
            </button>
          );
        })}

        {open.length > 0 && <span className="mx-1 mb-1.5 h-4 w-px bg-border" />}

        {open.map((path) => {
          const tab: OpenTab = { kind: "file", path };
          const name = path.split("/").pop() ?? path;
          return (
            <span key={path} className={same(active, tab) ? TAB_ACTIVE : TAB_IDLE}>
              <button type="button" onClick={() => setActive(tab)} className="max-w-[160px] truncate normal-case" title={path}>
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

// ---------------------------------------------------------------- overview

function Overview({ skill, onOpenFile }: { readonly skill: ProtoSkill; readonly onOpenFile: (path: string) => void }) {
  const missing = skill.files.filter((f) => f.size === null).length;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-display text-xl">{skill.name}</h1>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STAGE_TINT[skill.stage]}`}>{skill.stage}</span>
      </div>
      <p className="pt-1 font-mono text-[12px] text-ink-muted">{skill.slug}</p>

      {/* the madlib ------------------------------------------------------ */}
      <div className="flex flex-col gap-2.5 pt-6">
        {skill.slots.map((slot) => (
          <SlotLine key={slot.lead} slot={slot} />
        ))}
      </div>

      {/* the five facts the page already computes, kept quiet ------------- */}
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 sm:grid-cols-5">
        {(
          [
            ["Stage", skill.stage],
            ["Version", skill.versionShort ?? "none recorded"],
            ["Drift", skill.drift],
            ["Proven on", skill.provenOn],
            ["Coverage", skill.coverage],
          ] as ReadonlyArray<readonly [string, string]>
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">{k}</dt>
            <dd className="pt-0.5 font-mono text-[12px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      {/* the files ------------------------------------------------------- */}
      <div className="flex items-baseline justify-between pb-2 pt-8">
        <h2 className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">files</h2>
        <p className="font-mono text-[10px] text-ink-muted">
          {skill.files.length - missing} here · {missing} not yet
        </p>
      </div>
      <div className="flex flex-col">
        {skill.files.map((f) => (
          <FileRow key={f.path} file={f} onOpen={() => onOpenFile(f.path)} />
        ))}
      </div>
      <p className="pt-3 text-[12px] text-ink-muted">Opening a file opens a tab. Close it with the ✕.</p>
    </div>
  );
}

/** One madlib line: a lead-in, then either the sentence or an honest gap. */
function SlotLine({ slot }: { readonly slot: Slot }) {
  return (
    <p className="text-[15px] leading-relaxed">
      <span className="pr-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{slot.lead}</span>
      {slot.value === null ? (
        <span
          className="rounded border border-dashed border-border bg-canvas/60 px-2 py-0.5 text-[13px] italic text-ink-muted/80"
          title={`Answer this in ${slot.source}`}
        >
          {slot.question} <span className="not-italic font-mono text-[10px]">— {slot.source}</span>
        </span>
      ) : (
        <span className="text-ink">{slot.value}</span>
      )}
    </p>
  );
}

/** One file row. Missing files are gray and say how to make them exist. */
function FileRow({ file, onOpen }: { readonly file: ManifestFile; readonly onOpen: () => void }) {
  const here = file.size !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-baseline gap-3 border-b border-border/70 px-1 py-2 text-left last:border-b-0 ${
        here ? "hover:bg-surface" : "hover:bg-canvas/60"
      }`}
    >
      <span className={`shrink-0 font-mono text-[10px] ${here ? "text-emerald-700" : "text-ink-muted/50"}`}>{here ? "●" : "○"}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-mono text-[13px] ${here ? "text-ink" : "text-ink-muted/70"}`}>{file.path}</span>
        <span className="block text-[12px] leading-snug text-ink-muted">{file.why}</span>
        {!here && file.how !== null && <span className="block pt-0.5 text-[12px] leading-snug text-amber-700">{file.how}</span>}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-ink-muted/70">
        {file.size === null ? "not yet" : `${(file.size / 1024).toFixed(1)} KB`}
      </span>
    </button>
  );
}

// ------------------------------------------------------------- file viewer

function FileView({ skill, path }: { readonly skill: ProtoSkill; readonly path: string }) {
  const file = skill.files.find((f) => f.path === path);
  const content = skill.contents[path];

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-1 pb-1 text-xs">
        <span className="text-ink-muted">{skill.slug}</span>
        {path.split("/").map((segment, i, all) => (
          <span key={`${segment}-${i}`} className="flex items-center gap-1">
            <span className="text-ink-muted">›</span>
            <span className={i === all.length - 1 ? "font-display" : "text-ink-muted"}>{segment}</span>
          </span>
        ))}
      </div>
      {file !== undefined && <p className="pb-3 text-[12px] text-ink-muted">{file.why}</p>}

      {file !== undefined && file.size === null ? (
        <div className="rounded border border-dashed border-amber-600/60 bg-canvas/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-amber-700">this file doesn't exist yet</p>
          {file.how !== null && <p className="pt-2 text-[13px] leading-relaxed text-ink">{file.how}</p>}
        </div>
      ) : content === undefined ? (
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
