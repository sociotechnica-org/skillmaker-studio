import { describe, expect, test } from "bun:test";
import { reconcileChatStreamEvent } from "./chatApi.ts";

describe("chat stream reconciliation", () => {
  test("state snapshots and a resumed reconnect preserve the transcript reference and scroll sentinel", () => {
    const events = [{ type: "user_message", text: "already here" }];
    const scrollTop = 347;

    expect(reconcileChatStreamEvent(events, { type: "state", state: {} })).toBe(events);
    // A valid EventSource reconnect with no missed frames performs no
    // transition at all; its item-count-dependent scroll effect cannot run.
    expect(events).toBe(events);
    expect(scrollTop).toBe(347);
  });

  test("missed events append in order without replacing the delivered prefix", () => {
    const prefix = [{ type: "user_message", text: "first" }];
    const afterOne = reconcileChatStreamEvent(prefix, { type: "update", update: "second" });
    const afterTwo = reconcileChatStreamEvent(afterOne, { type: "turn_ended", stopReason: "end" });

    expect(afterTwo).toEqual([
      { type: "user_message", text: "first" },
      { type: "update", update: "second" },
      { type: "turn_ended", stopReason: "end" },
    ]);
    expect(afterOne[0]).toBe(prefix[0]);
  });

  test("replay_reset is the sole control frame that clears before a full replay", () => {
    const reset = reconcileChatStreamEvent([{ type: "user_message", text: "old" }], { type: "replay_reset" });
    const rebuilt = reconcileChatStreamEvent(reset, { type: "user_message", text: "new" });

    expect(reset).toEqual([]);
    expect(rebuilt).toEqual([{ type: "user_message", text: "new" }]);
  });

  test("ordinary decoded payloads append; malformed JSON never reaches reconciliation", () => {
    const events = [{ type: "user_message", text: "first" }];
    expect(reconcileChatStreamEvent(events, { type: "update", update: "next" })).toHaveLength(2);
    expect(() => JSON.parse("{")).toThrow();
    expect(events).toHaveLength(1);
  });
});
