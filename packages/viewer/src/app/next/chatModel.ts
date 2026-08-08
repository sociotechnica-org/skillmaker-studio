/**
 * Pure transform: the chat SSE event stream (`/api/chat/:skill/stream`,
 * see packages/cli/src/server/ChatSessions.ts) -> renderable chat items.
 *
 * Mirrors runtime/transcriptCoalesce.ts's philosophy for the live surface:
 * render-time only, pure, order-preserving -- adjacent streamed text chunks
 * of the same role coalesce into one prose item (the same rule
 * `coalesceBlocks` applies to stored transcripts), tool calls merge their
 * `tool_call_update`s by toolCallId into a single chip, and everything
 * unknown degrades to nothing rather than crashing the panel.
 *
 * Feeds on BOTH live traffic and a resumed session's history: ACP
 * `session/load` replays the prior conversation as `user_message_chunk` /
 * `agent_message_chunk` updates, which land here as ordinary `update`
 * events -- so a resumed chat rebuilds its transcript with zero
 * skillmaker-side storage.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// -- Wire shapes (decoded tolerantly; the stream is same-origin trusted) ----

export interface ChatPermissionOptionWire {
  readonly optionId: string;
  readonly kind: string;
  readonly name?: string;
}

export type ChatStreamEventWire = Record<string, unknown>;

// -- Render items -----------------------------------------------------------

/** An image attached to a sent user message (base64 + mime type, straight off the `user_message` stream event). */
export interface ChatItemImage {
  readonly data: string;
  readonly mimeType: string;
  readonly name?: string;
}

export type ChatItem =
  | {
      readonly kind: "user";
      readonly text: string;
      readonly t: string;
      /** Machine-authored production context (the first-prompt preamble / resume re-orientation) prepended server-side; rendered as a collapsed chip, never as message text. */
      readonly context?: string;
      readonly images?: ReadonlyArray<ChatItemImage>;
      /** True while this message is held server-side awaiting the turn boundary (issue #191): rendered as a visually distinct pending bubble until the matching `queue_delivered` event flips it. */
      readonly pending?: boolean;
    }
  | { readonly kind: "agent"; readonly text: string; readonly t: string }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly title: string;
      readonly status: string;
      readonly t: string;
    }
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly title: string;
      readonly options: ReadonlyArray<ChatPermissionOptionWire>;
      readonly resolved: { readonly outcome: string; readonly optionId?: string } | undefined;
      readonly t: string;
    }
  | { readonly kind: "error"; readonly message: string; readonly t: string };

/** The images array off a `user_message` event, tolerantly decoded (malformed entries drop, never crash the panel). */
const decodeItemImages = (raw: unknown): ReadonlyArray<ChatItemImage> => {
  if (!Array.isArray(raw)) return [];
  const out: ChatItemImage[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.data !== "string" || typeof entry.mimeType !== "string") continue;
    out.push({
      data: entry.data,
      mimeType: entry.mimeType,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
    });
  }
  return out;
};

/**
 * The server's first-prompt preamble markers (keep in sync with
 * packages/cli/src/server/ChatSessions.ts). Live `user_message` events
 * carry the preamble in a separate `context` field -- but a RESUMED
 * session's history arrives as the provider's replay of the raw wire
 * prompt, preamble inlined. `splitPreamble` peels it back off so the
 * replayed transcript renders the same collapsed context chip.
 */
const PREAMBLE_SENTINELS = ["You're inside Skillmaker Studio.", "Re-orientation:"] as const;
const PREAMBLE_SEPARATOR = "\n\n---\n\n";

export const splitPreamble = (
  text: string,
): { readonly context: string; readonly text: string } | undefined => {
  if (!PREAMBLE_SENTINELS.some((sentinel) => text.startsWith(sentinel))) return undefined;
  const cut = text.indexOf(PREAMBLE_SEPARATOR);
  // No separator -> the whole prompt was machine-authored (the orientation
  // opening: preamble + orient instruction, no user words) -> all context.
  if (cut === -1) return { context: text, text: "" };
  return { context: text.slice(0, cut), text: text.slice(cut + PREAMBLE_SEPARATOR.length) };
};

const asText = (content: unknown): string | undefined =>
  isRecord(content) && content.type === "text" && typeof content.text === "string"
    ? content.text
    : undefined;

const eventTime = (event: ChatStreamEventWire): string =>
  typeof event.t === "string" ? event.t : "";

/** The agent's offered permission options, tolerantly read from the forwarded `session/request_permission` params. */
export const permissionOptions = (params: unknown): ReadonlyArray<ChatPermissionOptionWire> => {
  if (!isRecord(params) || !Array.isArray(params.options)) return [];
  const out: ChatPermissionOptionWire[] = [];
  for (const option of params.options) {
    if (isRecord(option) && typeof option.optionId === "string" && typeof option.kind === "string") {
      out.push({
        optionId: option.optionId,
        kind: option.kind,
        ...(typeof option.name === "string" ? { name: option.name } : {}),
      });
    }
  }
  return out;
};

const permissionTitle = (params: unknown): string => {
  if (isRecord(params) && isRecord(params.toolCall) && typeof params.toolCall.title === "string") {
    return params.toolCall.title;
  }
  return "Permission requested";
};

