#!/usr/bin/env node
/**
 * A fake ACP adapter that completes the handshake but ends the session with
 * a non-"end_turn" stopReason — a genuine TASK failure (not infra), so the
 * runner must record status "failed" and `sms-runner` must exit 1.
 */
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

const send = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
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

  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-task-fail" } } });
    return;
  }

  if (msg.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fake-session-1", models: { currentModelId: "fake-model-1" } },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "refusal" } });
    return;
  }
});
