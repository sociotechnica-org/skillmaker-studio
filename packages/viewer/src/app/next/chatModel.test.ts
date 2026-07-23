/** chatModel.ts: SSE chat events -> renderable items (D9). */
import { describe, expect, test } from "bun:test";
import { chatItemsFromEvents, permissionOptions, pickPermissionChoices } from "./chatModel.ts";
import { parseMarkdown } from "../runtime/markdown.ts";

const update = (updateBody: Record<string, unknown>) => ({
  type: "update",
  update: { sessionId: "s1", update: updateBody },
  t: "2026-07-23T10:00:00.000Z",
});

const agentChunk = (text: string) =>
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });

const userChunk = (text: string) =>
  update({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });

describe("chatItemsFromEvents", () => {
  test("coalesces adjacent agent chunks into one prose item, broken by user messages", () => {
    const items = chatItemsFromEvents([
      { type: "user_message", text: "hello", t: "2026-07-23T09:00:00.000Z" },
      agentChunk("Wor"),
      agentChunk("king on it."),
      { type: "user_message", text: "thanks", t: "2026-07-23T09:01:00.000Z" },
      agentChunk("Done."),
    ]);
    expect(items).toEqual([
      { kind: "user", text: "hello", t: "2026-07-23T09:00:00.000Z" },
      { kind: "agent", text: "Working on it.", t: "2026-07-23T10:00:00.000Z" },
      { kind: "user", text: "thanks", t: "2026-07-23T09:01:00.000Z" },
      { kind: "agent", text: "Done.", t: "2026-07-23T10:00:00.000Z" },
    ]);
  });

  test("chunks that split a markdown TABLE mid-line coalesce byte-exactly into one item that parses to a single table", () => {
    // Real-world artifact check: chunk boundaries landing mid-table must not
    // corrupt the markdown. The joiner may not inject separators or touch
    // newlines -- the coalesced text is the exact concatenation, and the
    // parser must see ONE table with all rows.
    const chunks = [
      "Results so far:\n\n| Skill | Sta",
      "tus |\n| --- ",
      "| --- |\n| alpha | pas",
      "s |\n| beta ",
      "| fail |\n",
    ];
    const items = chatItemsFromEvents(chunks.map(agentChunk));
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item === undefined || item.kind !== "agent") throw new Error("expected one agent item");
    expect(item.text).toBe(chunks.join(""));

    const blocks = parseMarkdown(item.text);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "table"]);
    const table = blocks[1];
    if (table === undefined || table.kind !== "table") throw new Error("expected a table block");
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
  });

  test("a resumed session's replay (user_message_chunk / agent_message_chunk) renders as alternating messages", () => {
    const items = chatItemsFromEvents([userChunk("first ask"), agentChunk("first answer"), userChunk("second ask")]);
    expect(items.map((item) => item.kind)).toEqual(["user", "agent", "user"]);
  });

  test("tool_call + tool_call_update merge into ONE chip by toolCallId, keeping title and latest status", () => {
    const items = chatItemsFromEvents([
      update({ sessionUpdate: "tool_call", toolCallId: "tc-1", title: "Read design.md", kind: "read", status: "in_progress" }),
      agentChunk("reading..."),
      update({ sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed" }),
    ]);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ kind: "tool", toolCallId: "tc-1", title: "Read design.md", status: "completed" });
    expect(items[1]).toMatchObject({ kind: "agent", text: "reading..." });
  });

  test("a tool_call_update for an UNKNOWN id degrades to a fresh chip rather than being dropped", () => {
    const items = chatItemsFromEvents([
      update({ sessionUpdate: "tool_call_update", toolCallId: "tc-mystery", status: "completed" }),
    ]);
    expect(items[0]).toMatchObject({ kind: "tool", toolCallId: "tc-mystery", title: "tool call", status: "completed" });
  });

  test("a tool call between agent chunks breaks coalescing (order preserved, nothing swallowed)", () => {
    const items = chatItemsFromEvents([
      agentChunk("before"),
      update({ sessionUpdate: "tool_call", toolCallId: "tc-2", title: "Run tests", status: "pending" }),
      agentChunk("after"),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["agent", "tool", "agent"]);
  });

  test("permission_request renders a card; permission_resolved marks THAT card resolved in place", () => {
    const params = {
      sessionId: "s1",
      toolCall: { toolCallId: "tc-3", title: "Write /etc/hosts", locations: [{ path: "/etc/hosts" }] },
      options: [
        { optionId: "opt-allow-once", kind: "allow_once" },
        { optionId: "opt-reject-once", kind: "reject_once" },
      ],
    };
    const pendingItems = chatItemsFromEvents([
      { type: "permission_request", id: "perm-1", params, t: "2026-07-23T10:05:00.000Z" },
    ]);
    expect(pendingItems[0]).toMatchObject({
      kind: "permission",
      id: "perm-1",
      title: "Write /etc/hosts",
      resolved: undefined,
    });

    const resolvedItems = chatItemsFromEvents([
      { type: "permission_request", id: "perm-1", params, t: "2026-07-23T10:05:00.000Z" },
      { type: "permission_resolved", id: "perm-1", outcome: "denied", optionId: "opt-reject-once", t: "2026-07-23T10:06:00.000Z" },
    ]);
    expect(resolvedItems[0]).toMatchObject({
      kind: "permission",
      resolved: { outcome: "denied", optionId: "opt-reject-once" },
    });
  });

  test("error events render; unknown event/update kinds and non-text chunks degrade silently", () => {
    const items = chatItemsFromEvents([
      { type: "error", message: "agent exited", t: "2026-07-23T10:10:00.000Z" },
      { type: "turn_ended", stopReason: "end_turn", t: "" },
      { type: "state", state: {} },
      update({ sessionUpdate: "plan", entries: [] }),
      update({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "..." } }),
      "not even an object",
      null,
    ]);
    expect(items).toEqual([{ kind: "error", message: "agent exited", t: "2026-07-23T10:10:00.000Z" }]);
  });
});

