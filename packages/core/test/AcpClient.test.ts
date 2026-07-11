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
