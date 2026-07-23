/**
 * Client + hook for the chat surface (`/api/chat/:skill/*`, see
 * packages/cli/src/server/ChatSessions.ts). Deliberately separate from
 * api.ts (the board/tasks wiring): chat is a live SSE stream with actions,
 * not fetch-on-mount data.
 *
 * The shell must never break without the server (`astro dev` has no
 * `/api/*`): `useChatSession` reports `available: false` when the state
 * fetch fails, and the ChatTab falls back to data.ts's placeholder
 * conversation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "../runtime/client.ts";

export interface ChatResumable {
  readonly provider: string;
  readonly providerSessionId: string;
  readonly updatedAt: string;
  readonly model?: string;
  readonly effort?: string;
}

export interface ChatActiveState {
  readonly provider: string;
  readonly status: "starting" | "ready" | "running";
  readonly sessionId: string;
  readonly resumed: boolean;
  readonly resumeFallback?: string;
  readonly model?: string;
  /** BASE model id in effect (bracket-free). */
  readonly modelId?: string;
  readonly effort?: string;
  /** Set when the chosen model could not be applied -- the session runs on the adapter's default. */
  readonly modelFallback?: string;
}

// -- Provider capability catalog (GET /api/chat/providers) -------------------

export interface ChatCatalogModel {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly efforts: ReadonlyArray<string>;
  readonly defaultEffort?: string;
}

export interface ChatProviderCatalog {
  readonly provider: string;
  readonly title: string;
  readonly models: ReadonlyArray<ChatCatalogModel>;
  readonly currentModelId?: string;
  readonly currentEffort?: string;
  readonly imageSupport: boolean;
  readonly probed: boolean;
  readonly note?: string;
}

const decodeCatalogModel = (raw: unknown): ChatCatalogModel | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
  const efforts = Array.isArray(entry.efforts)
    ? entry.efforts.filter((effort): effort is string => typeof effort === "string")
    : [];
  return {
    id: entry.id,
    label: typeof entry.label === "string" && entry.label.length > 0 ? entry.label : entry.id,
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
    efforts,
    ...(typeof entry.defaultEffort === "string" ? { defaultEffort: entry.defaultEffort } : {}),
  };
};

const decodeCatalogEntry = (raw: unknown): ChatProviderCatalog | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.provider !== "string" || entry.provider.length === 0) return undefined;
  const models = Array.isArray(entry.models)
    ? entry.models.map(decodeCatalogModel).filter((model): model is ChatCatalogModel => model !== undefined)
    : [];
  return {
    provider: entry.provider,
    title: typeof entry.title === "string" && entry.title.length > 0 ? entry.title : entry.provider,
    models,
    ...(typeof entry.currentModelId === "string" ? { currentModelId: entry.currentModelId } : {}),
    ...(typeof entry.currentEffort === "string" ? { currentEffort: entry.currentEffort } : {}),
    imageSupport: entry.imageSupport !== false,
    probed: entry.probed === true,
    ...(typeof entry.note === "string" ? { note: entry.note } : {}),
  };
};

/**
 * The per-provider model/effort/image catalog. `null` when the server (or
 * the endpoint) is absent -- callers degrade to bare provider names. NOTE:
 * the server's first answer may take a while (it probes each adapter once,
 * then caches per process).
 */
export const fetchProvidersCatalog = async (): Promise<ReadonlyArray<ChatProviderCatalog> | null> => {
  try {
    const response = await fetch("/api/chat/providers", { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const json = (await response.json()) as { readonly providers?: unknown };
    if (!Array.isArray(json.providers)) return null;
    return json.providers
      .map(decodeCatalogEntry)
      .filter((entry): entry is ChatProviderCatalog => entry !== undefined);
  } catch {
    return null;
  }
};

/** An image attachment on its way to `POST /api/chat/:skill/message`: base64 payload + mime type (the ACP image content block's wire shape). */
export interface ChatImagePayload {
  readonly data: string;
  readonly mimeType: string;
  readonly name?: string;
}

/** A model/effort pick for session start. */
export interface ChatModelChoice {
  readonly model?: string;
  readonly effort?: string;
}

export interface ChatState {
  readonly skill: string;
  readonly providers: ReadonlyArray<string>;
  readonly defaultProvider: string | undefined;
  readonly active: ChatActiveState | null;
  readonly resumable: ReadonlyArray<ChatResumable>;
  readonly lastError?: string;
}

const decodeState = (value: unknown): ChatState | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.skill !== "string" || !Array.isArray(raw.providers)) return undefined;
  return raw as unknown as ChatState;
};

