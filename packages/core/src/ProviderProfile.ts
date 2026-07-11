/**
 * Per-provider behavior that `RunEngine.ts` / `StationEngine.ts` /
 * `AcpClient.ts` need to branch on, resolved from a `providers` key in
 * `skillmaker.config.json` (e.g. `"claude-code"`, `"codex"`).
 *
 * Phase 12 (codex parity, `spike-codex/FINDINGS.md`) found three real
 * per-provider deltas against the Phase 8 `claude-code-acp` baseline:
 *
 * 1. **Skill install directory.** claude-code-acp reads
 *    `.claude/skills/<slug>/SKILL.md`; codex-acp reads
 *    `.agents/skills/<slug>/SKILL.md` (confirmed live: prompted a real
 *    `codex-acp` session to use a skill installed at
 *    `.agents/skills/demo-skill/`, it read the file and followed it).
 * 2. **Model extraction from `session/new`'s result.** claude-code-acp
 *    reports `result.models.currentModelId`. The npm-deprecated
 *    `@zed-industries/codex-acp@0.16.0` reports model info under
 *    `result.configOptions` (an array of `{id, currentValue, ...}`, model
 *    entry has `id: "model"`) instead -- no `models` key at all, so the
 *    claude-code-shaped `extractModel()` silently returns `null`. The
 *    non-deprecated `@agentclientprotocol/codex-acp@1.1.2` (this repo's
 *    default codex provider command, see `Workspace.ts`) was re-spiked for
 *    Phase 12 and turned out to report `result.models.currentModelId` too
 *    (plus `configOptions`, for defense-in-depth) -- but a provider-aware
 *    extractor is kept anyway so a workspace still configured with the
 *    deprecated zed package (or a future adapter that only exposes
 *    `configOptions`) doesn't silently lose its `run.json.model` field.
 * 3. **Infra-stderr signatures.** codex-acp's adapter package can trail the
 *    installed `codex` CLI's own model catalog, producing a JSON-RPC
 *    `-32603` whose `data.message` reads "The '<model>' model requires a
 *    newer version of Codex. Please upgrade..." -- a real, provider-specific
 *    infra fault distinct from anything claude-code-acp exhibits. Codex also
 *    logs pre-existing, unrelated skill-parse `ERROR` lines to stderr on
 *    every session start (it scans all discoverable skill dirs, not just the
 *    sandbox cwd) -- those must NOT be classified as infra, so the signature
 *    list stays a specific substring match, never a broad `"ERROR"` scan.
 *
 * No nested-session guard exists in codex-acp as of this spike (unlike
 * claude-code-acp's), so codex has no analog of `AcpClient.ts`'s
 * `stripClaudeCodeEnv` signature -- stripping is still applied unconditionally
 * (harmless, defense in depth) but isn't part of this per-provider profile.
 */

/** Shape `AcpClient.ts`'s `session/new` result is read through for model extraction -- kept structurally compatible with `NewSessionResult` there rather than importing it, to avoid a circular module dependency. */
export interface SessionModelSource {
  readonly models?: {
    readonly currentModelId?: string;
    readonly availableModels?: ReadonlyArray<{ readonly modelId: string; readonly description?: string }>;
  };
  readonly configOptions?: ReadonlyArray<{
    readonly id?: string;
    readonly currentValue?: unknown;
  }>;
  readonly [key: string]: unknown;
}

export interface ProviderProfile {
  /** The `providers.<id>` key in `skillmaker.config.json` this profile matches (falls back to the default profile for any other id -- data-model.md's `targets` field lists provider ids freely, and an unrecognized one should still run, just without provider-specific niceties). */
  readonly id: string;
  /** Relative to the sandbox root, e.g. `".claude/skills"` / `".agents/skills"`. `RunEngine`/`StationEngine` join `<skillInstallDir>/<slug>` to install the skill's `output/` before the session starts. */
  readonly skillInstallDir: string;
  /** Reads a provider-shaped `session/new` result into a model id, or `null` if the shape doesn't match. */
  readonly extractModel: (session: SessionModelSource) => string | null;
  /** Stderr substrings that indicate an infra fault for THIS provider specifically, on top of `AcpClient.ts`'s provider-agnostic `INFRA_STDERR_SIGNATURES`. */
  readonly infraStderrSignatures: ReadonlyArray<string>;
  /**
   * The env var THIS provider's CLI respects to relocate its whole config
   * directory (default `~/.claude` / `~/.codex`) -- including that
   * provider's OWN user-level skill directory. Fix F6: without this, the
   * ACP adapter subprocess inherits the operator's real `$HOME`, so the
   * underlying CLI reads the operator's personal user-level skills
   * (`~/.claude/skills` for claude-code) in ADDITION to the bundle's skill
   * `RunEngine`/`StationEngine` install at the sandbox-local
   * `skillInstallDir` above -- contaminating eval measurements with
   * whatever the operator happens to have installed locally.
   * `RunEngine`/`StationEngine` set this env var to a fresh, run-scoped,
   * empty directory before every session so the sandbox is the ONLY source
   * of skills the agent can see.
   */
  readonly configDirEnvVar: string;
}

