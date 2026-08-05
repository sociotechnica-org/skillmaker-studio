/**
 * PROTOTYPE — the shell (redo, 2026-08-05).
 *
 * Same three sections as the real shell: sidebar · center · right panel.
 * One change, and it's the whole prototype:
 *
 *   BEFORE  right panel = [ Files | Chat ]   ← two tabs, one surface, so
 *                                              reading a file costs you
 *                                              the conversation
 *   AFTER   right panel = Chat, always
 *           center      = Overview, which holds the directory and the
 *                         file viewer
 *
 * Files stopped being half of the chat panel and became the skill page.
 * You can read SKILL.md and talk to the agent at the same time, because
 * they are no longer competing for the same rectangle.
 *
 * The Board is carried over from sketch v0 and left alone on purpose —
 * the brief for this pass was the skill page.
 */
import { useEffect, useState } from "react";
import { SKILLS, STAGE_TINT, STAGES } from "./data.ts";
import { FADE_R } from "../next/ui.tsx";
import { SkillPane } from "./Overview.tsx";

type View = { readonly kind: "board" } | { readonly kind: "skill"; readonly slug: string; readonly file: string | null };

/** `#slug` is a skill, `#slug:path/to/file` is a file inside it. */
function viewFromHash(): View {
  if (typeof window === "undefined") return { kind: "board" };
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (raw === "") return { kind: "board" };
  const cut = raw.indexOf(":");
  const slug = cut === -1 ? raw : raw.slice(0, cut);
  const file = cut === -1 ? null : raw.slice(cut + 1);
  return SKILLS.some((s) => s.slug === slug) ? { kind: "skill", slug, file } : { kind: "board" };
}

export default function ProtoShell() {
  const [view, setViewState] = useState<View>({ kind: "board" });
  const [chatOpen, setChatOpen] = useState(true);

  useEffect(() => {
    setViewState(viewFromHash());
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setView = (next: View) => {
    setViewState(next);
    const hash = next.kind === "skill" ? `#${next.slug}${next.file === null ? "" : `:${next.file}`}` : "";
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash === "" ? window.location.pathname : hash);
  };

  const skill = view.kind === "skill" ? SKILLS.find((s) => s.slug === view.slug) : undefined;
  const onSkillPage = skill !== undefined;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* sidebar ------------------------------------------------------- */}
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-border bg-paper px-3 py-4">
        <p className="pb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700">prototype</p>

        <button
          type="button"
          onClick={() => setView({ kind: "board" })}
          className={`mb-2 flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-display text-sm ${
            view.kind === "board" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface hover:text-ink"
          }`}
        >
          <span>Board</span>
        </button>

        <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">skills</p>
        {SKILLS.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => setView({ kind: "skill", slug: s.slug, file: null })}
            className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
              view.kind === "skill" && view.slug === s.slug ? "bg-surface shadow-sm" : "hover:bg-surface"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[12px] text-ink">{s.slug}</span>
              {/* the madlib's first line IS the one-liner — no second field to drift */}
              <span className="block truncate text-[11px] text-ink-muted">{s.slots[0]?.value ?? "no job recorded"}</span>
            </span>
          </button>
        ))}
      </aside>

      {/* center -------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">

        <main className="flex-1 overflow-y-auto">
          {onSkillPage ? (
            <SkillPane key={`${skill.slug}:${view.kind === "skill" ? (view.file ?? "") : ""}`} skill={skill} initialFile={view.kind === "skill" ? view.file : null} />
          ) : (
            <Board onOpenSkill={(slug) => setView({ kind: "skill", slug, file: null })} />
          )}
        </main>
      </div>

      {/* right panel — chat, and only chat ----------------------------- */}
      {chatOpen && (
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-paper">
          <div className="flex h-11 shrink-0 items-center px-3">
            <span className="font-display text-[13px]">Chat</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              title="Hide chat"
              className="rounded px-1.5 py-1 text-ink-muted hover:bg-surface hover:text-ink"
            >
              ›
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <ChatStub skill={onSkillPage ? skill.slug : null} />
          </div>
          <div className="shrink-0 border-t border-border p-3">
            <div className="rounded border border-border bg-surface px-3 py-2 text-[12px] text-ink-muted">Ask about this skill…</div>
          </div>
        </aside>
      )}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          title="Show chat"
          className="w-7 shrink-0 border-l border-border bg-paper text-[11px] text-ink-muted hover:bg-surface hover:text-ink"
        >
          ‹
        </button>
      )}
    </div>
  );
}

function ChatStub({ skill }: { readonly skill: string | null }) {
  if (skill === null) {
    return <p className="pt-2 text-[12px] text-ink-muted">Open a skill to start a session.</p>;
  }
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="self-end rounded-lg bg-amber-100 px-3 py-2 text-[12px] text-ink">Does the draft still match design.md?</div>
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-ink">
        Yes for Intent, no for the workflow — step 4 in <span className="[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[11px]">design.md</span> isn't in the draft. Want me to add it?
      </div>
      <p className="pt-2 text-[11px] leading-snug text-ink-muted">
        You can read the file it's talking about at the same time now — it's open in the center, not fighting this panel for space.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- board

/**
 * The Board, restored to what the app actually ships (next/views.tsx
 * BoardView): five stage columns, a card per skill, tinted stage chips,
 * the "All projects · Archived: drawer" footer. My earlier version --
 * work-state columns with invented jobs -- is deleted, not parked.
 *
 * The framing that survives: this is the workstation. Work happens here.
 * The skill page is what the work produced.
 */
function Board({ onOpenSkill }: { readonly onOpenSkill: (slug: string) => void }) {
  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Board</h1>
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded border border-border bg-paper p-2">
            <div className={`mb-2 inline-block rounded px-2 py-0.5 font-display text-xs ${STAGE_TINT[stage]}`}>{stage}</div>
            {SKILLS.filter((s) => s.stage === stage).map((s) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => onOpenSkill(s.slug)}
                className="mb-2 block w-full rounded bg-surface p-2 text-left shadow-sm hover:shadow"
              >
                <div className={`font-display text-sm ${FADE_R}`}>{s.slug}</div>
                <div className={`text-xs text-ink-muted ${FADE_R}`}>{s.project}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="pt-3 text-xs text-ink-muted">All projects · Archived: drawer</p>
    </div>
  );
}
