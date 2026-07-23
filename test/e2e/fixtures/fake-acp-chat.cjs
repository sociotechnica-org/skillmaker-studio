#!/usr/bin/env node
/**
 * A fake ACP adapter for the chat surface (D9): the long-lived, multi-prompt
 * sibling of `fake-acp-success.cjs`. Speaks the wire subset
 * `ChatSession.ts` drives, deterministically and with no real LLM:
 *
 * - `initialize` advertises `agentCapabilities.loadSession: true`.
 * - `session/new` -> a fresh session id (`fake-chat-<n>`), persisted into
 *   `<FAKE_CHAT_STATE_DIR>/<sessionId>.json` so a LATER PROCESS can
 *   `session/load` it (real provider-side persistence, minimally).
 * - `session/load` -> replays the persisted history as `user_message_chunk`
 *   / `agent_message_chunk` updates (the ACP spec's replay contract), then
 *   answers null. An unknown id -> JSON-RPC error -32602 (exercises the
 *   fresh-session fallback).
 * - `session/prompt` -> ANY number of turns. Each turn echoes streamed
 *   agent chunks ("turn <n>: <prompt text>" split into two chunks) plus a
 *   `tool_call` + `tool_call_update` pair, appends to the persisted
 *   history, and ends `end_turn`.
 * - A prompt containing "NEEDS-PERMISSION:<path>" first round-trips a
 *   `session/request_permission` for that path (allow_once / allow_always /
 *   reject_once options); the chosen optionId is echoed back as an agent
 *   chunk ("permission answer: <optionId>") so tests can assert what
 *   crossed the wire. Outcome "cancelled" echoes "permission answer:
 *   cancelled".
 * - A prompt containing "HANG" never finishes its turn until a
 *   `session/cancel` arrives -> then answers `stopReason: "cancelled"`.
 * - MODELS (mirroring `claude-code-acp@0.16.2`'s real shape): `initialize`
 *   advertises `promptCapabilities: {image: true}`; `session/new` lists two
 *   `availableModels` with `currentModelId: "fake-chat-model"`; a
 *   `session/set_model` request switches the current model AND emits an
 *   agent chunk `"model set: <modelId>"` so tests can assert the switch
 *   crossed the wire (including the model-at-start call right after
 *   session/new).
 * - IMAGES: prompt content blocks of `{type: "image", data, mimeType}` are
 *   acknowledged inside the echoed turn text as
 *   `[image <mimeType> <decoded-bytes>b]` -- proof the block arrived
 *   intact, decodable, and in order.
 *
 * Env: FAKE_CHAT_STATE_DIR (required) -- where session history files live.
 * CI-safe, deterministic, no auth required.
 */
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const stateDir = process.env.FAKE_CHAT_STATE_DIR;
if (!stateDir) {
  process.stderr.write("fake-acp-chat: FAKE_CHAT_STATE_DIR is required\n");
  process.exit(1);
}
fs.mkdirSync(stateDir, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, terminal: false });

const send = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

const historyPath = (sessionId) => path.join(stateDir, `${sessionId}.json`);
const readHistory = (sessionId) => {
  try {
    return JSON.parse(fs.readFileSync(historyPath(sessionId), "utf8"));
  } catch {
    return null;
  }
};
const writeHistory = (sessionId, history) => {
  fs.writeFileSync(historyPath(sessionId), `${JSON.stringify(history, null, 2)}\n`);
};

const chunk = (sessionId, role, text) => {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: role === "user" ? "user_message_chunk" : "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
};

const AVAILABLE_MODELS = [
  { modelId: "fake-chat-model", name: "Fake Chat Model", description: "The fake default" },
  { modelId: "fake-chat-model-pro", name: "Fake Chat Model Pro", description: "The fake heavyweight" },
];
let currentModelId = "fake-chat-model";
const MODELS_STATE = () => ({ currentModelId, availableModels: AVAILABLE_MODELS });

let sessionId = null;
let turnCount = 0;
let nextOutboundId = 1000;
/** Pending permission request id -> continuation taking the outcome. */
const pendingPermissions = new Map();
/** Pending HANG turn: { promptRequestId } or null. */
let hangingTurn = null;

const PERMISSION_OPTIONS = [
  { optionId: "opt-allow-once", kind: "allow_once" },
  { optionId: "opt-allow-always", kind: "allow_always" },
  { optionId: "opt-reject-once", kind: "reject_once" },
];

