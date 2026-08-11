/**
 * `runs/<id>/response.md` (Phase 20 Story 4 friction log finding #5): the
 * agent's final message text, extracted from a run's `transcript.jsonl` so
 * grading against an answer key never requires reading raw ACP protocol
 * frames by hand.
 *
 * Best-effort by design -- a run that produced no `agent_message_chunk`
 * updates (a `failed`/`infra-error` run that never got a turn in, or an
 * adapter that streams the final message some other way) still gets a
 * `response.md`, just one that says so plainly instead of being silently
 * missing.
 *
 * Deliberately tolerant of transcript shape, matching `SkillActivation.ts`'s
 * approach: each element is a `{t, dir, message}` `TranscriptEntry`, or --
 * tolerantly -- the bare `message` itself. Concatenates every
 * `session/update` notification whose `update.sessionUpdate ===
 * "agent_message_chunk"` in transcript order -- that's how a streamed final
 * message is chunked across multiple ACP notifications (see
 * `test/e2e/fixtures/fake-acp-success.cjs` for the wire shape).
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Pulls the text out of one `agent_message_chunk` update's `content`, or `undefined` if this line isn't one. */
const agentMessageChunkText = (entry: unknown): string | undefined => {
  if (!isRecord(entry)) return undefined;
  const message = entry.message ?? entry;
  if (!isRecord(message)) return undefined;
  if (message.method !== "session/update") return undefined;
  const params = message.params;
  if (!isRecord(params)) return undefined;
  const update = params.update;
  if (!isRecord(update)) return undefined;
  if (update.sessionUpdate !== "agent_message_chunk") return undefined;
  const content = update.content;
  if (!isRecord(content)) return undefined;
  if (content.type !== "text") return undefined;
  return typeof content.text === "string" ? content.text : undefined;
};

/**
 * Concatenates every `agent_message_chunk` text in transcript order into
 * the agent's final message. Returns `""` if the transcript carries no such
 * chunks -- callers decide how to render that (see `responseMarkdown`).
 */
export const extractResponseText = (transcript: ReadonlyArray<unknown>): string => {
  const chunks: string[] = [];
  for (const entry of transcript) {
    const text = agentMessageChunkText(entry);
    if (text !== undefined) chunks.push(text);
  }
  return chunks.join("");
};

/**
 * Renders `runs/<id>/response.md`'s full content: the extracted text, or an
 * explicit empty-with-note fallback so an empty file always reads as "the
 * agent produced no message," never as a write that silently failed.
 */
export const responseMarkdown = (transcript: ReadonlyArray<unknown>): string => {
  const text = extractResponseText(transcript);
  if (text.trim().length === 0) {
    return "_No agent message found in this run's transcript._\n";
  }
  return text.endsWith("\n") ? text : `${text}\n`;
};
