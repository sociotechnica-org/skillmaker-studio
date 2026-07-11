**1. anthropics/skills repo** (https://github.com/anthropics/skills): Structure = `skills/` (Creative & Design, Development & Technical, Enterprise & Communication, plus document skills: docx/pdf/pptx/xlsx), `spec/` (Agent Skills spec), `template/`, `.claude-plugin/marketplace.json`. It IS a Claude Code plugin marketplace — installable via `/plugin marketplace add anthropics/skills` then `/plugin install document-skills@anthropic-agent-skills`. **No `tests/` or `evals/` directory found, and `.github/workflows` returns 404** (confirmed directly) — there is no visible CI/eval infrastructure in the repo. Gap confirmed.

**2. Official Anthropic blog** — "Equipping agents for the real world with Agent Skills" (https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills): guidance is observation-based, not formal-eval-based. It says to find capability gaps by running representative tasks and watching where Claude struggles, then iterate by asking Claude to capture successful approaches/mistakes into the skill. **No mention of pass-rate measurement, golden test fixtures, or version-pinned evals**, and no discussion of maintaining skills across different Claude model versions. Related but separate post: "Demystifying evals for AI agents" (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) discusses general agent eval strategy (automated evals in CI/CD, prod monitoring, A/B testing) but isn't skill-specific and doesn't mention version-pinning. Neither post describes anything resembling Skillmaker's guarded-publish/version-pinned pass-rate model.

**3. Third-party SKILL.md linters/validators found** (none of these do version-pinned pass-rate evals — they're static linters, not eval harnesses):
- agent-skill-linter (https://github.com/William-Yeh/agent-skill-linter) — ~20 spec-compliance/publishing-readiness rules
- skill-check (https://github.com/thedaviddias/skill-check) — structure/frontmatter/description scoring
- skill-lint (https://github.com/himself65/skill-lint) — catches spec errors pre-upload
- skill-validator (https://github.com/agent-ecosystem/skill-validator) — has a GitHub Actions workflow validating changed skills per PR (closest to "CI-tested," but still static validation, not behavioral pass-rate testing)
- skillscore (dev.to/sayed_ali_alkamel/skillscore...) — Dart CLI, scores SKILL.md 0-100, offline/deterministic
- agent-skills-lint (https://github.com/swarmclawai/agent-skills-lint) — cross-agent (Claude Code, Codex, etc.) validator+installer

None found that measure actual task pass-rate against pinned model versions — this is a real gap Skillmaker could differentiate on.

**4. Plugin marketplace meta-directories exist:**
- claudemarketplaces.com — largest, ~21,700 skills / 2,500 marketplaces / 12,500 MCP servers indexed, updated daily from GitHub
- claudepluginhub.com — re-indexes marketplace repos regularly
- anthropics/claude-plugins-official (https://github.com/anthropics/claude-plugins-official) — Anthropic's own curated official directory
- aitmpl.com/plugins — community collection aggregator
- Chat2AnyLLM/awesome-claude-plugins — GitHub awesome-list style meta-catalog

**Bottom line for the report:** Anthropic ships skills + a marketplace but zero public eval/CI infrastructure for skill quality; their own guidance is manual/observational, not automated pass-rate benchmarking. Third-party tools cover static linting/spec-compliance and one has PR-triggered validation, but none do version-pinned behavioral pass-rate measurement or guarded publish gating. That combination appears to be open white space — worth stating plainly in the report as a validated gap, not just an assumption.