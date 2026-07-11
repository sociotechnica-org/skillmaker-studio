#!/usr/bin/env node
/**
 * A fake, prompt-aware ACP adapter for Phase 10's mocked station e2e test
 * (test/e2e/phase10.e2e.test.ts). Speaks the same minimal wire-protocol
 * subset as fake-acp-success.cjs (initialize -> session/new ->
 * session/prompt), but:
 *
 *  - writes `design.md` and `output/SKILL.md` into the session's `cwd`
 *    (the StationEngine sandbox), simulating william-draft-skill-md's work
 *  - if the incoming prompt text contains a "REVISE NOTES:" marker, folds
 *    the notes text into the written output/SKILL.md content so the test
 *    can assert on it
 *  - if `FAKE_ACP_CAPTURE_PROMPT_TO` is set, writes the FULL received
 *    prompt text to that path, so the test can assert the exact prompt
 *    (including revise notes) was actually sent -- not just infer it from
 *    the written output
 *
 * No real LLM call -- CI-safe, deterministic, no auth required.
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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-station" } } });
    return;
  }

  if (msg.method === "session/new") {
    sessionCwd = msg.params && msg.params.cwd ? msg.params.cwd : process.cwd();
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fake-station-session-1", models: { currentModelId: "fake-station-model-1" } },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    const promptText = ((msg.params && msg.params.prompt) || [])
      .map((block) => (block && typeof block.text === "string" ? block.text : ""))
      .join("\n");

    if (process.env.FAKE_ACP_CAPTURE_PROMPT_TO) {
      try {
        fs.writeFileSync(process.env.FAKE_ACP_CAPTURE_PROMPT_TO, promptText);
      } catch (err) {
        process.stderr.write(`fake-acp-station: failed to capture prompt: ${err}\n`);
      }
    }

    const reviseMatch = promptText.match(/REVISE NOTES:\s*(.+)/);
    const reviseNotes = reviseMatch ? reviseMatch[1].trim() : null;

    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "fake-station-session-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Drafting SKILL.md..." } },
      },
    });

    try {
      const target = sessionCwd || process.cwd();
      const designContent = "# Fake Design\n\nDrafted by fake-acp-station.cjs.\n";
      fs.writeFileSync(path.join(target, "design.md"), designContent);

      fs.mkdirSync(path.join(target, "output"), { recursive: true });
      const skillLines = [
        "---",
        "name: fake-drafted-skill",
        "description: A fake skill drafted by fake-acp-station.cjs for the mocked e2e test.",
        "---",
        "",
        "# Fake drafted skill",
        "",
        reviseNotes ? `Revised per notes: ${reviseNotes}` : "Initial draft, no revise notes.",
        "",
      ];
      fs.writeFileSync(path.join(target, "output", "SKILL.md"), skillLines.join("\n"));
    } catch (err) {
      process.stderr.write(`fake-acp-station: failed to write output: ${err}\n`);
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    return;
  }
});
