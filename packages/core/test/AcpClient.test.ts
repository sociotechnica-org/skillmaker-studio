import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  AcpAuthError,
  AcpProtocolError,
  AcpSpawnError,
  AcpTimeoutError,
  runAcpSession,
  stripClaudeCodeEnv,
} from "../src/AcpClient.ts";
import { CLAUDE_CODE_PROFILE, CODEX_PROFILE } from "../src/ProviderProfile.ts";

describe("stripClaudeCodeEnv", () => {
  test("removes CLAUDECODE and the whole CLAUDE_CODE_* family", () => {
    const out = stripClaudeCodeEnv({
      CLAUDECODE: "1",
      CLAUDE_CODE_SSE_PORT: "12345",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      PATH: "/usr/bin",
      HOME: "/home/test",
    });
    expect(out).toEqual({ PATH: "/usr/bin", HOME: "/home/test" });
  });

  test("drops undefined values but keeps everything else untouched", () => {
    const out = stripClaudeCodeEnv({ FOO: "bar", BAZ: undefined, CLAUDECODE: "1" });
    expect(out).toEqual({ FOO: "bar" });
  });

  test("is a no-op when no Claude Code vars are present", () => {
    const env = { PATH: "/usr/bin", LANG: "en_US.UTF-8" };
    expect(stripClaudeCodeEnv(env)).toEqual(env);
  });

  test("handles an empty env", () => {
    expect(stripClaudeCodeEnv({})).toEqual({});
  });
});

describe("runAcpSession failure classification (spike/FINDINGS.md's infra-vs-task table)", () => {
  test("a command that cannot spawn (missing binary) yields AcpSpawnError", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["/no/such/binary-skillmaker-test", "--acp"],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 2000,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(AcpSpawnError);
    }
  });

  test("a process that exits immediately (pre-handshake) yields AcpSpawnError, not a hang", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", "process.exit(1)"],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 2000,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(AcpSpawnError);
    }
  });

  test("session/prompt exceeding its timeout budget yields AcpTimeoutError", async () => {
    // A minimal fake adapter: answers `initialize` and `session/new`
    // immediately, then never responds to `session/prompt` -- exercises the
    // one place `AcpClient` enforces a wall-clock budget (spike/FINDINGS.md
    // open question #2), without ever hanging this test (the client itself
    // rejects on the timeout and closes the subprocess).
    const script = `
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");
        }
        // session/prompt: never respond.
      });
    `;
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", script],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 500,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(AcpTimeoutError);
    }
  }, 10_000);
});

describe("runAcpSession is provider-aware (Phase 12, spike-codex/FINDINGS.md)", () => {
  /** A fake adapter that fails `session/prompt` with -32603 and the real
   * codex model-compat stderr string observed live against
   * `@zed-industries/codex-acp@0.16.0` ("The 'gpt-5.6-sol' model requires a
   * newer version of Codex. Please upgrade..."). */
  const modelCompatFailureScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    process.stderr.write("ERROR codex_core: some unrelated pre-existing skill-parse noise\\n");
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "codex-acp" } } }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1", configOptions: [{ id: "model", currentValue: "gpt-5.6-sol" }] } }) + "\\n");
      } else if (msg.method === "session/prompt") {
        process.stderr.write("thread error: The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.\\n");
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Internal error" } }) + "\\n");
      }
    });
  `;

  test("codex's model-compat -32603 stderr signature classifies as likelyInfra: true under the codex profile", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", modelCompatFailureScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          providerProfile: CODEX_PROFILE,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(AcpProtocolError);
      if (result.failure instanceof AcpProtocolError) {
        expect(result.failure.likelyInfra).toBe(true);
        expect(result.failure.code).toBe(-32603);
      }
    }
  }, 10_000);

  test("the same -32603/stderr does NOT classify as infra under the claude-code profile (its signature list is codex-specific)", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", modelCompatFailureScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          providerProfile: CLAUDE_CODE_PROFILE,
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure" && result.failure instanceof AcpProtocolError) {
      expect(result.failure.likelyInfra).toBe(false);
    }
  }, 10_000);

  test("codex's configOptions-only session/new shape (no models key) still yields a real model id via the provider profile's extractModel", async () => {
    const script = `
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { agentInfo: { name: "codex-acp" } } }) + "\\n");
        } else if (msg.method === "session/new") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1", configOptions: [{ id: "model", currentValue: "gpt-5.4" }] } }) + "\\n");
        } else if (msg.method === "session/prompt") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
        }
      });
    `;
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", script],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          providerProfile: CODEX_PROFILE,
        }),
      ),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.model).toBe("gpt-5.4");
      expect(result.success.stopReason).toBe("end_turn");
    }
  }, 10_000);
});

// Fix F6: verifies the isolation mechanism actually reaches the subprocess,
// via a fake ACP adapter test double that echoes back whatever env vars it
// received (through `agentInfo` on the `initialize` response, the one place
// `runAcpSession` surfaces arbitrary provider-reported data untouched).
// Before this fix, `runAcpSession` was always called with no `env` at all,
// so the adapter inherited the operator's real `$HOME`/`CLAUDE_CONFIG_DIR`
// unfiltered; now RunEngine/StationEngine pass a run-scoped `env` and this
// confirms it actually lands in the subprocess, not just in the call site.
describe("runAcpSession env isolation (Fix F6: the sandbox-config-dir mechanism actually reaches the subprocess)", () => {
  const echoEnvScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { agentInfo: { claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null, codexHome: process.env.CODEX_HOME ?? null } },
        }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");
      } else if (msg.method === "session/prompt") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
      }
    });
  `;

  test("a caller-supplied env var (e.g. an isolated CLAUDE_CONFIG_DIR) reaches the adapter subprocess untouched", async () => {
    const isolatedDir = "/tmp/skillmaker-test-sandbox-config-dir-not-the-real-home";
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", echoEnvScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          env: { CLAUDE_CONFIG_DIR: isolatedDir },
        }),
      ),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      const agentInfo = result.success.agentInfo as { claudeConfigDir: string | null; codexHome: string | null };
      expect(agentInfo.claudeConfigDir).toBe(isolatedDir);
      // Never the operator's real value -- proves the caller's override,
      // not the ambient process.env, is what the subprocess actually sees.
      expect(agentInfo.claudeConfigDir).not.toBe(process.env.HOME);
    }
  }, 10_000);

  test("no env override -> the adapter sees no CLAUDE_CONFIG_DIR/CODEX_HOME set by the client itself (only whatever the test runner's own ambient env already has, if anything)", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", echoEnvScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
        }),
      ),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      const agentInfo = result.success.agentInfo as { claudeConfigDir: string | null; codexHome: string | null };
      expect(agentInfo.claudeConfigDir).toBe(process.env.CLAUDE_CONFIG_DIR ?? null);
    }
  }, 10_000);
});

