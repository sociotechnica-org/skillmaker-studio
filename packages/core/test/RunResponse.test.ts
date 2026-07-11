/**
 * Unit tests for RunResponse.ts (Phase 20 Story 4 friction log finding #5):
 * extracting `response.md`'s content from a run's transcript.
 */
import { describe, expect, test } from "bun:test";
import { extractResponseText, responseMarkdown } from "../src/RunResponse.ts";

const chunk = (text: string) => ({
  t: "2026-07-11T00:00:00.000Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  },
});

const unrelatedToolCall = {
  t: "2026-07-11T00:00:00.000Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", toolCallId: "tc-1", kind: "read", title: "Read file" },
    },
  },
};

describe("extractResponseText", () => {
  test("concatenates agent_message_chunk texts in transcript order", () => {
    const transcript = [chunk("Working on it..."), unrelatedToolCall, chunk(" Done.")];
    expect(extractResponseText(transcript)).toBe("Working on it... Done.");
  });

  test("no agent_message_chunk updates -> empty string, not a throw", () => {
    expect(extractResponseText([unrelatedToolCall])).toBe("");
    expect(extractResponseText([])).toBe("");
  });

  test("tolerates malformed/unexpected entries", () => {
    const transcript: ReadonlyArray<unknown> = [null, undefined, "not an object", 42, { no: "message field" }];
    expect(extractResponseText(transcript)).toBe("");
  });

  test("ignores non-text content (e.g. a future image/audio chunk shape)", () => {
    const nonText = {
      t: "2026-07-11T00:00:00.000Z",
      dir: "recv",
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "..." } },
        },
      },
    };
    expect(extractResponseText([nonText])).toBe("");
  });

  test("also matches bare `message` objects instead of {t, dir, message} wrappers", () => {
    const bareMessage = chunk("hello").message;
    expect(extractResponseText([bareMessage])).toBe("hello");
  });
});

describe("responseMarkdown", () => {
  test("returns the extracted text, newline-terminated", () => {
    expect(responseMarkdown([chunk("All set.")])).toBe("All set.\n");
  });

  test("does not double a trailing newline that's already there", () => {
    expect(responseMarkdown([chunk("All set.\n")])).toBe("All set.\n");
  });

  test("empty transcript -> an explicit empty-with-note fallback, never a bare empty string", () => {
    const rendered = responseMarkdown([]);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toContain("No agent message found");
  });

  test("whitespace-only chunks -> the same empty-with-note fallback", () => {
    const rendered = responseMarkdown([chunk("   \n  ")]);
    expect(rendered).toContain("No agent message found");
  });
});
