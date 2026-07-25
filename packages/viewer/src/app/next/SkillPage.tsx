/**
 * The Skill page center panel (redesign, 2026-07-25): identity header with
 * top-right actions, manila-folder tabs — Overview · Research · Eval ·
 * Publish — and a TOP-LEVEL version pivot: every tab is a lens on the
 * selected draft ("Current draft" = the unversioned working state).
 * Non-versioned surfaces hold steady with a quiet note.
 */
import { useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "../components/Markdown.tsx";
import { fetchBundleFile, useApiData } from "./api.ts";
import { EvalsSection } from "./EvalsSection.tsx";
import { ReviewSurface } from "./ReviewSurface.tsx";

import { STAGE_TINT } from "./ui.tsx";
import type { SkillPage as SkillPageData, SkillVersion } from "./types.ts";

type CenterTab = "overview" | "research" | "eval" | "publish";

const TAB_ACTIVE =
  "relative z-10 -mb-px rounded-t-lg border border-b-0 border-neutral-900/50 bg-surface px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-ink";
const TAB_IDLE =
  "rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-ink-muted hover:text-ink";

/** "Current draft" sentinel for the top-level version pivot. */
const CURRENT = "current";

export function SkillPageView({
  slug,
  page,
  onOpenFile,
}: {
  readonly slug: string;
  readonly page: SkillPageData;
  readonly onOpenFile: (path: string) => void;
}) {
  const [tab, setTab] = useState<CenterTab>("overview");
  const [pinned, setPinned] = useState<string>(CURRENT);
  // Unread dots: the newest event of each family, compared to a per-skill
  // "last seen" stamp (localStorage). Research listens to station/review
  // traffic; Eval listens to run traffic (ruled 2026-07-25).
  const stampOf = (prefixes: ReadonlyArray<string>): string => {
    const hit = page.events.find((e) => prefixes.some((p) => e.type.startsWith(p)));
    return hit === undefined ? "" : `${hit.type}-${hit.at}`;
  };
  const researchStamp = stampOf(["station.", "review."]);
  const runStamp = stampOf(["run."]);
  const [seen, setSeen] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(`sm-tab-seen-${slug}`) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const markSeen = (key: "research" | "eval", stamp: string) => {
    const next = { ...seen, [key]: stamp };
    setSeen(next);
    try {
      window.localStorage.setItem(`sm-tab-seen-${slug}`, JSON.stringify(next));
    } catch {}
  };
  const showResearchDot = tab !== "research" && researchStamp !== "" && seen.research !== researchStamp;
  const showEvalDot = tab !== "eval" && runStamp !== "" && seen.eval !== runStamp;

  const openResearch = () => {
    setTab("research");
    markSeen("research", researchStamp);
  };
  const openEval = () => {
    setTab("eval");
    markSeen("eval", runStamp);
  };

  return (
    <div className="mx-auto max-w-3xl px-6 pb-6 pt-4">
      {/* ---- identity header: the skill, then its status, then actions ---- */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight">{page.name}</h1>
          <p className="pt-0.5 text-sm text-ink-muted">{page.oneLiner || "No one-liner yet."}</p>
          <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 ${STAGE_TINT[page.stage]}`}>{page.stage}</span>
            <span className="text-ink-muted">{page.drift}</span>
            <VersionPicker versions={page.versions} pinned={pinned} onPin={setPinned} />
          </div>
        </div>
        <HeaderActions onPublishTab={() => setTab("publish")} />
      </div>

      {page.loop !== null && (
        <div className="pt-4">
          <ReviewSurface loop={page.loop} />
        </div>
      )}

      {/* ---- folder tabs ---- */}
      <div className="mt-5 flex items-end gap-1">
        {(
          [
            { id: "overview", label: "Overview", onClick: () => setTab("overview"), dot: false },
            { id: "research", label: "Research", onClick: openResearch, dot: showResearchDot },
            { id: "eval", label: "Eval", onClick: openEval, dot: showEvalDot },
            { id: "publish", label: "Publish", onClick: () => setTab("publish"), dot: false },
          ] as const
        ).map((t) => (
          <button key={t.id} type="button" onClick={t.onClick} className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}>
            {t.label}
            {t.dot && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
          </button>
        ))}
      </div>
      <div className="rounded-b-lg rounded-tr-lg border border-neutral-900/50 bg-surface p-4">
        {tab === "overview" && <OverviewTab slug={slug} page={page} pinned={pinned} onOpenFile={onOpenFile} />}
        {tab === "research" && <ResearchTab slug={slug} pinned={pinned} onOpenFile={onOpenFile} />}
        {tab === "eval" && <EvalsSection page={page} />}
        {tab === "publish" && <PublishTab page={page} pinned={pinned} onPin={setPinned} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- header bits

function VersionPicker({
  versions,
  pinned,
  onPin,
}: {
  readonly versions: ReadonlyArray<SkillVersion>;
  readonly pinned: string;
  readonly onPin: (v: string) => void;
}) {
  return (
    <select
      className="cursor-pointer rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-ink-muted outline-none hover:text-ink"
      value={pinned}
      onChange={(e) => onPin(e.target.value)}
      title="Every tab is a lens on the selected draft"
    >
      <option value={CURRENT}>Current draft</option>
      {versions.map((v) => (
        <option key={v.hash} value={v.hash}>
          {v.shortHash}
          {v.label !== null ? ` · ${v.label}` : ""}
        </option>
      ))}
    </select>
  );
}

function HeaderActions({ onPublishTab }: { readonly onPublishTab: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 pt-1">
      <button
        type="button"
        className="rounded bg-amber-600 px-3 py-1.5 font-display text-sm text-white shadow hover:bg-amber-700"
        onClick={onPublishTab}
      >
        Publish…
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- tabs

function OverviewTab({
  slug,
  page,
  pinned,
  onOpenFile,
}: {
  readonly slug: string;
  readonly page: SkillPageData;
  readonly pinned: string;
  readonly onOpenFile: (path: string) => void;
}) {
  return (
    <div className="text-sm">
      {pinned !== CURRENT && (
        <p className="pb-2 text-xs text-ink-muted">Showing the current draft — historical snapshots arrive with the version store.</p>
      )}
      {page.instructions === null ? (
        <p className="text-ink-muted">No SKILL.md yet — start a chat and frame it.</p>
      ) : (
        <>
          <MarkdownContent markdown={firstSection(page.instructions)} />
          <button
            type="button"
            className="mt-3 rounded border border-border bg-canvas px-3 py-1.5 font-display text-xs text-ink-muted hover:text-ink"
            onClick={() => onOpenFile("output/SKILL.md")}
          >
            Open full SKILL.md in Files
          </button>
        </>
      )}
    </div>
  );
}

/** The summary slice of SKILL.md: everything before the second heading. */
function firstSection(markdown: string): string {
  const lines = markdown.split("\n");
  let headings = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (/^#{1,3} /.test(line)) {
      headings += 1;
      if (headings === 2) break;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

const RESEARCH_FILES = ["research/notes.md", "research/decisions.md"] as const;

function ResearchTab({
  slug,
  pinned,
  onOpenFile,
}: {
  readonly slug: string;
  readonly pinned: string;
  readonly onOpenFile: (path: string) => void;
}) {
  const fetcher = useCallback(async () => {
    const results = await Promise.all(
      RESEARCH_FILES.map((path) =>
        fetchBundleFile(slug, path).then(
          (content) => ({ path, content }),
          () => null,
        ),
      ),
    );
    return results.filter((r) => r !== null).map((r) => ({ path: r.path as string, content: r.content }));
  }, [slug]);
  const files = useApiData(fetcher, null);

  return (
    <div className="text-sm">
      {pinned !== CURRENT && <p className="pb-2 text-xs text-ink-muted">Research is bundle-level — not versioned.</p>}
      {files === null && <p className="text-ink-muted">Loading research…</p>}
      {files !== null && files.length === 0 && (
        <p className="text-ink-muted">No research yet — run the research station or ask the agent to gather sources.</p>
      )}
      {files !== null &&
        files.map((f) => (
          <details key={f.path} open={f.path.endsWith("notes.md")} className="mb-3">
            <summary className="cursor-pointer font-display text-xs uppercase text-ink-muted hover:text-ink">
              {f.path.replace("research/", "")}
              <button
                type="button"
                className="ml-2 text-[10px] underline"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenFile(f.path);
                }}
              >
                open in Files
              </button>
            </summary>
            <div className="max-h-96 overflow-y-auto pt-1">
              <MarkdownContent markdown={f.content} />
            </div>
          </details>
        ))}
    </div>
  );
}

function PublishTab({
  page,
  pinned,
  onPin,
}: {
  readonly page: SkillPageData;
  readonly pinned: string;
  readonly onPin: (v: string) => void;
}) {
  return (
    <div className="text-sm">
      <p className="text-ink-muted">
        Publishing writes the selected draft over the skill's live <span className="font-mono text-xs">SKILL.md</span>, stamped
        with its evidence state.
      </p>

      <h3 className="pt-3 font-display text-xs uppercase text-ink-muted">Versions</h3>
      <div className="mt-1 space-y-1">
        <VersionRow
          active={pinned === CURRENT}
          title="Current draft"
          subtitle={page.drift}
          onClick={() => onPin(CURRENT)}
          action={
            <button
              type="button"
              className="rounded bg-amber-600 px-2.5 py-1 font-display text-xs text-white opacity-50"
              title="Publish flow lands with the version snapshot store — design in progress"
              disabled
            >
              Publish
            </button>
          }
        />
        {page.versions.map((v) => (
          <VersionRow
            key={v.hash}
            active={pinned === v.hash}
            title={v.shortHash + (v.label !== null ? ` · ${v.label}` : "")}
            subtitle={`recorded ${new Date(v.recordedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            onClick={() => onPin(v.hash)}
            action={
              <button
                type="button"
                className="rounded border border-border px-2.5 py-1 font-display text-xs text-ink-muted opacity-50"
                title="Revert requires the version snapshot store (versions are hashes today, not content)"
                disabled
              >
                Revert
              </button>
            }
          />
        ))}
        {page.versions.length === 0 && <p className="text-xs text-ink-muted">No versions recorded yet.</p>}
      </div>
      <p className="pt-3 text-xs text-ink-muted">
        Evidence per version lives in the Eval tab — pin a version above and switch tabs to see its measurements.
      </p>
    </div>
  );
}

function VersionRow({
  active,
  title,
  subtitle,
  action,
  onClick,
}: {
  readonly active: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly action: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${active ? "border-amber-400 bg-canvas" : "border-border"}`}
    >
      <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
        <span className="font-mono text-xs">{title}</span>
        <span className="pl-2 text-xs text-ink-muted">{subtitle}</span>
      </button>
      {action}
    </div>
  );
}
