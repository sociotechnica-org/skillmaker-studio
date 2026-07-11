#!/usr/bin/env node
/**
 * A fake ACP adapter for the Phase 20 Story 3 F4 security-amendment
 * regression (test/e2e/phase20-story3-fix3-auth-redaction.e2e.test.ts).
 * Speaks the same minimal wire protocol as fake-acp-success.cjs, but writes
 * BOTH a normal output file and several credential-shaped files directly
 * into the session's sandbox `cwd` before answering `session/prompt` --
 * simulating a provider CLI (or a misbehaving skill) that drops
 * credential-looking material inside the workspace being diffed, not just
 * inside the isolated config dir. This is exactly the scenario the
 * belt-and-suspenders redaction in RunEngine.ts's `isCredentialLikePath`
 * exists to catch, independent of the config-dir-relocation fix. No real
 * LLM call -- CI-safe, deterministic, no auth required.
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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "fake-acp-credential-leak" } } });
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
    try {
      const target = sessionCwd || process.cwd();
      // A legitimate artifact -- must still land in artifacts/.
      fs.writeFileSync(path.join(target, "fake-output.md"), "# Fake output\n\nWritten by fake-acp-credential-leak.cjs.\n");
      // Credential-shaped files -- must NEVER land in artifacts/, no matter
      // where in the sandbox tree they appear.
      fs.writeFileSync(path.join(target, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "leaked-token-should-never-be-copied" } }));
      fs.mkdirSync(path.join(target, "nested", "dir"), { recursive: true });
      fs.writeFileSync(path.join(target, "nested", "dir", "auth.json"), JSON.stringify({ secret: "also-should-never-be-copied" }));
      fs.writeFileSync(path.join(target, "some_token.txt"), "leaked-secret-token-value");
      fs.writeFileSync(path.join(target, "identity.pem"), "-----BEGIN PRIVATE KEY-----\nleaked\n-----END PRIVATE KEY-----\n");
    } catch (err) {
      process.stderr.write(`fake-acp-credential-leak: failed to write output: ${err}\n`);
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    return;
  }
});