// Fix 1 (Phase 20 Story 2 friction log F1): `--model <id>` wired through to
// the real ACP mechanism confirmed against `@zed-industries/claude-code-acp
// @0.16.2`'s `dist/acp-agent.js` -- `session/set_model` (JS binding
// `unstable_setSessionModel`), called AFTER `session/new`, validated against
// that response's `models.availableModels`.
//
// Fix 2 (F2): the recorded model is the RESOLVED advertised description
// (e.g. "Haiku 4.6 - Fast and efficient"), never the bare alias
// ("default"/"haiku"/"sonnet") -- closes the pooling hazard where two runs
// on the alias "default" could silently be two different real models.
describe("runAcpSession model selection (Fix 1: session/set_model; Fix 2: resolved model, never the alias)", () => {
  const availableModels = [
    { modelId: "default", name: "Default (recommended)", description: "Opus 4.6 - Most capable for complex work" },
    { modelId: "haiku", name: "Haiku", description: "Haiku 4.6 - Fast and efficient" },
  ];

  const fakeAdapterScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: { sessionId: "s1", models: { currentModelId: "default", availableModels: ${JSON.stringify(availableModels)} } },
        }) + "\\n");
      } else if (msg.method === "session/set_model") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      } else if (msg.method === "session/prompt") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
      }
    });
  `;

  test("no requestedModel -> the adapter's own default is resolved to its advertised description, never the literal alias \"default\"", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", fakeAdapterScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
        }),
      ),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.model).toBe("Opus 4.6 - Most capable for complex work");
      expect(result.success.model).not.toBe("default");
    }
  }, 10_000);

  test("requestedModel matching an advertised id calls session/set_model and records the RESOLVED model, not the requested alias", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", fakeAdapterScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          requestedModel: "haiku",
        }),
      ),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.model).toBe("Haiku 4.6 - Fast and efficient");
      expect(result.success.model).not.toBe("haiku");
      expect(result.success.stopReason).toBe("end_turn");
    }
  }, 10_000);

  test("an unadvertised requestedModel is rejected with an error listing the advertised models, never silently ignored (F1's ANTHROPIC_MODEL bug)", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        runAcpSession({
          command: ["node", "-e", fakeAdapterScript],
          cwd: process.cwd(),
          prompt: "hello",
          promptTimeoutMs: 5000,
          requestedModel: "totally-bogus-model-xyz",
        }),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(AcpProtocolError);
      if (result.failure instanceof AcpProtocolError) {
        expect(result.failure.message).toContain("totally-bogus-model-xyz");
        expect(result.failure.message).toContain("default");
        expect(result.failure.message).toContain("haiku");
        // Not an infra fault -- a bad --model value is a task-level usage
        // problem, distinct from auth/sandbox/connection faults.
        expect(result.failure.likelyInfra).toBe(false);
      }
    }
  }, 10_000);
});

describe("classification error shape", () => {
  test("AcpAuthError and AcpProtocolError both carry stderr for later persistence", () => {
    const auth = AcpAuthError.make({ message: "auth required", stderr: "please /login" });
    expect(auth.stderr).toBe("please /login");

    const protocolError = AcpProtocolError.make({
      message: "internal error",
      code: -32603,
      stderr: "cannot be launched inside another Claude Code session",
      likelyInfra: true,
    });
    expect(protocolError.likelyInfra).toBe(true);
    expect(protocolError.code).toBe(-32603);
  });
});
