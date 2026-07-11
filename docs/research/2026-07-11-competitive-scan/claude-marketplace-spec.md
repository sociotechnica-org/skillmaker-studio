Primary-source findings (all fetched directly from official Claude Code docs, current as of 2026-07-11).

## marketplace.json — https://code.claude.com/docs/en/plugin-marketplaces
File: `.claude-plugin/marketplace.json`

**Required top-level:** `name` (string, kebab-case), `owner` (object: `name` required, `email` optional), `plugins` (array).
**Optional top-level:** `$schema`, `description`, `version`, `metadata.pluginRoot`, `allowCrossMarketplaceDependenciesOn` (array), `renames` (object, v2.1.193+). `description`/`version` also accepted under `metadata` for back-compat.
Reserved marketplace names (blocked): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`, `claude-community`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`, `first-party-plugins`, `healthcare`.

**Plugin entry fields:** required `name`, `source` (string|object). Optional: `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `strict` (bool, default true), `relevance` (object), `defaultEnabled` (bool). Component-config overrides: `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers` (each string|array, or object for hooks/mcp/lsp).

**Source types (`source` field):** relative path string (`"./plugins/foo"`); `github` (`repo` required, `ref?`, `sha?`); `url` (`url` required, `ref?`, `sha?`); `git-subdir` (`url`, `path` required, `ref?`, `sha?`) — sparse clone for monorepos; `npm` (`package` required, `version?`, `registry?`).

CLI: `claude plugin marketplace add <source> [--scope user|project|local] [--sparse <paths...>]`; slash form `/plugin marketplace add owner/repo` (or `@ref`/`#ref` to pin), `/plugin marketplace list [--json]`, `/plugin marketplace remove <name>`, `/plugin marketplace update [name]`. Install: `/plugin install <plugin-name>@<marketplace-name>`.

## plugin.json — https://code.claude.com/docs/en/plugins-reference
File: `.claude-plugin/plugin.json`. Manifest is optional entirely; only required field if present is `name`.
Metadata: `$schema`, `displayName`, `version`, `description`, `author` (object), `homepage`, `repository`, `license`, `keywords`, `defaultEnabled` (bool).
Component paths: `skills` (string|array — ADDS to default `skills/` scan, doesn't replace), `commands`, `agents`, `outputStyles`, `experimental.themes`, `experimental.monitors` (all REPLACE their default dir when set), `hooks`, `mcpServers`, `lspServers` (string|array|object), `userConfig` (object, prompts user at enable), `channels` (array), `dependencies` (array).
Unrecognized fields are ignored (not errors) — lets plugin.json double as npm package.json/VS Code manifest etc.

## Skills bundling into plugins — confirmed
- Convention: `<plugin>/skills/<skill-name>/SKILL.md` — default scan dir, no manifest field needed.
- **Skills-only plugin is fully supported**, two forms: (1) plugin with just a `skills/` dir and no commands/agents/hooks; (2) a plugin whose root itself IS a single skill — a `SKILL.md` at plugin root with no `skills/` subdir and no `skills` field auto-loads as a single-skill plugin (Claude Code v2.1.142+). Invocation name = SKILL.md's frontmatter `name`, else directory basename.
- Also: "skills-directory plugins" — any folder under `~/.claude/skills/` or `.claude/skills/` containing its own `.claude-plugin/plugin.json` loads in-place as `<name>@skills-dir`, no marketplace/install step needed.

## SKILL.md frontmatter — https://code.claude.com/docs/en/skills
All fields optional (only `description` recommended). Full field list: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation` (bool), `user-invocable` (bool, default true), `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context` (`fork`), `agent`, `hooks`, `paths` (glob), `shell` (`bash`|`powershell`). NOTE: no `license` or generic `metadata` field in Claude Code's own frontmatter table — Claude Code says it "follows the Agent Skills open standard" (agentskills.io) and layers its own extensions (invocation control, subagent fork, dynamic context injection) on top; I could NOT independently confirm the base agentskills.io spec's exact field list (didn't fetch agentskills.io/specification) — **flag this as unconfirmed/secondary** for any fields claimed there beyond what's above.

## Official marketplace/registry
No hosted Anthropic skill registry beyond GitHub. Two relevant repos:
- github.com/anthropics/skills — explicitly a **demonstration/reference repo**, not a marketplace ("provided for demonstration and educational purposes only").
- github.com/anthropics/claude-plugins-official — this IS a real, installable marketplace (`/plugin install skill-creator@claude-plugins-official` works per docs), described as "Official, Anthropic-managed directory of high quality Claude Code Plugins."

## Not independently verified (flag)
- agentskills.io base spec fields (didn't fetch agentskills.io/specification directly — pull if precision matters there).
- platform.claude.com/docs/en/agents-and-tools/agent-skills/overview (Claude Platform/API skills docs, separate from Claude Code) — not fetched, only surfaced in search.

All facts above are from directly-fetched pages: code.claude.com/docs/en/plugin-marketplaces, code.claude.com/docs/en/plugins-reference, code.claude.com/docs/en/skills, github.com/anthropics/skills.