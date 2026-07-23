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
}

export interface ChatActiveState {
  readonly provider: string;
  readonly status: "starting" | "ready" | "running";
  readonly sessionId: string;
  readonly resumed: boolean;
  readonly resumeFallback?: string;
  readonly model?: string;
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
  readonly start: (provider: string, mode: "new" | "resume") => void;
  readonly send: (text: string) => void;
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
    start: useCallback((provider: string, mode: "new" | "resume") => {
      actRef.current("session", { provider, mode }, () => setStreamEpoch((epoch) => epoch + 1));
    }, []),
    send: useCallback((text: string) => {
      actRef.current("message", { text });
    }, []),
    answerPermission: useCallback((requestId: string, optionId: string, decision: "allowed" | "denied") => {
      actRef.current("permission", { requestId, optionId, decision });
    }, []),
    cancelTurn: useCallback(() => {
      actRef.current("cancel", {});
    }, []),
  };
}
