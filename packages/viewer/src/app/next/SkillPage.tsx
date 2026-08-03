/**
 * The Skill page center panel (redesign, 2026-07-25): manila-folder tabs —
 * Overview · Research · Eval · Publish — over a full-bleed surface (a
 * separator line, not a bounding box). Identity lives in the top bar
 * breadcrumb; version pivot + Publish live in the top bar too
 * (TopBarSkillControls, rendered by NextShell). Every tab is a lens on
 * the selected draft ("Current draft" = the unversioned working state).
 */
import { useCallback, useState } from "react";
import { MarkdownContent } from "../components/Markdown.tsx";
import { fetchBundleFile, postPublish, useApiData } from "./api.ts";
import { EvalsSection } from "./EvalsSection.tsx";
import { AdvanceControls, ReviewSurface } from "./ReviewSurface.tsx";
import type { SkillPage as SkillPageData, SkillVersion } from "./types.ts";

type CenterTab = "overview" | "research" | "eval" | "publish";

const TAB_ACTIVE =
  "relative z-10 -mb-px cursor-pointer rounded-t-lg border border-b-0 border-neutral-900/50 bg-well px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-ink";
const TAB_IDLE =
  "cursor-pointer rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-ink-muted hover:bg-well/70 hover:text-ink";

/** "Current draft" sentinel for the top-level version pivot. */
export const CURRENT_DRAFT = "current";

