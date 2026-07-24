/** Right panel: Files (bundle browser + in-panel viewer) and Chat (the per-skill agent session). */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelResize } from "./hooks.ts";
import { FileContentView, MarkdownContent } from "../components/Markdown.tsx";
import { fetchBundleFile, fetchBundleFiles, useApiData } from "./api.ts";
import {
  fetchProvidersCatalog,
  useChatSession,
  type ChatImagePayload,
  type ChatProviderCatalog,
  type ChatState,
} from "./chatApi.ts";
import { chatItemsFromEvents, pickPermissionChoices, type ChatItem, type ChatItemImage } from "./chatModel.ts";
import { defaultSelection, ModelPicker, selectionSupportsImages, type ModelSelection } from "./ModelPicker.tsx";
import { BUNDLE_FILES } from "./data.ts";
import { ChevronIcon, FolderIcon } from "./icons.tsx";
import { FADE_R, IconButton } from "./ui.tsx";
import type { BundleFile } from "./types.ts";

type PanelTab = "files" | "chat";

/**
 * Hand-off from the new-skill launcher: start a session with `provider`
 * whose FIRST prompt is `message` (the session manager's preamble already
 * names the skill). The start API takes no initial message, so the ChatTab
 * starts the session and sends the message the moment the agent is ready.
 */
export type ChatIntro = {
  readonly slug: string;
  readonly provider: string;
  readonly message: string;
  /** BASE model id picked in the launcher (provider-implied); absent -> the provider's default. */
  readonly model?: string;
  readonly effort?: string;
};

const FILES_FALLBACK: ReadonlyArray<BundleFile> = BUNDLE_FILES.map((path) => ({ path, size: 0 }));

