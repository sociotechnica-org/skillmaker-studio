#!/usr/bin/env node
/**
 * A fake ACP adapter for Phase 8's mocked e2e test (test/e2e/phase8.e2e.test.ts).
 * Speaks the minimal subset of the wire protocol `AcpClient.ts` uses:
 * initialize -> session/new -> session/prompt, plus two `session/update`
 * notifications for realism, then writes a file into the session's `cwd`
 * (from `session/new`'s params, NOT this process's own OS cwd) and answers
 * `session/prompt` with `stopReason: "end_turn"`. No real LLM call --
 * CI-safe, deterministic, no auth required.
 */
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let sessionCwd = null;

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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-success" } } });
    return;
  }

  if (msg.method === "session/new") {
    sessionCwd = msg.params && msg.params.cwd ? msg.params.cwd : process.cwd();
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fake-session-1", models: { currentModelId: "fake-model-1" } },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    // Two realistic session/update notifications before finishing.
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "fake-session-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working on it..." } } },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "fake-session-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } },
    });

    try {
      const target = sessionCwd || process.cwd();
      fs.writeFileSync(path.join(target, "fake-output.md"), "# Fake output\n\nWritten by fake-acp-success.cjs.\n");
    } catch (err) {
      process.stderr.write(`fake-acp-success: failed to write output: ${err}\n`);
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    return;
  }
});