const extractFromModelsField = (session: SessionModelSource): string | null =>
  session.models?.currentModelId ?? null;

/** `configOptions` fallback for adapters (the deprecated `@zed-industries/codex-acp`) that report the selected model only there, as `{id: "model", currentValue: "<modelId>"}`. */
const extractFromConfigOptions = (session: SessionModelSource): string | null => {
  const modelOption = session.configOptions?.find((opt) => opt.id === "model");
  return typeof modelOption?.currentValue === "string" ? modelOption.currentValue : null;
};

/** Tries `models.currentModelId` first (claude-code-acp, and `@agentclientprotocol/codex-acp`), then `configOptions[id="model"].currentValue` (the deprecated `@zed-industries/codex-acp`). The two shapes never collide, so trying both is safe for any provider (spike/FINDINGS.md's recommendation). */
const extractModelTolerant = (session: SessionModelSource): string | null =>
  extractFromModelsField(session) ?? extractFromConfigOptions(session);

/** "The '<model>' model requires a newer version of Codex" -- the model-compat class of infra fault found live against `@zed-industries/codex-acp@0.16.0` when the adapter package trails the installed `codex` CLI's default model (spike-codex/FINDINGS.md). Kept as a substring, not a broad `"ERROR"` match, because codex-acp also logs harmless per-session skill-parse `ERROR` lines unconditionally at startup. */
export const CODEX_MODEL_COMPAT_STDERR_SIGNATURE = "requires a newer version of Codex";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const CODEX_PROVIDER_ID = "codex";

/** Respected by the `claude` CLI (which claude-code-acp wraps) to relocate its whole `~/.claude`-equivalent config directory, including user-level skills. */
export const CLAUDE_CODE_CONFIG_DIR_ENV_VAR = "CLAUDE_CONFIG_DIR";
/** Respected by the `codex` CLI (which codex-acp wraps) to relocate its whole `~/.codex`-equivalent config directory. */
export const CODEX_CONFIG_DIR_ENV_VAR = "CODEX_HOME";

export const CLAUDE_CODE_PROFILE: ProviderProfile = {
  id: CLAUDE_CODE_PROVIDER_ID,
  skillInstallDir: ".claude/skills",
  extractModel: extractModelTolerant,
  infraStderrSignatures: [],
  configDirEnvVar: CLAUDE_CODE_CONFIG_DIR_ENV_VAR,
};

export const CODEX_PROFILE: ProviderProfile = {
  id: CODEX_PROVIDER_ID,
  skillInstallDir: ".agents/skills",
  extractModel: extractModelTolerant,
  infraStderrSignatures: [CODEX_MODEL_COMPAT_STDERR_SIGNATURE],
  configDirEnvVar: CODEX_CONFIG_DIR_ENV_VAR,
};

/** Any provider id not explicitly known (custom `skillmaker.config.json` entries) gets claude-code-acp's shape -- the more common ACP adapter layout, and the tolerant `extractModel` still recognizes codex's shape too. */
const DEFAULT_PROFILE: ProviderProfile = CLAUDE_CODE_PROFILE;

const PROFILES_BY_ID: ReadonlyMap<string, ProviderProfile> = new Map([
  [CLAUDE_CODE_PROFILE.id, CLAUDE_CODE_PROFILE],
  [CODEX_PROFILE.id, CODEX_PROFILE],
]);

/** Resolves a `providers.<id>` key from `skillmaker.config.json` to its `ProviderProfile`. Unknown ids resolve to `DEFAULT_PROFILE` rather than failing -- provider IDs are workspace-configurable free text (data-model.md §2.3's `targets`), not a closed enum. */
export const resolveProviderProfile = (providerId: string): ProviderProfile =>
  PROFILES_BY_ID.get(providerId) ?? DEFAULT_PROFILE;
