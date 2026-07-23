/** Right panel: Files (bundle browser) and Chat (the per-skill agent session). */
import { useState } from "react";
import { BUNDLE_FILES } from "./data.ts";
import { FADE_R } from "./ui.tsx";

type PanelTab = "files" | "chat";

export function RightPanel() {
  const [tab, setTab] = useState<PanelTab>("chat");

  return (
    <div className="flex h-full flex-col">
      {/* implied top section — no bottom border; the fixed corner toggle
          overlays the right edge of this row */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        {(["files", "chat"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 font-display text-xs uppercase ${
              tab === t ? "bg-surface shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="flex-1" />
        <span className="w-7 shrink-0" />
      </div>
      {tab === "files" ? <FilesTab /> : <ChatTab />}
    </div>
  );
}

function FilesTab() {
  return (
    <div className="flex-1 overflow-y-auto px-3 text-sm">
      <div className="pb-1 text-xs uppercase tracking-widest text-ink-muted">bundle</div>
      {BUNDLE_FILES.map((f) => (
        <button
          key={f}
          type="button"
          className={`block w-full rounded px-2 py-0.5 text-left text-ink-muted hover:bg-surface/60 ${FADE_R}`}
          title={f}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function ChatTab() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 text-sm">
        <div className="rounded bg-surface p-2 shadow-sm">
          <span className="font-display text-xs text-ink-muted">WILLIAM</span>
          <p>Research is approved. Want me to start drafting, or is there anything in the notes you want changed first?</p>
        </div>
        <div className="ml-6 rounded bg-amber-50 p-2 shadow-sm">
          <p>go ahead and draft</p>
        </div>
        <div className="rounded bg-surface p-2 shadow-sm">
          <span className="font-display text-xs text-ink-muted">WILLIAM · running drafting</span>
          <p className="text-ink-muted">Writing design.md and output/SKILL.md in the sandbox…</p>
        </div>
      </div>
      <div className="border-t border-border p-2">
        <input
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm"
          placeholder="Tell William what to do…"
        />
      </div>
    </div>
  );
}
