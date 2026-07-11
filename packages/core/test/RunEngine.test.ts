import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpAuthError, AcpProtocolError, AcpSpawnError, AcpTimeoutError } from "../src/AcpClient.ts";
import { Actor } from "../src/Actor.ts";
import { RunRecord } from "../src/Run.ts";
import { _internal } from "../src/RunEngine.ts";

const { snapshotTree, diffTrees, resolveFixtureFilesDir, classifyAcpError } = _internal;

const withTempDir = <A>(fn: (dir: string) => A): A => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-runengine-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("snapshotTree / diffTrees", () => {
  test("snapshots every file recursively, skipping .git", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, "top.md"), "top");
      writeFileSync(join(dir, "nested", "leaf.md"), "leaf");

      const snapshot = snapshotTree(dir);
      expect(snapshot.has(".git/HEAD")).toBe(false);
      expect(snapshot.has("top.md")).toBe(true);
      expect(snapshot.has("nested/leaf.md")).toBe(true);
      expect(snapshot.size).toBe(2);
    });
  });

  test("diffTrees reports new files and changed-content files, not unchanged ones", () => {
    const before = new Map([
      ["unchanged.md", "hash-a"],
      ["changed.md", "hash-b"],
    ]);
    const after = new Map([
      ["unchanged.md", "hash-a"],
      ["changed.md", "hash-b-prime"],
      ["new.md", "hash-c"],
    ]);
    expect(diffTrees(before, after)).toEqual(["changed.md", "new.md"]);
  });

  test("diffTrees on a real before/after sandbox snapshot", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "a.md"), "one");
      const before = snapshotTree(dir);

      writeFileSync(join(dir, "a.md"), "one-changed");
      writeFileSync(join(dir, "b.md"), "new file");
      const after = snapshotTree(dir);

      expect(diffTrees(before, after)).toEqual(["a.md", "b.md"]);
    });
  });

  test("diffTrees does not report a file removed between snapshots (append-only artifact model)", () => {
    const before = new Map([["gone.md", "hash-a"]]);
    const after = new Map<string, string>();
    expect(diffTrees(before, after)).toEqual([]);
  });
});

describe("resolveFixtureFilesDir", () => {
  test("defaults to \"files\" when case.json is missing", () => {
    withTempDir((dir) => {
      expect(resolveFixtureFilesDir(dir)).toBe("files");
    });
  });

  test("defaults to \"files\" when case.json has no setup.files", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "case.json"), JSON.stringify({ class: "golden" }));
      expect(resolveFixtureFilesDir(dir)).toBe("files");
    });
  });

  test("reads setup.files when present", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "case.json"), JSON.stringify({ setup: { files: "custom-dir" } }));
      expect(resolveFixtureFilesDir(dir)).toBe("custom-dir");
    });
  });

  test("tolerates malformed case.json, falling back to the default", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "case.json"), "{ not valid json");
      expect(resolveFixtureFilesDir(dir)).toBe("files");
    });
  });
});

describe("classifyAcpError (spike/FINDINGS.md's infra-vs-task table)", () => {
  test("AcpSpawnError -> infra-error", () => {
    const result = classifyAcpError(AcpSpawnError.make({ message: "spawn failed", stderr: "" }));
    expect(result.status).toBe("infra-error");
  });

  test("AcpAuthError -> infra-error", () => {
    const result = classifyAcpError(AcpAuthError.make({ message: "auth required", stderr: "" }));
    expect(result.status).toBe("infra-error");
  });

  test("AcpTimeoutError -> infra-error", () => {
    const result = classifyAcpError(
      AcpTimeoutError.make({ message: "timed out", timeoutMs: 300_000, stderr: "" }),
    );
    expect(result.status).toBe("infra-error");
  });

  test("AcpProtocolError with likelyInfra -> infra-error", () => {
    const result = classifyAcpError(
      AcpProtocolError.make({
        message: "internal error",
        code: -32603,
        stderr: "cannot be launched inside another Claude Code session",
        likelyInfra: true,
      }),
    );
    expect(result.status).toBe("infra-error");
  });

  test("AcpProtocolError without likelyInfra -> failed (task-level)", () => {
    const result = classifyAcpError(
      AcpProtocolError.make({
        message: "the agent rejected the request",
        code: -32602,
        stderr: "",
        likelyInfra: false,
      }),
    );
    expect(result.status).toBe("failed");
  });

  test("stderr is preserved through classification for later persistence", () => {
    const result = classifyAcpError(
      AcpSpawnError.make({ message: "spawn failed", stderr: "npm ERR! 404 not found" }),
    );
    expect(result.stderr).toBe("npm ERR! 404 not found");
  });
});

describe("RunRecord round-trip (data-model.md §2.8)", () => {
  const actor = Actor.make({ kind: "user", name: "test-user" });

  test("encodes and decodes a running record", () => {
    const record = RunRecord.make({
      schemaVersion: 1,
      id: "run-1",
      bundle: "example-skill",
      kind: "eval",
      station: null,
      fixtureCase: "golden-basic",
      skillVersionHash: "sha256:abc123",
      provider: "claude-code",
      model: "",
      startedAt: "2026-07-10T00:00:00.000Z",
      status: "running",
      actor,
    });

    const json = JSON.stringify(record);
    const decoded = Schema.decodeUnknownSync(RunRecord)(JSON.parse(json));
    expect(decoded.id).toBe("run-1");
    expect(decoded.status).toBe("running");
    expect(decoded.endedAt).toBeUndefined();
  });

  test("encodes and decodes a completed record with endedAt/model set", () => {
    const record = RunRecord.make({
      schemaVersion: 1,
      id: "run-2",
      bundle: "example-skill",
      kind: "eval",
      station: null,
      fixtureCase: "golden-basic",
      skillVersionHash: "sha256:abc123",
      provider: "claude-code",
      model: "claude-sonnet-5",
      startedAt: "2026-07-10T00:00:00.000Z",
      endedAt: "2026-07-10T00:03:00.000Z",
      status: "completed",
      actor,
    });

    const json = JSON.stringify(record);
    const decoded = Schema.decodeUnknownSync(RunRecord)(JSON.parse(json));
    expect(decoded.endedAt).toBe("2026-07-10T00:03:00.000Z");
    expect(decoded.model).toBe("claude-sonnet-5");
    expect(decoded.status).toBe("completed");
  });

  test("rejects a record with an invalid status", () => {
    const raw = {
      schemaVersion: 1,
      id: "run-3",
      bundle: "example-skill",
      kind: "eval",
      station: null,
      skillVersionHash: "sha256:abc123",
      provider: "claude-code",
      model: "",
      startedAt: "2026-07-10T00:00:00.000Z",
      status: "not-a-real-status",
      actor: { kind: "user", name: "test-user" },
    };
    expect(() => Schema.decodeUnknownSync(RunRecord)(raw)).toThrow();
  });
});
