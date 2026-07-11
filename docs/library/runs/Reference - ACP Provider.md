---
type: Reference
prefLabel: ACP Provider
context: runs
status: migrated
links:
  related_to:
    - "./Entity - Run"
---

## WHAT
The configured agent backend a run's ACP session runs over — configured in
`skillmaker.config.json`'s `providers` map, currently `claude-code` and
`codex`. Same "configured agent backend, never hardcoded in the deployable,
injected at materialization" idea as the old ACP Provider card, now for
these two specific providers instead of a single standing `claude-acp`.

## HOW
`skillmaker.config.json`:

```jsonc
{
  "providers": {
    "claude-code": { "command": ["npx", "-y", "@zed-industries/claude-code-acp@latest"] },
    "codex":       { "command": ["codex-acp"] }
  }
}
```

A run/station invocation names a provider id (`--provider claude-code`,
default `"claude-code"` for stations); `RunEngine.ts`/`StationEngine.ts`
look up `config.providers[id].command` to spawn the ACP subprocess.
`packages/core/src/ProviderProfile.ts` layers small per-provider behavior
deltas on top of the raw command — found live during Phase 12's codex
parity spike:

1. **Skill install directory** — claude-code-acp reads
   `.claude/skills/<slug>/SKILL.md`; codex-acp reads
   `.agents/skills/<slug>/SKILL.md`.
2. **Model extraction** — most adapters report the model at
   `result.models.currentModelId`; one deprecated codex adapter package
   reports it only via `result.configOptions` — `extractModelTolerant()`
   tries both.
3. **Infra-stderr signatures** — codex-acp can emit a real, provider-specific
   infra fault ("requires a newer version of Codex") that must be
   classified `infra-error`, distinct from codex's harmless per-session
   skill-parse `ERROR` logging.

Per-machine overrides (auth-adjacent bits, local provider paths) live in
`.skillmaker/local.json`, deep-merged over the tracked config — never
committed, so credentials never land in the workspace's git history.

Verified: `skillmaker.config.json` (repo root) has exactly the `providers`
shape above with `claude-code` and `codex` entries.
`packages/core/src/ProviderProfile.ts` — `CLAUDE_CODE_PROFILE` /
`CODEX_PROFILE` confirm the `skillInstallDir` split
(`.claude/skills` vs `.agents/skills`) and `resolveProviderProfile()`
resolves an unrecognized provider id to the claude-code-shaped default
rather than failing.