describe("user_message image attachments", () => {
  test("well-formed images ride on the user item; malformed entries drop; absent stays absent", () => {
    const items = chatItemsFromEvents([
      {
        type: "user_message",
        text: "look at these",
        t: "2026-07-23T09:00:00.000Z",
        images: [
          { data: "aGVsbG8=", mimeType: "image/png", name: "shot.png" },
          { data: 42, mimeType: "image/png" }, // malformed: drops
          { data: "d29ybGQ=", mimeType: "image/jpeg" },
        ],
      },
      { type: "user_message", text: "no images here", t: "2026-07-23T09:01:00.000Z" },
    ]);
    expect(items).toEqual([
      {
        kind: "user",
        text: "look at these",
        t: "2026-07-23T09:00:00.000Z",
        images: [
          { data: "aGVsbG8=", mimeType: "image/png", name: "shot.png" },
          { data: "d29ybGQ=", mimeType: "image/jpeg" },
        ],
      },
      { kind: "user", text: "no images here", t: "2026-07-23T09:01:00.000Z" },
    ]);
  });

  test("an image-only message (empty text) still renders as a user item", () => {
    const items = chatItemsFromEvents([
      {
        type: "user_message",
        text: "",
        t: "2026-07-23T09:00:00.000Z",
        images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("user");
    if (items[0]?.kind === "user") expect(items[0].images).toHaveLength(1);
  });
});

describe("permission option helpers", () => {
  test("permissionOptions reads well-formed options and drops malformed ones", () => {
    const options = permissionOptions({
      options: [
        { optionId: "a", kind: "allow_once", name: "Allow" },
        { optionId: 42, kind: "allow_once" },
        { optionId: "b", kind: "reject_once" },
      ],
    });
    expect(options).toEqual([
      { optionId: "a", kind: "allow_once", name: "Allow" },
      { optionId: "b", kind: "reject_once" },
    ]);
    expect(permissionOptions(null)).toEqual([]);
    expect(permissionOptions({ options: "nope" })).toEqual([]);
  });

  test("pickPermissionChoices prefers one-shot options and tolerates missing polarities", () => {
    const both = pickPermissionChoices([
      { optionId: "aa", kind: "allow_always" },
      { optionId: "ao", kind: "allow_once" },
      { optionId: "ra", kind: "reject_always" },
      { optionId: "ro", kind: "reject_once" },
    ]);
    expect(both.approve?.optionId).toBe("ao");
    expect(both.deny?.optionId).toBe("ro");

    const allowOnly = pickPermissionChoices([{ optionId: "aa", kind: "allow_always" }]);
    expect(allowOnly.approve?.optionId).toBe("aa");
    expect(allowOnly.deny).toBeUndefined();
  });
});