export function RightPanel({
  skill,
  width,
  intro = null,
  onIntroConsumed,
}: {
  readonly skill: string;
  readonly width: number;
  readonly intro?: ChatIntro | null;
  readonly onIntroConsumed?: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("chat");
  // Files state lives here (not in FilesTab) so switching tabs keeps it.
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  // At narrow panel widths the split leaves no room to read: selecting a
  // file tucks the tree away (the folder button brings it back).
  const selectFile = (path: string | null) => {
    setSelectedFile(path);
    if (path !== null && width < 420) setTreeOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* implied top section — no bottom border; the fixed corner toggles
          overlay the right edge of this row */}
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
        {tab === "files" && selectedFile !== null && (
          <IconButton
            active={treeOpen}
            onClick={() => setTreeOpen(!treeOpen)}
            title={treeOpen ? "Hide file browser" : "Show file browser"}
          >
            <FolderIcon />
          </IconButton>
        )}
        {/* clearance: the fixed corner toggles overlay this corner */}
        <span className="w-16 shrink-0" />
      </div>
      {tab === "files" ? (
        <FilesTab
          skill={skill}
          selected={selectedFile}
          treeOpen={treeOpen}
          onSelect={selectFile}
        />
      ) : (
        <ChatTab skill={skill} intro={intro} onIntroConsumed={onIntroConsumed} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ files

type TreeDir = { readonly name: string; readonly path: string; readonly dirs: TreeDir[]; readonly files: BundleFile[] };

/** Builds a nested directory tree from the endpoint's flat path list. */
function buildTree(files: ReadonlyArray<BundleFile>): TreeDir {
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

function FilesTab({
  skill,
  selected,
  treeOpen,
  onSelect,
}: {
  readonly skill: string;
  readonly selected: string | null;
  readonly treeOpen: boolean;
  readonly onSelect: (path: string | null) => void;
}) {
  const fetcher = useCallback(() => fetchBundleFiles(skill), [skill]);
  const files = useApiData(fetcher, FILES_FALLBACK);
  const tree = buildTree(files);
  // The tree column hugs the window's right edge, so the "right"-side
  // resize math (innerWidth - clientX) holds here too. Persisted.
  const treeCol = usePanelResize("right", "sm-next-treew", 208, 140, 420);

  // No file selected: the tree fills the panel.
  if (selected === null) {
    return (
      <div className="flex-1 overflow-y-auto px-2 pb-4 text-sm">
        <DirChildren dir={tree} depth={0} selected={selected} onSelect={onSelect} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* breadcrumb: skill › dirs › file */}
      <div className={`flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5 text-xs ${FADE_R}`}>
        <span className="text-ink-muted">{skill}</span>
        {selected.split("/").map((segment, i, all) => (
          <span key={`${segment}-${i}`} className="flex items-center gap-1 whitespace-nowrap">
            <span className="text-ink-muted">›</span>
            <span className={i === all.length - 1 ? "font-display" : "text-ink-muted"}>{segment}</span>
          </span>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {/* file content */}
        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          <FileViewer skill={skill} path={selected} />
        </div>
        {/* collapsible, drag-resizable tree column */}
        <div
          className={`relative shrink-0 overflow-hidden border-border ${
            treeCol.dragging ? "" : "transition-[width] duration-200 ease-out"
          } ${treeOpen ? "border-l" : ""}`}
          style={{ width: treeOpen ? treeCol.width : 0 }}
        >
          {treeOpen && (
            <div
              className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize hover:bg-amber-400/40"
              onMouseDown={treeCol.onDragStart}
              title="Drag to resize"
            />
          )}
          <div className="h-full overflow-y-auto px-1 py-2 text-sm" style={{ width: treeCol.width }}>
            <DirChildren dir={tree} depth={0} selected={selected} onSelect={onSelect} />
          </div>
        </div>
      </div>
    </div>
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
  readonly onSelect: (path: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-1 rounded py-0.5 text-left text-ink-muted hover:bg-surface/60 ${FADE_R}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={dir.path}
      >
        <span className="shrink-0">
          <ChevronIcon open={open} />
        </span>
        <span className={`min-w-0 flex-1 ${FADE_R}`}>{dir.name}</span>
      </button>
      {open && <DirChildren dir={dir} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </div>
  );
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
  readonly onSelect: (path: string | null) => void;
}) {
  return (
    <>
      {dir.dirs.map((d) => (
        <DirSection key={d.path} dir={d} depth={depth} selected={selected} onSelect={onSelect} />
      ))}
      {dir.files.map((f) => {
        const name = f.path.split("/").pop() ?? f.path;
        const active = f.path === selected;
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            className={`block w-full rounded py-0.5 pr-1 text-left ${FADE_R} ${
              active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface/60"
            }`}
            style={{ paddingLeft: 20 + depth * 12 }}
            title={f.path}
          >
            {name}
          </button>
        );
      })}
    </>
  );
}

function FileViewer({ skill, path }: { readonly skill: string; readonly path: string }) {
  const fetcher = useCallback(() => fetchBundleFile(skill, path), [skill, path]);
  const content = useApiData(fetcher, null);

  if (content === null) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }
  return (
    <FileContentView
      path={path}
      content={content}
      preClassName="whitespace-pre-wrap break-words text-xs leading-relaxed [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]"
      renderedClassName="rounded border border-border bg-surface p-3 text-sm shadow-sm"
    />
  );
}

// ------------------------------------------------------------------- chat

type ChatMessage =
  | { readonly role: "agent"; readonly text: string; readonly sentAt: string; readonly status?: string }
  | { readonly role: "user"; readonly text: string; readonly sentAt: string };

/** Placeholder conversation — rendered ONLY when the chat API is absent (plain astro dev). */
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

/**
 * A sent image inside the user bubble: small thumbnail; clicking toggles a
 * larger inline view (deliberately simple -- no lightbox, no new tab; data
 * URLs don't open in new tabs in modern browsers anyway).
 */
function SentImage({ image }: { readonly image: ChatItemImage }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className="block overflow-hidden rounded border border-border"
      title={`${image.name ?? image.mimeType} — click to ${expanded ? "shrink" : "enlarge"}`}
      onClick={() => setExpanded(!expanded)}
    >
      <img
        src={`data:${image.mimeType};base64,${image.data}`}
        alt={image.name ?? "attached image"}
        className={expanded ? "max-h-96 max-w-full" : "h-16 w-auto"}
      />
    </button>
  );
}

/** The user's bubble, right-aligned; attached images render above the text. */
function UserMessage({
  text,
  sentAt,
  images = [],
}: {
  readonly text: string;
  readonly sentAt: string;
  readonly images?: ReadonlyArray<ChatItemImage>;
}) {
  return (
    <div className="group flex flex-col items-end pt-3">
      <div className="max-w-[85%] rounded-xl bg-amber-50 px-3 py-2 shadow-sm">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5 pb-1">
            {images.map((image, i) => (
              <SentImage key={i} image={image} />
            ))}
          </div>
        )}
        {text.length > 0 && <p className="whitespace-pre-wrap">{text}</p>}
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
      <div className={status ? "text-ink-muted" : ""}>
        <MarkdownContent markdown={text} />
      </div>
      <MessageMeta text={text} sentAt={sentAt} align="left" />
    </div>
  );
}

/** A tool call as a simple collapsed one-line chip — deliberately unstyled beyond the minimum (the director iterates on chips live later). */
function ToolChip({ title, status }: { readonly title: string; readonly status: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-border bg-surface/60 px-2 py-1 text-xs text-ink-muted" title={`${title} — ${status}`}>
      <span className="truncate">{title}</span>
      <span className="ml-auto shrink-0">{status}</span>
    </div>
  );
}

/** An out-of-project permission request, inline in the conversation. Approve/deny answers the agent. */
function PermissionCard({
  item,
  onAnswer,
}: {
  readonly item: Extract<ChatItem, { kind: "permission" }>;
  readonly onAnswer: (requestId: string, optionId: string, decision: "allowed" | "denied") => void;
}) {
  const { approve, deny } = pickPermissionChoices(item.options);
  if (item.resolved !== undefined) {
    return (
      <div className="mt-2 rounded border border-border bg-surface/60 px-2 py-1 text-xs text-ink-muted">
        {item.title} — {item.resolved.outcome}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm shadow-sm">
      <div className="pb-0.5 font-display text-xs uppercase tracking-widest text-ink-muted">permission</div>
      <p className="pb-2">{item.title}</p>
      <div className="flex gap-2">
        {approve && (
          <button
            type="button"
            className="rounded bg-amber-200 px-2 py-1 text-xs hover:bg-amber-300"
            onClick={() => onAnswer(item.id, approve.optionId, "allowed")}
          >
            Approve
          </button>
        )}
        {deny && (
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface"
            onClick={() => onAnswer(item.id, deny.optionId, "denied")}
          >
            Deny
          </button>
        )}
      </div>
    </div>
  );
}

const fmtTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * Pre-session state (ruled): no session spawns implicitly. The user picks
 * the agent (provider) and — when a resumable session exists for that
 * provider — whether to resume or start fresh. Deliberately minimal and
 * self-contained so it can relocate to a settings surface later.
 */
function StartChooser({
  state,
  provider,
  onStart,
}: {
  readonly state: ChatState;
  readonly provider: string;
  readonly onStart: (provider: string, mode: "new" | "resume") => void;
}) {
  const resumable = state.resumable.find((entry) => entry.provider === provider);
  return (
    <div className="px-3 pt-4 text-sm">
      <p className="text-ink-muted">
        Start a session with <span className="font-display">{provider}</span> — or pick a different agent below.
      </p>
      <div className="flex gap-2 pt-3">
        {resumable && (
          <button
            type="button"
            className="rounded bg-amber-200 px-2.5 py-1.5 text-xs hover:bg-amber-300"
            title={`Resume the session from ${fmtTime(resumable.updatedAt)}`}
            onClick={() => onStart(provider, "resume")}
          >
            Resume ({fmtTime(resumable.updatedAt)})
          </button>
        )}
        <button
          type="button"
          className={`rounded px-2.5 py-1.5 text-xs ${resumable ? "border border-border hover:bg-surface" : "bg-amber-200 hover:bg-amber-300"}`}
          disabled={provider.length === 0}
          onClick={() => onStart(provider, "new")}
        >
          {resumable ? "Start fresh" : "Start"}
        </button>
      </div>
      {state.lastError && <p className="pt-3 text-xs text-red-600">{state.lastError}</p>}
    </div>
  );
}

/** The placeholder conversation, unchanged — shown only when the API is absent. */
function PlaceholderConversation() {
  return (
    <>
      {CONVERSATION.map((m, i) =>
        m.role === "user" ? (
          <UserMessage key={i} text={m.text} sentAt={m.sentAt} />
        ) : (
          <AgentMessage key={i} text={m.text} sentAt={m.sentAt} status={m.status} />
        ),
      )}
    </>
  );
}

/** Client-side mirror of the server's per-image cap (the server's validateChatImage stays the authority). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function AttachIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M13.2 7.3l-5 5a3.1 3.1 0 0 1-4.4-4.4l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.6 5.6a1.1 1.1 0 0 1-1.6-1.6l5-5" />
    </svg>
  );
}

/** Reads one picked/pasted file into a base64 attachment; resolves an error string for non-images and oversized files (the honest client-side mirror of the server cap). */
const readImageFile = (file: File): Promise<ChatImagePayload | string> =>
  new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(`"${file.name}" is not an image`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      resolve(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB — the limit is 5MB per image`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(`could not read "${file.name}"`);
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(",");
      if (comma === -1) {
        resolve(`could not read "${file.name}"`);
        return;
      }
      resolve({ data: url.slice(comma + 1), mimeType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  });

function ChatTab({
  skill,
  intro = null,
  onIntroConsumed,
}: {
  readonly skill: string;
  readonly intro?: ChatIntro | null;
  readonly onIntroConsumed?: () => void;
}) {
  const chat = useChatSession(skill);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [pendingImages, setPendingImages] = useState<ReadonlyArray<ChatImagePayload>>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  // undefined = loading, null = endpoint absent -> bare provider names.
  const [catalog, setCatalog] = useState<ReadonlyArray<ChatProviderCatalog> | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!chat.available) return;
    let cancelled = false;
    void fetchProvidersCatalog().then((entries) => {
      if (!cancelled) setCatalog(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [chat.available]);

  const items = chatItemsFromEvents(chat.events);
  const active = chat.state?.active ?? null;
  const canSend = chat.available && active !== null && active.status === "ready";

  // The selection the picker shows: the ACTIVE session's model when one is
  // live (server truth), else the user's pick, else the catalog's default.
  const selection: ModelSelection =
    active !== null
      ? {
          provider: active.provider,
          ...(active.modelId !== undefined ? { model: active.modelId } : {}),
          ...(active.effort !== undefined ? { effort: active.effort } : {}),
        }
      : picked ??
        defaultSelection(catalog ?? null, chat.state?.providers ?? []) ?? {
          provider: chat.state?.defaultProvider ?? "claude-code",
        };
  const imageSupport = selectionSupportsImages(catalog ?? null, selection.provider);

  const onSelectionChange = (next: ModelSelection) => {
    if (active === null) {
      setPicked(next);
      return;
    }
    // Mid-session (between turns): a model/effort change on the SAME
    // provider goes through session/set_model; other providers' options
    // are disabled by the picker (lockProvider).
    if (active.status === "ready" && next.provider === active.provider && next.model !== undefined) {
      chat.setModel(next.model, next.effort);
    }
  };

  // Launcher hand-off: start the session, then send the first prompt the
  // moment the agent reports ready. Each step fires at most once.
  const introStep = useRef<"start" | "send" | "done">("start");
  useEffect(() => {
    if (intro === null || intro.slug !== skill || !chat.available || chat.state === undefined) return;
    if (introStep.current === "start") {
      introStep.current = "send";
      if (active === null) {
        chat.start(
          intro.provider,
          "new",
          intro.model !== undefined
            ? { model: intro.model, ...(intro.effort !== undefined ? { effort: intro.effort } : {}) }
            : undefined,
        );
        return;
      }
      // A session already exists (e.g. remount mid-hand-off): skip the
      // start and just deliver the first prompt when it's ready.
    }
    if (introStep.current === "send" && active !== null && active.status === "ready") {
      introStep.current = "done";
      chat.send(intro.message);
      onIntroConsumed?.();
    }
  }, [intro, skill, chat, active, onIntroConsumed]);

  // Keep the newest message in view as the stream grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, active?.status]);

  const addImageFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    setImageError(null);
    void Promise.all(files.map(readImageFile)).then((results) => {
      const good = results.filter((result): result is ChatImagePayload => typeof result !== "string");
      const firstError = results.find((result): result is string => typeof result === "string");
      if (good.length > 0) setPendingImages((prev) => [...prev, ...good]);
      if (firstError !== undefined) setImageError(firstError);
    });
  };

  const sendDraft = () => {
    const text = draft.trim();
    if ((text.length === 0 && pendingImages.length === 0) || !canSend) return;
    chat.send(text, pendingImages);
    setDraft("");
    setPendingImages([]);
    setImageError(null);
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* messages scroll behind the floating input; bottom padding keeps the
          last message reachable above it */}
      <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-28 text-sm">
        {!chat.available && <PlaceholderConversation />}
        {chat.available && chat.state !== undefined && active === null && (
          <StartChooser
            state={chat.state}
            provider={selection.provider}
            onStart={(provider, mode) =>
              chat.start(
                provider,
                mode,
                selection.model !== undefined
                  ? { model: selection.model, ...(selection.effort !== undefined ? { effort: selection.effort } : {}) }
                  : undefined,
              )
            }
          />
        )}
        {chat.available && active !== null && active.status === "starting" && (
          <p className="pt-3 text-ink-muted">Starting the agent…</p>
        )}
        {chat.available && active !== null && active.modelFallback !== undefined && (
          <p className="pt-2 text-xs text-amber-700 dark:text-amber-400">{active.modelFallback}</p>
        )}
        {chat.available &&
          items.map((item, i) => {
            if (item.kind === "user")
              return <UserMessage key={i} text={item.text} sentAt={fmtTime(item.t)} images={item.images} />;
            if (item.kind === "agent") return <AgentMessage key={i} text={item.text} sentAt={fmtTime(item.t)} />;
            if (item.kind === "tool") return <ToolChip key={item.toolCallId} title={item.title} status={item.status} />;
            if (item.kind === "permission")
              return <PermissionCard key={item.id} item={item} onAnswer={chat.answerPermission} />;
            return (
              <div key={i} className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                {item.message}
              </div>
            );
          })}
        {chat.available && active !== null && active.status === "running" && (
          <div className="flex items-center gap-2 pt-3 text-xs text-ink-muted">
            <span>running…</span>
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 hover:bg-surface"
              onClick={chat.cancelTurn}
            >
              Stop
            </button>
          </div>
        )}
        {chat.actionError && <p className="pt-2 text-xs text-red-600">{chat.actionError}</p>}
      </div>
      {/* floating compose box — thumbnails, then input, then attach + model/effort + send */}
      <div className="absolute inset-x-2 bottom-2 rounded-xl border border-border bg-surface/95 shadow-lg backdrop-blur-sm focus-within:border-amber-300">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {pendingImages.map((image, i) => (
              <span key={i} className="relative inline-block">
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? "attachment"}
                  className="h-12 w-auto rounded border border-border"
                />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] leading-none text-white shadow dark:text-canvas"
                  title={`Remove ${image.name ?? "image"}`}
                  onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {imageError !== null && <p className="px-4 pt-2 text-xs text-red-600">{imageError}</p>}
        <input
          className="w-full bg-transparent px-4 pb-1.5 pt-3.5 text-sm outline-none disabled:opacity-60"
          placeholder={canSend || !chat.available ? "What should we do?" : active === null ? "Choose a model to start" : "Agent is working…"}
          value={draft}
          disabled={chat.available && !canSend}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            if (!imageSupport) return;
            const files = Array.from(e.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
            if (files.length > 0) {
              e.preventDefault();
              addImageFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendDraft();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2 px-3 pb-3">
          {imageSupport && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImageFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="rounded p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-35"
                title="Attach images (or paste into the input)"
                disabled={chat.available && !canSend && active !== null}
                onClick={() => fileInputRef.current?.click()}
              >
                <AttachIcon />
              </button>
            </>
          )}
          <span className="flex-1" />
          <ModelPicker
            catalog={catalog ?? null}
            providers={chat.state?.providers ?? []}
            selection={selection}
            onChange={onSelectionChange}
            disabled={active !== null && active.status !== "ready"}
            {...(active !== null ? { lockProvider: active.provider } : {})}
          />
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-white shadow hover:bg-amber-700 disabled:opacity-35"
            title="Send"
            disabled={chat.available && !canSend}
            onClick={sendDraft}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="8" y1="13" x2="8" y2="3.5" />
              <path d="M4 7.5L8 3.5l4 4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
