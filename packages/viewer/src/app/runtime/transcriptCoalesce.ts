/**
 * Transcript rendering transform for the run read-out (issue #142): raw
 * transcript.jsonl lines -> display blocks, with consecutive streamed
 * agent text chunks coalesced into single prose blocks.
 *
 * Render-time only, and pure: the stored transcript is never touched, the
 * same input always yields the same blocks, and coalescing never reorders
 * anything -- it only merges ADJACENT agent text chunks. Tool calls,
 * permission entries, prompts, protocol lines, and non-text chunks all
 * break the run and start fresh blocks.
 *
 * Classification (`classifyEntry`) was extracted from RunDetailModal.tsx so
 * the whole raw-lines -> blocks pipeline is testable without the DOM.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export interface TranscriptBlock {
  /** Left-column tag: who/what this line is. */
  readonly role: string;
  /** One-line summary (or, for a coalesced agent run, the merged prose), always shown. */
  readonly summary: string;
  /** Full detail behind an expander; undefined = nothing to expand. */
  readonly detail: string | undefined;
  /** Visual treatment. */
  readonly tone: "agent" | "prompt" | "tool" | "permission" | "protocol" | "malformed";
}

const asText = (content: unknown): string | undefined => {
  if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
    return content.text;
  }
  return undefined;
};

const promptText = (params: unknown): string => {
  if (isRecord(params) && Array.isArray(params.prompt)) {
    const texts = params.prompt
      .map(asText)
      .filter((text): text is string => text !== undefined);
    if (texts.length > 0) return texts.join("\n");
  }
  return "(prompt)";
};

/**
 * Classifies one raw transcript line ({t, dir, message} with a JSON-RPC
 * message) into a renderable block. Everything unknown degrades to a
 * collapsed "protocol" one-liner -- never a blank hole, never a crash.
 */
export const classifyEntry = (raw: unknown): TranscriptBlock => {
  if (!isRecord(raw)) {
    return { role: "??", summary: String(raw), detail: undefined, tone: "malformed" };
  }
  if (raw.malformed === true) {
    return {
      role: "??",
      summary: "malformed transcript line",
      detail: typeof raw.raw === "string" ? raw.raw : JSON.stringify(raw),
      tone: "malformed",
    };
  }

  const dir = typeof raw.dir === "string" ? raw.dir : "";
  const message = raw.message;
  const json = JSON.stringify(message, null, 2);

  if (dir === "synthetic") {
    return {
      role: "permission",
      summary: "auto-approved permission decision (runner-injected)",
      detail: json,
      tone: "permission",
    };
  }

  if (isRecord(message) && typeof message.method === "string") {
    const method = message.method;
    const params = message.params;

    if (method === "session/request_permission") {
      return { role: "permission", summary: "permission requested", detail: json, tone: "permission" };
    }
    if (method === "session/prompt") {
      return { role: "prompt", summary: promptText(params), detail: json, tone: "prompt" };
    }
    if (method === "session/update" && isRecord(params) && isRecord(params.update)) {
      const update = params.update;
      const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "update";
      if (kind === "agent_message_chunk") {
        const text = asText(update.content);
        return {
          role: "agent",
          summary: text ?? "(non-text chunk)",
          detail: text === undefined ? json : undefined,
          tone: "agent",
        };
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        const title = typeof update.title === "string" ? update.title : kind;
        return { role: "tool", summary: title, detail: json, tone: "tool" };
      }
      return { role: "update", summary: kind, detail: json, tone: "protocol" };
    }
    return { role: dir === "send" ? "client" : "adapter", summary: method, detail: json, tone: "protocol" };
  }

  // A JSON-RPC response (result/error, no method).
  const label = isRecord(message) && "error" in message ? "error response" : "response";
  return { role: dir === "send" ? "client" : "adapter", summary: label, detail: json, tone: "protocol" };
};

/**
 * A block is a mergeable agent text chunk only when it carries plain text
 * (no expandable detail): non-text chunks keep their expander and their own
 * row. `tone` and `role` are both checked so nothing that merely LOOKS
 * agent-ish gets swallowed.
 */
const isAgentText = (block: TranscriptBlock): boolean =>
  block.tone === "agent" && block.role === "agent" && block.detail === undefined;

/**
 * Merges consecutive agent text chunks into single blocks. Streamed chunks
 * are raw fragments of one reply, so they concatenate with no separator --
 * any paragraph breaks the model emitted live inside the chunk text and are
 * preserved verbatim (the row renders with `whitespace-pre-wrap`). Every
 * other block passes through untouched, in order.
 */
export const coalesceBlocks = (
  blocks: ReadonlyArray<TranscriptBlock>,
): ReadonlyArray<TranscriptBlock> => {
  const out: TranscriptBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev !== undefined && isAgentText(prev) && isAgentText(block)) {
      out[out.length - 1] = { ...prev, summary: prev.summary + block.summary };
    } else {
      out.push(block);
    }
  }
  return out;
};

/** The full pipeline the modal renders: raw transcript lines -> coalesced display blocks. */
export const renderTranscript = (raw: ReadonlyArray<unknown>): ReadonlyArray<TranscriptBlock> =>
  coalesceBlocks(raw.map(classifyEntry));
