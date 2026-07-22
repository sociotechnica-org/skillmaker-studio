import { describe, expect, test } from "bun:test";
import {
  classifyEntry,
  coalesceBlocks,
  renderTranscript,
  type TranscriptBlock,
} from "./transcriptCoalesce.ts";

// ---------------------------------------------------------------------------
// Raw transcript line builders ({t, dir, message} as written by the runner).
// ---------------------------------------------------------------------------

const agentChunk = (text: string): unknown => ({
  t: "2026-07-21T00:00:00Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } },
  },
});

const nonTextChunk = (): unknown => ({
  t: "2026-07-21T00:00:00Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "..." } } },
  },
});

const toolCall = (kind: "tool_call" | "tool_call_update", title: string): unknown => ({
  t: "2026-07-21T00:00:01Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: "s1", update: { sessionUpdate: kind, toolCallId: "tc1", title } },
  },
});

const permissionRequest = (): unknown => ({
  t: "2026-07-21T00:00:02Z",
  dir: "recv",
  message: { jsonrpc: "2.0", id: 7, method: "session/request_permission", params: {} },
});

const prompt = (text: string): unknown => ({
  t: "2026-07-21T00:00:00Z",
  dir: "send",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "session/prompt",
    params: { sessionId: "s1", prompt: [{ type: "text", text }] },
  },
});

