#!/usr/bin/env node
/**
 * A fake ACP adapter for issue #140's permission-policy e2e test
 * (test/e2e/permission-policy.e2e.test.ts). Same minimal wire subset as
 * `fake-acp-success.cjs`, plus the piece the others deliberately omit: two
 * `session/request_permission` round trips during `session/prompt` --
 *
 *   1. an in-sandbox file write (a path under `session/new`'s cwd), and
 *   2. an outside-the-sandbox write (/etc/skillmaker-e2e-denied.txt --
 *      never actually written, only requested),
 *
 * each offering allow_once / allow_always / reject_once options. Whatever
 * option the client selects for each is recorded into
 * `permission-results.json` inside the sandbox, so it survives the run's
 * before/after diff as an artifact and the e2e test can assert which option
 * actually crossed the wire. CI-safe, deterministic, no auth required.
 */
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let sessionCwd = null;
let promptId = null;
const decisions = {};

const send = (msg) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

const PERMISSION_OPTIONS = [
  { optionId: "opt-allow-once", kind: "allow_once" },
  { optionId: "opt-allow-always", kind: "allow_always" },
  { optionId: "opt-reject-once", kind: "reject_once" },
];

const requestPermission = (id, filePath) => {
  send({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: {
      sessionId: "fake-session-1",
      toolCall: {
        toolCallId: `tc-${id}`,
        kind: "edit",
        title: `Write file ${filePath}`,
        locations: [{ path: filePath }],
        rawInput: { file_path: filePath, content: "hello from the fake agent" },
      },
      options: PERMISSION_OPTIONS,
    },
  });
};

const outsidePath = "/etc/skillmaker-e2e-denied.txt";

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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-permissions" } } });
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
    promptId = msg.id;
    // Round trip 1: permission to write INSIDE the sandbox.
    requestPermission(1001, path.join(sessionCwd || process.cwd(), "inside-note.md"));
    return;
  }

  // Responses to our own permission requests come back with our ids.
  if (msg.id === 1001 && msg.result) {
    decisions.inside = msg.result.outcome && msg.result.outcome.optionId;
    if (decisions.inside === "opt-allow-once" || decisions.inside === "opt-allow-always") {
      // Honor the approval, like a real agent would.
      fs.writeFileSync(path.join(sessionCwd || process.cwd(), "inside-note.md"), "hello from the fake agent\n");
    }
    // Round trip 2: permission to write OUTSIDE the sandbox. Never actually
    // written regardless of the answer -- this fake only probes the policy.
    requestPermission(1002, outsidePath);
    return;
  }

  if (msg.id === 1002 && msg.result) {
    decisions.outside = msg.result.outcome && msg.result.outcome.optionId;
    // Persist what the client decided, as an in-sandbox file so it becomes a
    // run artifact the e2e test can read after the sandbox is torn down.
    fs.writeFileSync(
      path.join(sessionCwd || process.cwd(), "permission-results.json"),
      `${JSON.stringify(decisions, null, 2)}\n`,
    );
    send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
    return;
  }
});