export interface ChatSessionHook {
  /** False when the chat API is absent (plain astro dev) -> placeholder mode. */
  readonly available: boolean;
  readonly state: ChatState | undefined;
  /** SSE events in arrival order (chatModel.ts renders them). Reset on each stream (re)connect -- the server replays from session start. */
  readonly events: ReadonlyArray<unknown>;
  readonly actionError: string | undefined;
  readonly start: (provider: string, mode: "new" | "resume", choice?: ChatModelChoice) => void;
  readonly send: (text: string, images?: ReadonlyArray<ChatImagePayload>) => void;
  /** Mid-session model change (between turns): POST /api/chat/:skill/model. */
  readonly setModel: (model: string, effort?: string) => void;
  readonly answerPermission: (requestId: string, optionId: string, decision: "allowed" | "denied") => void;
  readonly cancelTurn: () => void;
}

export function useChatSession(skill: string): ChatSessionHook {
  const [available, setAvailable] = useState(true);
  const [state, setState] = useState<ChatState | undefined>(undefined);
  const [events, setEvents] = useState<ReadonlyArray<unknown>>([]);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  // Bumped after a session starts so the EventSource reconnects and picks
  // up the new session's buffer.
  const [streamEpoch, setStreamEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    setEvents([]);
    fetch(`/api/chat/${encodeURIComponent(skill)}/state`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setAvailable(false);
          return;
        }
        const decoded = decodeState(await response.json());
        if (decoded === undefined) {
          setAvailable(false);
          return;
        }
        setAvailable(true);
        setState(decoded);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill]);

  useEffect(() => {
    if (!available) return;
    const source = new EventSource(`/api/chat/${encodeURIComponent(skill)}/stream`);
    const onOpen = () => {
      // The server replays the live session's whole buffer on connect:
      // start from a clean slate so a reconnect never duplicates items.
      setEvents([]);
    };
    const onMessage = (message: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).type === "state"
      ) {
        const decoded = decodeState((parsed as Record<string, unknown>).state);
        if (decoded !== undefined) setState(decoded);
        return;
      }
      setEvents((prev) => [...prev, parsed]);
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("message", onMessage);
    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("message", onMessage);
      source.close();
    };
  }, [skill, available, streamEpoch]);

  const act = useCallback(
    (path: string, payload: unknown, onOk?: () => void) => {
      setActionError(undefined);
      postJson(`/api/chat/${encodeURIComponent(skill)}/${path}`, payload)
        .then((response) => {
          if (!response.ok) {
            const body = response.body as { readonly error?: unknown } | null;
            setActionError(
              typeof body?.error === "string" ? body.error : `${path} failed (${response.status})`,
            );
            return;
          }
          onOk?.();
        })
        .catch((cause) => setActionError(String(cause)));
    },
    [skill],
  );

  const actRef = useRef(act);
  actRef.current = act;

  return {
    available,
    state,
    events,
    actionError,
    start: useCallback((provider: string, mode: "new" | "resume", choice?: ChatModelChoice) => {
      actRef.current(
        "session",
        {
          provider,
          mode,
          ...(choice?.model !== undefined ? { model: choice.model } : {}),
          ...(choice?.effort !== undefined ? { effort: choice.effort } : {}),
        },
        () => setStreamEpoch((epoch) => epoch + 1),
      );
    }, []),
    send: useCallback((text: string, images?: ReadonlyArray<ChatImagePayload>) => {
      actRef.current("message", {
        text,
        ...(images !== undefined && images.length > 0 ? { images } : {}),
      });
    }, []),
    setModel: useCallback((model: string, effort?: string) => {
      actRef.current("model", { model, ...(effort !== undefined ? { effort } : {}) });
    }, []),
    answerPermission: useCallback((requestId: string, optionId: string, decision: "allowed" | "denied") => {
      actRef.current("permission", { requestId, optionId, decision });
    }, []),
    cancelTurn: useCallback(() => {
      actRef.current("cancel", {});
    }, []),
  };
}
