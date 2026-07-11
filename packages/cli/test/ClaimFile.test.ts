/**
 * Unit tests for claim-file staleness logic (packages/cli/src/server/ClaimFile.ts)
 * -- `skillmaker start`'s single-instance guard. Uses `classifyClaim` with an
 * injected liveness predicate so no real PIDs or files are needed to test
 * the decision logic itself; `readClaim`/`writeClaim`/`removeClaim` are
 * covered against a real temp file for the I/O half.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyClaim,
  readClaim,
  removeClaim,
  writeClaim,
  type ClaimFileData,
} from "../src/server/ClaimFile.ts";

describe("classifyClaim", () => {
  test("absent when there is no claim", () => {
    expect(classifyClaim(undefined)).toEqual({ kind: "absent" });
  });

  test("running when the claim's pid is alive", () => {
    const claim: ClaimFileData = { pid: 123, port: 4323, startedAt: "2026-07-10T00:00:00.000Z" };
    expect(classifyClaim(claim, () => true)).toEqual({ kind: "running", claim });
  });

  test("stale when the claim's pid is dead, so a new start replaces it", () => {
    const claim: ClaimFileData = { pid: 999999, port: 4323, startedAt: "2026-07-10T00:00:00.000Z" };
    expect(classifyClaim(claim, () => false)).toEqual({ kind: "stale", claim });
  });
});

describe("readClaim / writeClaim / removeClaim", () => {
  let dir: string;

  const claimPath = () => join(dir, "claims", "server.json");

  test("round-trips a written claim", () => {
    dir = mkdtempSync(join(tmpdir(), "skillmaker-claimfile-test-"));
    try {
      expect(readClaim(claimPath())).toBeUndefined();

      const data: ClaimFileData = { pid: process.pid, port: 4323, startedAt: "2026-07-10T00:00:00.000Z" };
      writeClaim(claimPath(), data);
      expect(readClaim(claimPath())).toEqual(data);

      removeClaim(claimPath());
      expect(existsSync(claimPath())).toBe(false);
      expect(readClaim(claimPath())).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removeClaim on an already-missing file is a safe no-op", () => {
    dir = mkdtempSync(join(tmpdir(), "skillmaker-claimfile-test-"));
    try {
      expect(() => removeClaim(claimPath())).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("readClaim tolerates malformed JSON, reporting absent rather than throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "skillmaker-claimfile-test-"));
    try {
      writeClaim(claimPath(), { pid: 1, port: 1, startedAt: "x" });
      writeFileSync(claimPath(), "{ not valid json");
      expect(readClaim(claimPath())).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
