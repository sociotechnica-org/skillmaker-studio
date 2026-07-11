/**
 * Fix (Phase 20 Story 3 friction log F4) -- the sandbox-home isolation
 * (Fix F6, `ProviderProfile.ts`'s `configDirEnvVar`) points the ACP adapter
 * subprocess at a fresh, empty config directory so it can't see the
 * operator's real user-level skills. That same emptiness also hides the
 * operator's real LOGIN state, so on a machine using normal `claude
 * login`/`codex login` every sandboxed run fails with an opaque
 * "Authentication required" (only visible in `stderr.txt`).
 *
 * This module seeds the isolated config dir with ONLY the minimal auth
 * material each provider's CLI actually reads -- never the operator's
 * skills, settings, or anything else under their real config dir -- so a
 * sandboxed session authenticates exactly as the operator's real shell
 * would, without contaminating what the run measures.
 *
 * What each provider reads (confirmed against a real, logged-in
 * `claude`/`codex` install, not guessed):
 *  - **codex**: `$CODEX_HOME/auth.json` (0600, JSON). Copying this one file
 *    is sufficient -- `codex-acp` reads it the same way the `codex` CLI
 *    does when `CODEX_HOME` is relocated.
 *  - **claude-code**: `$CLAUDE_CONFIG_DIR/.credentials.json` when the CLI's
 *    file-based credential store is in use (Linux, or a macOS install that
 *    predates/bypasses Keychain storage). On macOS with normal `claude
 *    login`, the OAuth token instead lives in the login Keychain under the
 *    generic-password service `"Claude Code-credentials"` -- confirmed live
 *    via `security find-generic-password -s "Claude Code-credentials"`, and
 *    its value is exactly the same `{ claudeAiOauth: {...}, mcpOAuth: {...} }`
 *    JSON shape as `.credentials.json` -- so extracting it and writing it to
 *    `$CLAUDE_CONFIG_DIR/.credentials.json` under the SANDBOX's isolated
 *    config dir lets a relocated `CLAUDE_CONFIG_DIR` authenticate without
 *    ever touching the operator's real Keychain entry (read-only lookup).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join as nodeJoin } from "node:path";
import { CLAUDE_CODE_PROVIDER_ID, CODEX_PROVIDER_ID } from "./ProviderProfile.ts";

export interface AuthSeedResult {
  readonly seeded: boolean;
  /** Human-readable provenance, e.g. `"$CODEX_HOME/auth.json"` or `"macOS Keychain (Claude Code-credentials)"`. Empty when `seeded` is false. */
  readonly source: string;
  /**
   * Set only when `seeded` is false: names EXACTLY what was looked for and
   * wasn't found, so a caller can surface a precise "you're not
   * authenticated" message instead of the opaque provider-side
   * "Authentication required" this fix exists to replace.
   */
  readonly missingHint?: string;
}

const MACOS_KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Reads the real macOS Keychain entry `claude login` writes, read-only (never modifies/deletes it). `undefined` on any failure (not logged in, no Keychain access, non-macOS, etc.) -- callers treat that identically to "file not found". */
const readMacKeychainCredentials = (): string | undefined => {
  if (platform() !== "darwin") return undefined;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", MACOS_KEYCHAIN_SERVICE],
      { stdio: ["ignore", "pipe", "ignore"] },
    ).toString("utf8");
    const trimmed = out.trim();
    // Sanity-check it's the JSON shape claude-code-acp expects before
    // seeding it anywhere -- never write an empty/garbled value.
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
};

const seedCodexAuth = (isolatedConfigDir: string): AuthSeedResult => {
  const sourceDir = process.env.CODEX_HOME ?? nodeJoin(homedir(), ".codex");
  const authPath = nodeJoin(sourceDir, "auth.json");
  if (!existsSync(authPath)) {
    return {
      seeded: false,
      source: "",
      missingHint: `no codex auth material found at ${authPath} -- run \`codex login\` first`,
    };
  }
  mkdirSync(isolatedConfigDir, { recursive: true });
  const dest = nodeJoin(isolatedConfigDir, "auth.json");
  copyFileSync(authPath, dest);
  chmodSync(dest, 0o600);
  return { seeded: true, source: authPath };
};

const seedClaudeCodeAuth = (isolatedConfigDir: string): AuthSeedResult => {
  const sourceDir = process.env.CLAUDE_CONFIG_DIR ?? nodeJoin(homedir(), ".claude");
  const credentialsPath = nodeJoin(sourceDir, ".credentials.json");

  if (existsSync(credentialsPath)) {
    mkdirSync(isolatedConfigDir, { recursive: true });
    const dest = nodeJoin(isolatedConfigDir, ".credentials.json");
    copyFileSync(credentialsPath, dest);
    chmodSync(dest, 0o600);
    return { seeded: true, source: credentialsPath };
  }

  const keychainValue = readMacKeychainCredentials();
  if (keychainValue !== undefined) {
    mkdirSync(isolatedConfigDir, { recursive: true });
    const dest = nodeJoin(isolatedConfigDir, ".credentials.json");
    writeFileSync(dest, keychainValue, { mode: 0o600 });
    chmodSync(dest, 0o600);
    return { seeded: true, source: `macOS Keychain (${MACOS_KEYCHAIN_SERVICE})` };
  }

  return {
    seeded: false,
    source: "",
    missingHint:
      `no Claude Code credential material found (checked ${credentialsPath}` +
      (platform() === "darwin" ? ` and the macOS Keychain entry "${MACOS_KEYCHAIN_SERVICE}"` : "") +
      `) -- run \`claude login\` first`,
  };
};

/**
 * Best-effort: copies ONLY the auth file(s) a provider's CLI actually reads
 * into `isolatedConfigDir` (never skills, settings, or any other state).
 * Never throws -- a seeding failure is reported via `AuthSeedResult`, not an
 * exception, so a run whose provider doesn't need this (e.g. a CI fake
 * adapter, or a provider authenticated some other way, like an env-var API
 * key) is never blocked by it.
 */
export const seedProviderAuth = (providerId: string, isolatedConfigDir: string): AuthSeedResult => {
  if (providerId === CODEX_PROVIDER_ID) {
    return seedCodexAuth(isolatedConfigDir);
  }
  if (providerId === CLAUDE_CODE_PROVIDER_ID) {
    return seedClaudeCodeAuth(isolatedConfigDir);
  }
  // Unknown provider ids default to the claude-code shape, matching
  // ProviderProfile.ts's own DEFAULT_PROFILE fallback.
  return seedClaudeCodeAuth(isolatedConfigDir);
};
