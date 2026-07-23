#!/usr/bin/env node
/**
 * A gate-controlled fake ACP adapter for the run-dispatch e2e test
 * (test/e2e/run-dispatch.e2e.test.ts). Same minimal wire subset as
 * fake-acp-success.cjs (initialize -> session/new -> session/prompt), but
 * `session/prompt` does not answer until the GATE FILE (argv[2]) exists --
 * so a test can hold a run "in progress" deterministically (assert the 409
 * duplicate guard, runs-active, queueing) and then release it by creating
 * the file. No real LLM call -- CI-safe, no auth required.
 */
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const gateFile = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, terminal: false });

let sessionCwd = null;

const send = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

const whenGateOpen = (fn) => {
  if (!gateFile || fs.existsSync(gateFile)) {
    fn();
    return;
  }
  const timer = setInterval(() => {
    if (fs.existsSync(gateFile)) {
      clearInterval(timer);
      fn();
    }
  }, 50);
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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-gated" } } });
    return;
  }

  if (msg.method === "session/new") {
    sessionCwd = msg.params && msg.params.cwd ? msg.params.cwd : process.cwd();
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fake-gated-session-1", models: { currentModelId: "fake-gated-model-1" } },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "fake-gated-session-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Waiting at the gate..." } },
      },
    });
    whenGateOpen(() => {
      try {
        const target = sessionCwd || process.cwd();
        fs.writeFileSync(path.join(target, "fake-output.md"), "# Fake output\n\nWritten by fake-acp-gated.cjs.\n");
      } catch (err) {
        process.stderr.write(`fake-acp-gated: failed to write output: ${err}\n`);
      }
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "fake-gated-session-1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } },
        },
      });
      send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    });
    return;
  }
});