export function SkillPageView({
  slug,
  page,
  pinned,
  onOpenFile,
  rightInset = false,
}: {
  readonly slug: string;
  readonly page: SkillPageData;
  readonly pinned: string;
  readonly onOpenFile: (path: string) => void;
  /** True while the overview card floats over the right edge: CONTENT makes room, but the full-bleed surface + separator keep painting beneath the card. */
  readonly rightInset?: boolean;
}) {
  const [tab, setTab] = useState<CenterTab>("overview");

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

  return (
    <div className="flex min-h-full flex-col">
      <div className="w-full px-6 pt-4 transition-[padding] duration-200 ease-out" style={{ paddingRight: rightInset ? 268 : 24 }}>
        <div className="mx-auto max-w-3xl">
          {page.loop !== null && <ReviewSurface loop={page.loop} />}

          {/* folder tabs, sitting on the full-width separator below */}
          <div className="flex items-end gap-1">
            {(
              [
                { id: "overview", label: "Overview", onClick: () => setTab("overview"), dot: false },
                { id: "research", label: "Research", onClick: () => { setTab("research"); markSeen("research", researchStamp); }, dot: showResearchDot },
                { id: "eval", label: "Eval", onClick: () => { setTab("eval"); markSeen("eval", runStamp); }, dot: showEvalDot },
                { id: "publish", label: "Publish", onClick: () => setTab("publish"), dot: false },
              ] as const
            ).map((t) => (
              <button key={t.id} type="button" onClick={t.onClick} className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}>
                {t.label}
                {t.dot && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* full-bleed tab surface: separator line + tinted ground to the
          bottom. The inset is padding INSIDE this layer so the well and its
          separator keep painting under the floating overview card. */}
      <div className="flex-1 border-t border-neutral-900/50 bg-well transition-[padding] duration-200 ease-out" style={{ paddingRight: rightInset ? 244 : 0 }}>
        <div className="mx-auto max-w-3xl px-6 py-5">
          {tab === "overview" && <OverviewTab page={page} pinned={pinned} onOpenFile={onOpenFile} />}
          {tab === "research" && <ResearchTab slug={slug} onOpenFile={onOpenFile} />}
          {tab === "eval" && <EvalsSection page={page} />}
          {tab === "publish" && <PublishTab slug={slug} page={page} pinned={pinned} />}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------- top bar controls

/**
 * Rendered by NextShell in the center top bar: the version pivot and the
 * Publish button (stage actions live in its popover — no duplication).
 */
export function TopBarSkillControls({
  slug,
  page,
  pinned,
  onPin,
}: {
  readonly slug: string;
  readonly page: SkillPageData;
  readonly pinned: string;
  readonly onPin: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const pinnedVersion = page.versions.find((v: SkillVersion) => v.hash === pinned);
  return (
    <div className="relative flex items-center gap-1.5">
      {/* Time-Machine-style version pivot: an icon, not a native select —
          the top bar stays narrow; the history lives in a popover. Amber
          when pinned to the past so "you are not looking at now" is loud. */}
      <button
        type="button"
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded hover:bg-surface ${
          pinned === CURRENT_DRAFT ? "text-ink-muted hover:text-ink" : "bg-amber-600/15 text-amber-700"
        }`}
        title={
          pinned === CURRENT_DRAFT
            ? "Version history — every tab is a lens on the selected draft"
            : `Viewing version ${pinnedVersion?.shortHash ?? pinned} — click to change`
        }
        onClick={() => {
          setVersionsOpen(!versionsOpen);
          setOpen(false);
        }}
      >
        <TimeMachineIcon />
      </button>
      {versionsOpen && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setVersionsOpen(false)}
          />
          <div className="absolute right-0 top-9 z-30 w-56 rounded border border-border bg-surface py-1 shadow-xl">
            <VersionMenuRow
              selected={pinned === CURRENT_DRAFT}
              label="Current draft"
              detail={null}
              onPick={() => {
                onPin(CURRENT_DRAFT);
                setVersionsOpen(false);
              }}
            />
            {page.versions.length > 0 && <div className="mx-2 my-1 border-t border-border" />}
            {page.versions.map((v: SkillVersion) => (
              <VersionMenuRow
                key={v.hash}
                selected={pinned === v.hash}
                label={v.shortHash}
                detail={v.label}
                onPick={() => {
                  onPin(v.hash);
                  setVersionsOpen(false);
                }}
              />
            ))}
            {page.versions.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-ink-muted">No recorded versions yet.</p>
            )}
          </div>
        </>
      )}
      <button
        type="button"
        className="cursor-pointer rounded bg-amber-600 px-3 py-1 font-display text-sm text-white shadow hover:bg-amber-700"
        onClick={() => {
          setOpen(!open);
          setVersionsOpen(false);
        }}
      >
        Publish
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-9 z-30 w-72 rounded border border-border bg-surface p-3 shadow-xl">
            {page.loop === null ? (
              <p className="text-xs text-ink-muted">Stage actions need the server.</p>
            ) : (
              <AdvanceControls loop={page.loop} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Apple-Time-Machine-ish glyph: a clock face wrapped in a counterclockwise
    orbit arrow — "step back through this skill's history". */
function TimeMachineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* orbit arrow: open circle sweeping counterclockwise into an arrowhead */}
      <path
        d="M 13.8 6.2 A 6 6 0 1 0 14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M 14.6 2.9 L 13.8 6.2 L 10.9 5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* clock hands */}
      <path d="M 8 5.2 V 8 L 10 9.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VersionMenuRow({
  selected,
  label,
  detail,
  onPick,
}: {
  readonly selected: boolean;
  readonly label: string;
  readonly detail: string | null;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-well"
      onClick={onPick}
    >
      <span className={`w-3 shrink-0 ${selected ? "text-ink" : "text-transparent"}`}>✓</span>
      <span className={selected ? "text-ink" : "text-ink-muted"}>{label}</span>
      {detail !== null && <span className="truncate text-ink-muted/70">{detail}</span>}
    </button>
  );
}

// ------------------------------------------------------------------- tabs

function OverviewTab({
  page,
  pinned,
  onOpenFile,
}: {
  readonly page: SkillPageData;
  readonly pinned: string;
  readonly onOpenFile: (path: string) => void;
}) {
  return (
    <div className="text-sm">
      {pinned !== CURRENT_DRAFT && (
        <p className="pb-2 text-xs text-ink-muted">Showing the current draft — historical snapshots arrive with the version store.</p>
      )}
      {page.instructions === null ? (
        <p className="text-ink-muted">No SKILL.md yet — start a chat and frame it.</p>
      ) : (
        <>
          <MarkdownContent markdown={firstSection(page.instructions)} />
          <button
            type="button"
            className="mt-3 cursor-pointer rounded border border-border bg-canvas px-3 py-1.5 font-display text-xs text-ink-muted hover:text-ink"
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
  onOpenFile,
}: {
  readonly slug: string;
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
                className="ml-2 cursor-pointer text-[10px] underline"
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

/**
 * The install door (director rulings 2026-08-03): publish writes the
 * latest recorded version's output to an install target an agent actually
 * reads. First publish on a bundle with no remembered target shows the two
 * audience choices INLINE on the row (no modal, no path field); after
 * that, one-click Publish to the remembered target, shown as quiet text.
 * Revert per version row (snapshot-backed, #169). Every act lands a
 * `skill.published` journal event + a provenance stamp in the installed
 * copy; the confirmation line below echoes the stamp's facts.
 */
function PublishTab({
  slug,
  page,
  pinned,
}: {
  readonly slug: string;
  readonly page: SkillPageData;
  readonly pinned: string;
}) {
  const pub = page.publish;
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rememberedTargets = pub === null ? [] : pub.targets.filter((t) => t.remembered);
  const canRevert = pub !== null && (pub.inPlace || rememberedTargets.length > 0);

  const act = async (body: { readonly to?: "user" | "project"; readonly version?: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const result = await postPublish(slug, body);
      const short = result.versionHash.replace(/^sha256:/, "").slice(0, 8);
      const label = result.versionLabel !== null ? ` (${result.versionLabel})` : "";
      const paths = result.results.map((r) => r.path).join(", ");
      setFlash(`Published ${short}${label} → ${paths} · ${result.evidence}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const publishButton = () => {
    if (pub === null) {
      return (
        <button
          type="button"
          className="rounded bg-amber-600 px-2.5 py-1 font-display text-xs text-white opacity-50"
          title="Publishing needs the server"
          disabled
        >
          Publish
        </button>
      );
    }
    if (pub.inPlace || rememberedTargets.length > 0) {
      return (
        <button
          type="button"
          className="cursor-pointer rounded bg-amber-600 px-2.5 py-1 font-display text-xs text-white hover:bg-amber-700 disabled:cursor-default disabled:opacity-50"
          disabled={busy}
          onClick={() => void act({})}
        >
          Publish
        </button>
      );
    }
    // First publish: the two audiences, inline -- no modal, no path field.
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs text-ink-muted">Publish to</span>
        <button
          type="button"
          className="cursor-pointer rounded bg-amber-600 px-2.5 py-1 font-display text-xs text-white hover:bg-amber-700 disabled:cursor-default disabled:opacity-50"
          title="~/.claude/skills — every agent on this machine"
          disabled={busy}
          onClick={() => void act({ to: "user" })}
        >
          All my agents
        </button>
        <button
          type="button"
          className="cursor-pointer rounded border border-border bg-canvas px-2.5 py-1 font-display text-xs text-ink-muted hover:text-ink disabled:cursor-default disabled:opacity-50"
          title=".claude/skills in this project"
          disabled={busy}
          onClick={() => void act({ to: "project" })}
        >
          This project's agents
        </button>
      </span>
    );
  };

  const draftSubtitle = () => {
    if (pub === null) return page.drift;
    if (pub.inPlace) return "adopted in place — publish writes to the skill's own live directory";
    if (rememberedTargets.length > 0) {
      return `→ ${rememberedTargets.map((t) => t.displayPath).join(", ")}`;
    }
    return page.drift;
  };

  return (
    <div className="text-sm">
      <p className="text-ink-muted">
        Publishing installs the latest recorded version where agents read skills, stamped with its evidence state.
        The chosen target is remembered.
      </p>

      {flash !== null && <p className="pt-2 text-xs text-emerald-700">{flash}</p>}
      {error !== null && <p className="pt-2 text-xs text-red-600">{error}</p>}
      {rememberedTargets.some((t) => t.installedDrift === "installed-edited") && (
        <p className="pt-2 text-xs text-amber-700">
          The installed copy has been hand-edited since the last publish — re-publishing overwrites those edits.
        </p>
      )}
      {rememberedTargets.some((t) => t.installedDrift === "not-installed") && (
        <p className="pt-2 text-xs text-amber-700">
          The installed copy is missing from its remembered target — publish to reinstall it.
        </p>
      )}

      <h3 className="pt-3 font-display text-xs uppercase text-ink-muted">Versions</h3>
      <div className="mt-1 space-y-1">
        <VersionRow
          active={pinned === CURRENT_DRAFT}
          title="Current draft"
          subtitle={draftSubtitle()}
          action={publishButton()}
        />
        {page.versions.map((v) => (
          <VersionRow
            key={v.hash}
            active={pinned === v.hash}
            title={v.shortHash + (v.label !== null ? ` · ${v.label}` : "")}
            subtitle={`recorded ${new Date(v.recordedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            action={
              <button
                type="button"
                className={`rounded border border-border px-2.5 py-1 font-display text-xs text-ink-muted ${
                  canRevert && v.snapshot && !busy ? "cursor-pointer hover:text-ink" : "opacity-50"
                }`}
                title={
                  pub === null
                    ? "Revert needs the server"
                    : !v.snapshot
                      ? "This version was recorded before the snapshot store — its content was not kept"
                      : !canRevert
                        ? "Publish once first — revert re-installs to the same target"
                        : "Write this version's snapshot to the published target"
                }
                disabled={!canRevert || !v.snapshot || busy}
                onClick={() => void act({ version: v.hash })}
              >
                Revert
              </button>
            }
          />
        ))}
        {page.versions.length === 0 && <p className="text-xs text-ink-muted">No versions recorded yet.</p>}
      </div>
      {rememberedTargets.some((t) => t.lastPublished !== null) && (
        <p className="pt-3 text-xs text-ink-muted">
          {rememberedTargets
            .filter((t) => t.lastPublished !== null)
            .map((t) => {
              const last = t.lastPublished as NonNullable<typeof t.lastPublished>;
              const short = last.versionHash.replace(/^sha256:/, "").slice(0, 8);
              const when = new Date(last.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
              return `Last published ${short} → ${t.displayPath} on ${when}${last.evidence !== null ? ` · ${last.evidence}` : ""}`;
            })
            .join(" — ")}
        </p>
      )}
      <p className="pt-3 text-xs text-ink-muted">
        Evidence per version lives in the Eval tab — pin a version in the top bar and switch tabs to see its measurements.
      </p>
    </div>
  );
}

function VersionRow({
  active,
  title,
  subtitle,
  action,
}: {
  readonly active: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly action: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${active ? "border-amber-400 bg-canvas" : "border-border"}`}
    >
      <div className="min-w-0 flex-1 text-left">
        <span className="font-mono text-xs">{title}</span>
        <span className="pl-2 text-xs text-ink-muted">{subtitle}</span>
      </div>
      {action}
    </div>
  );
}
