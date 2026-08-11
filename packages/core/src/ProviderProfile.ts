/**
 * THE MERGE tranche 2: provider profiles moved to `@skillmaker/runner`
 * (per-provider ACP adapter behavior is execution-adapter knowledge).
 * Re-exported here so core's internal relative imports and
 * `@skillmaker/core`'s public API are unchanged.
 */
export {
  advertisedModelIds,
  CLAUDE_CODE_CONFIG_DIR_ENV_VAR,
  CLAUDE_CODE_PROFILE,
  CLAUDE_CODE_PROVIDER_ID,
  CODEX_CONFIG_DIR_ENV_VAR,
  CODEX_MODEL_COMPAT_STDERR_SIGNATURE,
  CODEX_PROFILE,
  CODEX_PROVIDER_ID,
  type ProviderProfile,
  resolveModelLabel,
  resolveProviderProfile,
  type SessionModelSource,
} from "@skillmaker/runner";