/** The approve/deny choices a permission card's two buttons map to: approve prefers a one-shot allow, deny prefers a one-shot reject. Undefined when the agent offered no option of that polarity. */
export const pickPermissionChoices = (
  options: ReadonlyArray<ChatPermissionOptionWire>,
): {
  readonly approve: ChatPermissionOptionWire | undefined;
  readonly deny: ChatPermissionOptionWire | undefined;
} => ({
  approve:
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind === "allow_always") ??
    options.find((o) => o.kind.includes("allow")),
  deny:
    options.find((o) => o.kind === "reject_once") ??
    options.find((o) => o.kind === "reject_always") ??
    options.find((o) => o.kind.includes("reject") || o.kind.includes("deny")),
});

interface MutableToolItem {
  kind: "tool";
  toolCallId: string;
  title: string;
  status: string;
  t: string;
}

/** Appends streamed text to the trailing item when it has the same role; otherwise starts a new item. */
const appendChunk = (items: ChatItem[], role: "user" | "agent", text: string, t: string): void => {
  const last = items[items.length - 1];
  if (last !== undefined && last.kind === role) {
    items[items.length - 1] = { ...last, text: last.text + text };
  } else {
    items.push({ kind: role, text, t });
  }
};

/**
 * The full pipeline the ChatTab renders: SSE events (in arrival order) ->
 * chat items. `state` / `turn_ended` events shape the panel's status
 * indicator, not the item list, so they pass through silently here.
 */
export const chatItemsFromEvents = (events: ReadonlyArray<unknown>): ReadonlyArray<ChatItem> => {
  const items: ChatItem[] = [];
  const toolByCallId = new Map<string, MutableToolItem>();
  const permissionIndexById = new Map<string, number>();
  // Queued (server-held) user messages, matched to their later
  // `queue_delivered` by queueId. Replay-safe: a reconnect replays BOTH
  // events in order, so the bubble resolves identically and never
  // duplicates (the message item exists once, at its send position).
  const userIndexByQueueId = new Map<string, number>();

  for (const raw of events) {
    if (!isRecord(raw) || typeof raw.type !== "string") continue;
    const t = eventTime(raw);

    if (raw.type === "user_message" && typeof raw.text === "string") {
      const images = decodeItemImages(raw.images);
      if (typeof raw.queueId === "string") userIndexByQueueId.set(raw.queueId, items.length);
      items.push({
        kind: "user",
        text: raw.text,
        t,
        ...(typeof raw.context === "string" && raw.context.length > 0 ? { context: raw.context } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(raw.queued === true ? { pending: true } : {}),
      });
      continue;
    }

    if (raw.type === "queue_delivered" && typeof raw.queueId === "string") {
      const index = userIndexByQueueId.get(raw.queueId);
      const item = index !== undefined ? items[index] : undefined;
      if (index !== undefined && item !== undefined && item.kind === "user") {
        items[index] = { ...item, pending: false };
      }
      continue;
    }

    if (raw.type === "update" && isRecord(raw.update) && isRecord(raw.update.update)) {
      const update = raw.update.update;
      const sessionUpdate = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";

      if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "user_message_chunk") {
        const text = asText(update.content);
        if (text !== undefined && text.length > 0) {
          appendChunk(items, sessionUpdate === "user_message_chunk" ? "user" : "agent", text, t);
        }
        continue;
      }

      if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
        const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
        if (toolCallId.length === 0) continue;
        const title = typeof update.title === "string" ? update.title : undefined;
        const status = typeof update.status === "string" ? update.status : undefined;
        const existing = toolByCallId.get(toolCallId);
        if (existing !== undefined) {
          // Merge in place: a tool call is ONE chip however many updates it
          // streams (Zed's acp_thread pattern, matched on toolCallId).
          if (title !== undefined) existing.title = title;
          if (status !== undefined) existing.status = status;
        } else {
          // tool_call_update for an unknown id degrades to a fresh chip
          // rather than being dropped -- never a blank hole.
          const item: MutableToolItem = {
            kind: "tool",
            toolCallId,
            title: title ?? "tool call",
            status: status ?? "pending",
            t,
          };
          toolByCallId.set(toolCallId, item);
          items.push(item);
        }
        continue;
      }

      continue; // plan/thought/available_commands etc.: not rendered yet (director's chip pass comes later).
    }

    if (raw.type === "permission_request" && typeof raw.id === "string") {
      permissionIndexById.set(raw.id, items.length);
      items.push({
        kind: "permission",
        id: raw.id,
        title: permissionTitle(raw.params),
        options: permissionOptions(raw.params),
        resolved: undefined,
        t,
      });
      continue;
    }

    if (raw.type === "permission_resolved" && typeof raw.id === "string") {
      const index = permissionIndexById.get(raw.id);
      const item = index !== undefined ? items[index] : undefined;
      if (index !== undefined && item !== undefined && item.kind === "permission") {
        items[index] = {
          ...item,
          resolved: {
            outcome: typeof raw.outcome === "string" ? raw.outcome : "resolved",
            ...(typeof raw.optionId === "string" ? { optionId: raw.optionId } : {}),
          },
        };
      }
      continue;
    }

    if (raw.type === "error" && typeof raw.message === "string") {
      items.push({ kind: "error", message: raw.message, t });
      continue;
    }
  }

  // Replayed history (resume) inlines the preamble in the first user
  // message's text -- peel it back into a context chip once the chunks
  // have fully coalesced.
  return items.map((item) => {
    if (item.kind !== "user" || item.context !== undefined) return item;
    const split = splitPreamble(item.text);
    return split === undefined ? item : { ...item, context: split.context, text: split.text };
  });
};