const finishTurn = (requestId, promptText, permissionNote) => {
  turnCount += 1;
  const reply = `turn ${turnCount}: ${promptText}`;
  chunk(sessionId, "agent", `${reply.slice(0, 8)}`);
  chunk(sessionId, "agent", `${reply.slice(8)}`);
  if (permissionNote) {
    chunk(sessionId, "agent", `permission answer: ${permissionNote}`);
  }
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `tc-${turnCount}`,
        title: `Fake tool for turn ${turnCount}`,
        kind: "fetch",
        status: "in_progress",
      },
    },
  });
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: `tc-${turnCount}`,
        status: "completed",
      },
    },
  });
  const history = readHistory(sessionId) || { turns: [] };
  history.turns.push({ user: promptText, agent: reply });
  writeHistory(sessionId, history);
  send({ jsonrpc: "2.0", id: requestId, result: { stopReason: "end_turn" } });
};

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  // Answers to our own outbound requests (permission round trips).
  if (msg.id !== undefined && msg.method === undefined && pendingPermissions.has(msg.id)) {
    const resume = pendingPermissions.get(msg.id);
    pendingPermissions.delete(msg.id);
    resume(msg.result ? msg.result.outcome : undefined);
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: "fake-acp-chat" },
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      },
    });
    return;
  }

  if (msg.method === "session/new") {
    sessionId = `fake-chat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    currentModelId = "fake-chat-model";
    writeHistory(sessionId, { turns: [] });
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId, models: MODELS_STATE() },
    });
    return;
  }

  if (msg.method === "session/set_model") {
    const requested = msg.params && msg.params.modelId;
    const known = AVAILABLE_MODELS.some((m) => m.modelId === requested);
    if (!known) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: `unknown model id ${String(requested)}` },
      });
      return;
    }
    currentModelId = requested;
    // Announce over the stream so tests can observe the switch (whether at
    // session start or mid-session).
    if (sessionId) chunk(sessionId, "agent", `model set: ${requested}`);
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  if (msg.method === "session/load") {
    const requested = msg.params && msg.params.sessionId;
    const history = requested ? readHistory(requested) : null;
    if (!history) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: `unknown session id ${String(requested)}` },
      });
      return;
    }
    sessionId = requested;
    turnCount = history.turns.length;
    // The spec's replay contract: full history as chunks BEFORE the response.
    for (const turn of history.turns) {
      chunk(sessionId, "user", turn.user);
      chunk(sessionId, "agent", turn.agent);
    }
    send({ jsonrpc: "2.0", id: msg.id, result: { models: MODELS_STATE() } });
    return;
  }

  if (msg.method === "session/cancel") {
    if (hangingTurn) {
      const { promptRequestId } = hangingTurn;
      hangingTurn = null;
      send({ jsonrpc: "2.0", id: promptRequestId, result: { stopReason: "cancelled" } });
    }
    return;
  }

  if (msg.method === "session/prompt") {
    const parts =
      msg.params && Array.isArray(msg.params.prompt) ? msg.params.prompt : [];
    const promptText = parts
      .map((p) => {
        if (p && p.type === "text" && typeof p.text === "string") return p.text;
        if (p && p.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string") {
          // Acknowledge the image block with its DECODED size -- proof the
          // base64 payload crossed the wire intact.
          return `[image ${p.mimeType} ${Buffer.from(p.data, "base64").length}b]`;
        }
        return null;
      })
      .filter((part) => part !== null)
      .join("\n");

    if (promptText.includes("HANG")) {
      hangingTurn = { promptRequestId: msg.id };
      chunk(sessionId, "agent", "hanging until cancelled...");
      return;
    }

    const permMatch = promptText.match(/NEEDS-PERMISSION:(\S+)/);
    if (permMatch) {
      const filePath = permMatch[1];
      const outboundId = nextOutboundId++;
      pendingPermissions.set(outboundId, (outcome) => {
        const note =
          outcome && outcome.outcome === "selected" ? outcome.optionId : "cancelled";
        finishTurn(msg.id, promptText, note);
      });
      send({
        jsonrpc: "2.0",
        id: outboundId,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: {
            toolCallId: `tc-perm-${outboundId}`,
            kind: "edit",
            title: `Write file ${filePath}`,
            locations: [{ path: filePath }],
            rawInput: { file_path: filePath, content: "fake content" },
          },
          options: PERMISSION_OPTIONS,
        },
      });
      return;
    }

    finishTurn(msg.id, promptText, null);
    return;
  }
});
