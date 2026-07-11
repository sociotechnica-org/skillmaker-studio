#!/usr/bin/env node
/**
 * A fake ACP adapter shaped like `@agentclientprotocol/codex-acp` for
 * Phase 12's mocked e2e test (test/e2e/phase12.e2e.test.ts). Speaks the same
 * minimal wire subset as `fake-acp-success.cjs` (Phase 8), but with the
 * codex-flavored deltas confirmed live against a real `codex-acp` session
 * (spike-codex/FINDINGS.md, re-spiked for Phase 12):
 *
 * - `session/new`'s result carries `configOptions` (an `{id, currentValue}`
 *   array with a `model` entry) ALONGSIDE `models.currentModelId` -- exactly
 *   what `@agentclientprotocol/codex-acp@1.1.2` returned in the real
 *   handshake this phase validated (no `-c model=` pin needed).
 * - No `session/request_permission` round trip for an in-workspace file
 *   write -- codex's `auto` approval mode auto-approves those silently
 *   (confirmed live), unlike claude-code-acp which asks for nearly every
 *   file mutation. This fake never sends a permission request at all.
 * - Writes the output file under whatever `cwd` `session/new` was given, so
 *   the e2e test can assert it landed under the sandbox's `.agents/skills/`
 *   layout (the skill install dir `RunEngine.ts` computes via
 *   `ProviderProfile.ts`'s `codex` profile), not `.claude/skills/`.
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
    send({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "codex-acp", title: "Codex", version: "1.1.2-fake" } } });
    return;
  }

  if (msg.method === "session/new") {
    sessionCwd = msg.params && msg.params.cwd ? msg.params.cwd : process.cwd();

    // Record the sandbox's skill-install layout at handshake time (before
    // any prompt work), so the e2e test can confirm skills landed under
    // `.agents/skills/<bundle>/SKILL.md` (this profile's install dir) rather
    // than `.claude/skills/<bundle>/SKILL.md` (claude-code's). Written as a
    // new file so it survives the sandbox's before/after diff as an
    // artifact -- the sandbox itself is torn down once the run ends, so this
    // is the only way for the test to observe the layout it saw live.
    try {
      const skillMdPath = path.join(sessionCwd, ".agents", "skills", "example-skill", "SKILL.md");
      const wrongPath = path.join(sessionCwd, ".claude", "skills", "example-skill", "SKILL.md");
      fs.writeFileSync(
        path.join(sessionCwd, "skill-install-check.json"),
        JSON.stringify(
          {
            agentsSkillsFound: fs.existsSync(skillMdPath),
            claudeSkillsFound: fs.existsSync(wrongPath),
            checkedPath: skillMdPath,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      process.stderr.write(`fake-acp-codex-success: failed to write skill-install-check: ${err}\n`);
    }

    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId: "fake-codex-session-1",
        models: { currentModelId: "gpt-5.6-sol[xhigh]", availableModels: [] },
        configOptions: [{ id: "model", currentValue: "gpt-5.6-sol[xhigh]" }],
      },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    // A codex-shaped tool_call: read the skill file at
    // .agents/skills/<slug>/SKILL.md, exactly like the real spike observed
    // (no dedicated "Skill" tool -- codex reads it with its native read
    // tool). Used by SkillActivation.test.ts's provider-tolerance contract;
    // included here so this fixture is realistic for trigger-class runs too.
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "fake-codex-session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "exec-1",
          kind: "read",
          title: `Read file '${sessionCwd || process.cwd()}/.agents/skills/example-skill/SKILL.md'`,
          locations: [{ path: `${sessionCwd || process.cwd()}/.agents/skills/example-skill/SKILL.md` }],
        },
      },
    });

    try {
      const target = sessionCwd || process.cwd();
      fs.writeFileSync(path.join(target, "fake-codex-output.md"), "# Fake codex output\n\nWritten by fake-acp-codex-success.cjs.\n");
    } catch (err) {
      process.stderr.write(`fake-acp-codex-success: failed to write output: ${err}\n`);
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    return;
  }
});
