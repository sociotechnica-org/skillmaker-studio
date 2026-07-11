/**
 * Unit tests for Fix (Phase 20 Story 3 friction log F4) -- `AuthSeeding.ts`
 * copies ONLY the auth material each provider's CLI actually reads into an
 * isolated config dir, never skills/settings, and never throws (best-effort,
 * reported via `AuthSeedResult`).
 *
 * The macOS-Keychain fallback for claude-code (used when no
 * `.credentials.json` file exists) is intentionally NOT exercised here --
 * it depends on the real machine's login state and isn't something a unit
 * test should assume one way or the other. It's covered instead by the real
 * gated run verification (`test/e2e/phase8-real.e2e.test.ts`,
 * `SKILLMAKER_REAL_ACP=1`), which this fix's rollout used to confirm the
 * Keychain path live against a real, already-authenticated `claude` CLI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProviderAuth } from "../src/AuthSeeding.ts";

let sourceDir: string;
let isolatedConfigDir: string;
let previousCodexHome: string | undefined;
let previousClaudeConfigDir: string | undefined;

beforeEach(() => {
  sourceDir = mkdtempSync(join(tmpdir(), "skillmaker-authseed-source-"));
  isolatedConfigDir = join(mkdtempSync(join(tmpdir(), "skillmaker-authseed-dest-")), "isolated");
  previousCodexHome = process.env.CODEX_HOME;
  previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(isolatedConfigDir, { recursive: true, force: true });
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }
  if (previousClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

describe("seedProviderAuth: codex", () => {
  test("copies $CODEX_HOME/auth.json into the isolated config dir when it exists", () => {
    process.env.CODEX_HOME = sourceDir;
    writeFileSync(join(sourceDir, "auth.json"), '{"token":"fake-codex-token"}');

    const result = seedProviderAuth("codex", isolatedConfigDir);

    expect(result.seeded).toBe(true);
    expect(result.source).toBe(join(sourceDir, "auth.json"));
    const dest = join(isolatedConfigDir, "auth.json");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe('{"token":"fake-codex-token"}');
    // 0600: owner read/write only -- never world/group-readable.
    expect(statSync(dest).mode & 0o777).toBe(0o600);
  });

  test("never copies anything else from $CODEX_HOME (e.g. skills, settings)", () => {
    process.env.CODEX_HOME = sourceDir;
    writeFileSync(join(sourceDir, "auth.json"), '{"token":"fake-codex-token"}');
    mkdirSync(join(sourceDir, "skills", "some-skill"), { recursive: true });
    writeFileSync(join(sourceDir, "skills", "some-skill", "SKILL.md"), "# not auth material\n");
    writeFileSync(join(sourceDir, "config.toml"), "some_setting = true\n");

    seedProviderAuth("codex", isolatedConfigDir);

    expect(existsSync(join(isolatedConfigDir, "skills"))).toBe(false);
    expect(existsSync(join(isolatedConfigDir, "config.toml"))).toBe(false);
  });

  test("reports a precise, actionable hint (never throws) when no auth.json exists", () => {
    process.env.CODEX_HOME = sourceDir; // exists as a dir, but empty -- no auth.json

    const result = seedProviderAuth("codex", isolatedConfigDir);

    expect(result.seeded).toBe(false);
    expect(result.missingHint).toContain(join(sourceDir, "auth.json"));
    expect(result.missingHint).toContain("codex login");
    // Best-effort: no exception, and nothing was created.
    expect(existsSync(isolatedConfigDir)).toBe(false);
  });
});

describe("seedProviderAuth: claude-code", () => {
  test("copies $CLAUDE_CONFIG_DIR/.credentials.json into the isolated config dir when it exists", () => {
    process.env.CLAUDE_CONFIG_DIR = sourceDir;
    const credentials = JSON.stringify({ claudeAiOauth: { accessToken: "fake-token" } });
    writeFileSync(join(sourceDir, ".credentials.json"), credentials);

    const result = seedProviderAuth("claude-code", isolatedConfigDir);

    expect(result.seeded).toBe(true);
    expect(result.source).toBe(join(sourceDir, ".credentials.json"));
    const dest = join(isolatedConfigDir, ".credentials.json");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe(credentials);
    expect(statSync(dest).mode & 0o777).toBe(0o600);
  });

  test("never copies anything else from $CLAUDE_CONFIG_DIR (e.g. skills, settings)", () => {
    process.env.CLAUDE_CONFIG_DIR = sourceDir;
    writeFileSync(join(sourceDir, ".credentials.json"), "{}");
    mkdirSync(join(sourceDir, "skills", "some-skill"), { recursive: true });
    writeFileSync(join(sourceDir, "skills", "some-skill", "SKILL.md"), "# not auth material\n");
    writeFileSync(join(sourceDir, "settings.json"), "{}");

    seedProviderAuth("claude-code", isolatedConfigDir);

    expect(existsSync(join(isolatedConfigDir, "skills"))).toBe(false);
    expect(existsSync(join(isolatedConfigDir, "settings.json"))).toBe(false);
  });

  test("an unknown provider id falls back to the claude-code shape (ProviderProfile.ts's own DEFAULT_PROFILE fallback)", () => {
    process.env.CLAUDE_CONFIG_DIR = sourceDir;
    writeFileSync(join(sourceDir, ".credentials.json"), "{}");

    const result = seedProviderAuth("some-future-provider", isolatedConfigDir);

    expect(result.seeded).toBe(true);
    expect(existsSync(join(isolatedConfigDir, ".credentials.json"))).toBe(true);
  });
});
