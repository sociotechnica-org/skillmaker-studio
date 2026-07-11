import { describe, expect, test } from "bun:test";
import { didSkillActivate } from "../src/SkillActivation.ts";

const claudeSkillToolCall = (slug: string) => ({
  t: "2026-07-11T00:00:00.000Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        kind: "other",
        title: "Skill",
        rawInput: { name: slug },
      },
    },
  },
});

const codexSkillMdRead = (slug: string) => ({
  t: "2026-07-11T00:00:00.000Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "exec-1",
        kind: "read",
        title: `Read file '/tmp/sandbox/.agents/skills/${slug}/SKILL.md'`,
        locations: [{ path: `/tmp/sandbox/.agents/skills/${slug}/SKILL.md` }],
      },
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
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "exec-2",
        kind: "read",
        title: "Read file '/tmp/sandbox/input.md'",
        locations: [{ path: "/tmp/sandbox/input.md" }],
      },
    },
  },
};

const agentMessageChunk = {
  t: "2026-07-11T00:00:00.000Z",
  dir: "recv",
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    },
  },
};

describe("didSkillActivate", () => {
  test("detects claude-code-acp's Skill tool_call naming the slug", () => {
    const transcript = [agentMessageChunk, claudeSkillToolCall("demo-skill"), unrelatedToolCall];
    expect(didSkillActivate(transcript, "demo-skill")).toBe(true);
  });

  test("detects codex-acp reading .agents/skills/<slug>/SKILL.md via its native read tool", () => {
    const transcript = [unrelatedToolCall, codexSkillMdRead("demo-skill")];
    expect(didSkillActivate(transcript, "demo-skill")).toBe(true);
  });

  test("does not falsely match a different skill's slug", () => {
    const transcript = [claudeSkillToolCall("other-skill"), codexSkillMdRead("other-skill")];
    expect(didSkillActivate(transcript, "demo-skill")).toBe(false);
  });

  test("no tool_call updates at all -> false, not a throw", () => {
    expect(didSkillActivate([agentMessageChunk], "demo-skill")).toBe(false);
    expect(didSkillActivate([], "demo-skill")).toBe(false);
  });

  test("tolerates malformed/unexpected entries", () => {
    const transcript: ReadonlyArray<unknown> = [null, undefined, "not an object", 42, { no: "message field" }];
    expect(didSkillActivate(transcript, "demo-skill")).toBe(false);
  });

  test("also matches when given bare `message` objects instead of {t, dir, message} wrappers", () => {
    const bareMessage = claudeSkillToolCall("demo-skill").message;
    expect(didSkillActivate([bareMessage], "demo-skill")).toBe(true);
  });
});
