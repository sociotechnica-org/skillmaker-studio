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
              tab === t ? "bg-surface shadow-sm" : "text-ink-muted hover:bg-surface hover:text-ink hover:shadow-sm"
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

type ChatMessage =
  | { readonly role: "agent"; readonly text: string; readonly sentAt: string; readonly status?: string }
  | { readonly role: "user"; readonly text: string; readonly sentAt: string };

const CONVERSATION: ReadonlyArray<ChatMessage> = [
  { role: "agent", text: "Research is approved. Want me to start drafting, or is there anything in the notes you want changed first?", sentAt: "Jul 23, 9:38 AM" },
  { role: "user", text: "go ahead and draft", sentAt: "Jul 23, 9:41 AM" },
  { role: "agent", status: "running drafting", text: "Writing design.md and output/SKILL.md in the sandbox…", sentAt: "Jul 23, 9:41 AM" },
];

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10h1.5" />
    </svg>
  );
}

/**
 * Timestamp + working copy button, revealed on the message group's hover.
 * The row's height is always reserved, so hovering never pushes layout.
 */
function MessageMeta({ text, sentAt, align }: { readonly text: string; readonly sentAt: string; readonly align: "left" | "right" }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  const copyButton = (
    <button type="button" className="rounded p-1 hover:bg-surface hover:text-ink hover:shadow-sm" title="Copy message" onClick={copy}>
      <CopyIcon />
    </button>
  );
  const time = <span>{copied ? "Copied" : sentAt}</span>;
  return (
    <div
      className={`flex h-6 items-center gap-1.5 text-xs text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 ${
        align === "right" ? "justify-end pr-1" : "pl-0.5"
      }`}
    >
      {align === "left" ? (
        <>
          {copyButton}
          {time}
        </>
      ) : (
        <>
          {time}
          {copyButton}
        </>
      )}
    </div>
  );
}

/** The user's bubble, right-aligned. */
function UserMessage({ text, sentAt }: { readonly text: string; readonly sentAt: string }) {
  return (
    <div className="group flex flex-col items-end pt-3">
      <div className="max-w-[85%] rounded-xl bg-amber-50 px-3 py-2 shadow-sm">
        <p>{text}</p>
      </div>
      <div className="self-stretch">
        <MessageMeta text={text} sentAt={sentAt} align="right" />
      </div>
    </div>
  );
}

/** Agent output is full-width prose — no bubble, no border, no name. */
function AgentMessage({ text, sentAt, status }: { readonly text: string; readonly sentAt: string; readonly status?: string }) {
  return (
    <div className="group pt-3">
      {status && <div className="pb-0.5 font-display text-xs text-ink-muted">{status}</div>}
      <p className={status ? "text-ink-muted" : ""}>{text}</p>
      <MessageMeta text={text} sentAt={sentAt} align="left" />
    </div>
  );
}

function ChatTab() {
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* messages scroll behind the floating input; bottom padding keeps the
          last message reachable above it */}
      <div className="h-full overflow-y-auto px-3 pb-24 text-sm">
        {CONVERSATION.map((m, i) =>
          m.role === "user" ? (
            <UserMessage key={i} text={m.text} sentAt={m.sentAt} />
          ) : (
            <AgentMessage key={i} text={m.text} sentAt={m.sentAt} status={m.status} />
          ),
        )}
      </div>
      {/* floating input — no footer container, hovers over the text */}
      <div className="absolute inset-x-2 bottom-2">
        <input
          className="w-full rounded-xl border border-border bg-surface/95 px-3 py-2.5 text-sm shadow-lg outline-none backdrop-blur-sm focus:border-amber-300"
          placeholder="What should we do?"
        />
      </div>
    </div>
  );
}