const block = (overrides: Partial<TranscriptBlock>): TranscriptBlock => ({
  role: "agent",
  summary: "text",
  detail: undefined,
  tone: "agent",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fragment merging
// ---------------------------------------------------------------------------

describe("coalesceBlocks: fragment merging", () => {
  test("consecutive agent text chunks merge into one block", () => {
    const merged = coalesceBlocks([
      block({ summary: "The skill " }),
      block({ summary: "needs a " }),
      block({ summary: "risk map." }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("The skill needs a risk map.");
    expect(merged[0]?.tone).toBe("agent");
    expect(merged[0]?.detail).toBeUndefined();
  });

  test("paragraph breaks inside chunks are preserved verbatim", () => {
    const merged = coalesceBlocks([
      block({ summary: "First paragraph." }),
      block({ summary: "\n\nSecond " }),
      block({ summary: "paragraph." }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("First paragraph.\n\nSecond paragraph.");
  });

  test("a single agent chunk passes through unchanged", () => {
    const only = block({ summary: "hello" });
    expect(coalesceBlocks([only])).toEqual([only]);
  });

  test("empty input yields empty output", () => {
    expect(coalesceBlocks([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Role boundaries
// ---------------------------------------------------------------------------

describe("coalesceBlocks: role boundaries", () => {
  test("a prompt between agent runs keeps the runs separate", () => {
    const merged = coalesceBlocks([
      block({ summary: "before " }),
      block({ summary: "the prompt" }),
      block({ role: "prompt", tone: "prompt", summary: "user asks", detail: "{}" }),
      block({ summary: "after " }),
      block({ summary: "the prompt" }),
    ]);
    expect(merged.map((b) => b.summary)).toEqual([
      "before the prompt",
      "user asks",
      "after the prompt",
    ]);
  });

  test("permission and protocol blocks never merge, even when adjacent to each other", () => {
    const rows: ReadonlyArray<TranscriptBlock> = [
      block({ role: "permission", tone: "permission", summary: "permission requested", detail: "{}" }),
      block({ role: "permission", tone: "permission", summary: "permission requested", detail: "{}" }),
      block({ role: "update", tone: "protocol", summary: "plan", detail: "{}" }),
      block({ role: "update", tone: "protocol", summary: "plan", detail: "{}" }),
    ];
    expect(coalesceBlocks(rows)).toEqual(rows);
  });

  test("a non-text agent chunk (detail present) breaks the run and stays its own row", () => {
    const nonText = block({ summary: "(non-text chunk)", detail: "{...}" });
    const merged = coalesceBlocks([
      block({ summary: "a" }),
      nonText,
      block({ summary: "b" }),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[1]).toEqual(nonText);
  });
});

// ---------------------------------------------------------------------------
// Tool interleaving
// ---------------------------------------------------------------------------

describe("coalesceBlocks: tool interleaving", () => {
  test("tool rows break agent runs and are never merged; ordering is unchanged", () => {
    const merged = coalesceBlocks([
      block({ summary: "Let me check " }),
      block({ summary: "the file." }),
      block({ role: "tool", tone: "tool", summary: "Read SKILL.md", detail: "{}" }),
      block({ role: "tool", tone: "tool", summary: "Read SKILL.md", detail: "{}" }),
      block({ summary: "Found " }),
      block({ summary: "it." }),
    ]);
    expect(merged.map((b) => [b.tone, b.summary])).toEqual([
      ["agent", "Let me check the file."],
      ["tool", "Read SKILL.md"],
      ["tool", "Read SKILL.md"],
      ["agent", "Found it."],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Empty chunks
// ---------------------------------------------------------------------------

describe("coalesceBlocks: empty chunks", () => {
  test("empty chunks merge invisibly into the surrounding run", () => {
    const merged = coalesceBlocks([
      block({ summary: "a" }),
      block({ summary: "" }),
      block({ summary: "b" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("ab");
  });

  test("a run of only empty chunks collapses to one empty block, not zero (order and count of rows stay honest)", () => {
    const merged = coalesceBlocks([block({ summary: "" }), block({ summary: "" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Full pipeline on raw transcript lines
// ---------------------------------------------------------------------------

describe("renderTranscript", () => {
  test("a streamed reply interleaved with tool calls renders as prose blocks around tool rows", () => {
    const blocks = renderTranscript([
      prompt("Improve the skill"),
      agentChunk("I'll start by "),
      agentChunk("reading the bundle.\n\n"),
      agentChunk("One moment."),
      toolCall("tool_call", "Read bundle"),
      toolCall("tool_call_update", "Read bundle"),
      agentChunk("Done -- the bundle "),
      agentChunk("looks healthy."),
    ]);
    expect(blocks.map((b) => [b.tone, b.summary])).toEqual([
      ["prompt", "Improve the skill"],
      ["agent", "I'll start by reading the bundle.\n\nOne moment."],
      ["tool", "Read bundle"],
      ["tool", "Read bundle"],
      ["agent", "Done -- the bundle looks healthy."],
    ]);
  });

  test("permission requests break agent runs", () => {
    const blocks = renderTranscript([
      agentChunk("May I "),
      agentChunk("write this file?"),
      permissionRequest(),
      agentChunk("Thanks."),
    ]);
    expect(blocks.map((b) => b.tone)).toEqual(["agent", "permission", "agent"]);
    expect(blocks[0]?.summary).toBe("May I write this file?");
  });

  test("non-text agent chunks keep their expander row between text runs", () => {
    const blocks = renderTranscript([agentChunk("look: "), nonTextChunk(), agentChunk("done")]);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]?.summary).toBe("(non-text chunk)");
    expect(blocks[1]?.detail).toBeDefined();
  });

  test("re-running the transform on the same input is identical (pure, render-time only)", () => {
    const raw = [prompt("p"), agentChunk("a"), agentChunk("b"), toolCall("tool_call", "T"), agentChunk("c")];
    expect(renderTranscript(raw)).toEqual(renderTranscript(raw));
  });

  test("classifyEntry degrades unknown lines to protocol/malformed without crashing", () => {
    expect(classifyEntry("garbage").tone).toBe("malformed");
    expect(classifyEntry({ malformed: true, raw: "{oops" }).tone).toBe("malformed");
    expect(classifyEntry({ dir: "recv", message: { jsonrpc: "2.0", id: 1, result: {} } }).tone).toBe(
      "protocol",
    );
  });
});
