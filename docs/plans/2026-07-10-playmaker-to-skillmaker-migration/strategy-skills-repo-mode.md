# Strategy — Skills-Repo Mode, the Marketplace, and Where Skillmaker Runs

> **Status:** discussion draft v2 (2026-07-11), for director ruling.
> Synthesizes the two source notes
> ([marketplace](../../sources/2026-07-11-skills-repo-marketplace-thesis.md),
> [desktop](../../sources/2026-07-11-desktop-app-thesis.md)) and a
> six-angle competitive scan whose findings were **verified by direct
> fetch** of primary docs and live repo trees on 2026-07-11 (research
> archived at /tmp/scan-results/, to be committed under docs/research/).
> Marks: **[V]** = fetched/verified; **[S]** = search-snippet, unverified.

## 1. The landscape (verified)

### The platforms moved faster than assumed

- **Codex is a full peer, not an export target.** Codex ships native
  skills on the **open Agent Skills standard** (agentskills.io — the same
  SKILL.md spec Claude Code uses; skills are cross-compatible in
  principle), discovered from `.agents/skills/` (repo), `~/.agents/skills`
  (user). It also has a real **plugin marketplace**: `.codex-plugin/plugin.json`,
  `.agents/plugins/marketplace.json`, `codex plugin marketplace add`, a
  TUI browser, and an OpenAI-curated directory with a submission portal.
  Custom prompts are deprecated *in favor of skills*. [V: learn.chatgpt.com
  docs] → Skillmaker can publish to **two marketplaces from one bundle**.
- **GitHub shipped `gh skill`** (Apr 2026): publish, validate, version-pin
  (`--pin` to tag/SHA), content-addressed change detection — **explicitly
  no eval/regression feature**. [V: github.blog changelog]
- **Anthropic ships skill-creator 2.0** with a benchmark mode (pass rate,
  time, tokens) and explicit "new model ⇒ retest all your skills"
  guidance — **opt-in, local, never a publish gate**. [V: claude.com blog]
  anthropics/skills itself has **zero CI/eval infra** (`.github/workflows`
  404s) and disclaims "always test thoroughly yourself." [V]
- **marketplace.json spec confirmed in full** [V: code.claude.com docs]:
  required `name`/`owner`/`plugins[]`; source types include relative path,
  github (+ref/sha pin), git-subdir (sparse, for monorepos), url, **npm**;
  skills-only plugins fully supported (even a bare SKILL.md at plugin
  root); reserved-name list exists. Everything `skillmaker publish` needs
  is documented and stable.

### The gap — validated, sharpened, and time-boxed

Every piece exists in isolation; **nobody combines them** [V across the
table]: Promptfoo tests skills but doesn't publish; `gh skill` and
Portkey's Skills Registry publish/version but have **zero evals**;
Braintrust/Langfuse/PromptLayer measure but have no skill semantics;
six third-party SKILL.md linters are all static, none behavioral; the one
real eval harness in the wild (obra/superpowers' "Quorum" drill evals) is
bespoke and not a hard gate. **No product does version-pinned pass-rate
measurement gating a SKILL.md publish, with model-change-triggered
re-validation.** That is Skillmaker's exact shape — and three adjacent
giants (GitHub, Anthropic, Portkey/PANW) are one product decision away
from it. The window is real but not indefinite.

### Demand signals (verified in the four target repos)

- **garrytan/gstack** (~58 skills): eval CI on every PR (`EVALS_TIER:
  gate`) + scheduled evals, per-skill semver in frontmatter, VERSION +
  version-gate, golden-file tests **per target agent** (claude/codex/
  factory — a hand-built multi-target compiler), SKILL.md generated from
  .tmpl sources. [V]
- **mattpocock/skills** (21 active / 39 total): changesets versioning,
  `deprecated/` and `in-progress/` directories — lifecycle-in-pathnames,
  no schema. Distributed via third-party `npx skills add`. [V]
- **EveryInc/compound-engineering-plugin** (35 skills): manifests for
  **seven agent platforms** maintained in parallel, release-please
  semantic versioning, converter test suites per platform. [V]
- **elicit/claude-config** (97 SKILL.md + 15 versioned plugins in one
  marketplace.json, incl. a vendored copy of EveryInc's plugin): dual
  versioning layers, macOS `.command` double-click installers **built for
  non-technical staff** [V] — direct evidence for the desktop thesis from
  the director's own team.
- Community pain converges on our exact vocabulary [V/S]: skill drift
  ("the skill and the Bible drift"), silent breakage ("none of these
  surface as errors"), even an arXiv paper — "Skill Drift Is Contract
  Violation" [S]. claudemarketplaces.com indexes ~21,700 skills [S] —
  the ecosystem is big enough to need maintenance tooling.

## 2. The strategic claim

**Distribution is commodity on two platforms; validation-bound
distribution exists nowhere.** The product is the sentence no one else
can emit: *"this skill, at this content hash, passed 28/30 on
claude-code/opus-4.6 and 27/30 on codex, was design-reviewed, and its
validation honestly reset when the model changed."* The marketplace files
(both of them) are cheap projections of a workspace that already knows
this.

## 3. The three modes

### Mode A — in-project (built; keep). No ruling needed.

### Mode B — skills-only repo + marketplaces (the bet)

All Skillmaker mechanisms compound at repo scale (measurements, drift,
journal, todos, re-earn-on-model-change). The verified repos prove people
already want this badly enough to hand-roll pieces of it (gstack's eval
CI, everyinc's seven manifests, mattpocock's deprecated/ dir).

**The front door is `skillmaker adopt`.** Verified brownfield requirements
(from the four real trees) [V]:

1. Recursive `**/SKILL.md` discovery; the containing directory is the
   bundle boundary (sidecar `scripts/`, `references/`, `ref/`, `docs-md/`
   travel with it). No fixed path convention exists.
2. N manifests, not 0-or-1: parallel per-platform manifest dirs
   (everyinc), one marketplace.json fronting 15 sub-plugins (elicit),
   plugin.json that's really a skill index (mattpocock). Round-trip
   losslessly; synthesize when absent.
3. **Permissive frontmatter** — preserve unknown keys (`triggers`,
   `preamble-tier`, `disable-model-invocation`, per-skill `version`);
   lint-and-warn, never reject (ruling I extended to imports).
4. Lifecycle signals live in pathnames (`deprecated/`, `in-progress/`) —
   map to bundle states on import (archived / idea), don't flatten.
5. Some SKILL.mds are **generated** (gstack's .tmpl codegen) — detect
   generation markers; import as output with a "generated upstream" flag
   rather than claiming it as hand-authored.
6. Existing eval/test infra (gstack, superpowers) should be **detected
   and reported**, not discarded — "you have evals; here's how they map"
   beats "start blank."
7. Private repos are a first-class case (elicit) — local checkout auth
   path, graceful denial.
8. Idempotent re-adopt; upstream edits merge, never fork. **Runs on top
   of the repo, doesn't take it over** — maintain *their* layout and
   *their* manifests.

### Mode C½ — distributed AS a skill (source note 2026-07-11)

The fourth distribution rung, and the lowest-friction: a skillmaker skill
in the Claude marketplace(s) — install via `/plugin install`, and the
studio is a conversation away (the skill-creator precedent, §1). Developed
in the self-hosted workspace, evaluated with its own fixtures, published
through its own gate: the studio ships itself as its own first skill, with
receipts. Candidate flagship artifact for Phase 11. Source note:
docs/sources/2026-07-11-skillmaker-as-a-skill-thesis.md.

### Mode C — desktop (ruled: Phase 15)

Now with direct evidence: Elicit hand-builds macOS `.command` installers
so non-technical staff can use the team's skills [V]. The Tauri shell
serves the app-preferring slice immediately; the full non-technical
product remains a standing thesis (source note) — but the demand signal
just got concrete.

## 4. Plan amendments (proposed)

1. **Phase 16 — `skillmaker adopt`** (after Phase 9, before 11): per §3B.
   QA against the four real repos (clone → adopt → lossless round-trip →
   honest empty states; elicit with permission).
2. **Phase 11 — publish** targets BOTH marketplaces: `.claude-plugin/`
   (marketplace.json + plugin.json) and `.codex-plugin/` +
   `.agents/plugins/marketplace.json`, gated on the publish gate. Track
   `gh skill publish` as a third target [V: exists, eval-less].
3. **Codex positioning corrected:** full peer — eval provider (codex-acp,
   Phase 12) AND marketplace target (Phase 11). The cross-agent story is
   "one bundle, measured per provider, published to both stores."
4. **Eval engine:** ours is built (Phase 8, ACP-native, real run green).
   Promptfoo/skill-creator eval suites become candidate *import formats*
   for `adopt` (§3B.6). No rebuild.
5. **Elicit pilot** as Phase 16's flagship QA (97 skills, 15 plugins,
   zero measurements — with permission).

## 5. Positioning sentence (for marketing when ruled)

*Skillmaker Studio runs on top of the skills repo you already have — and
turns it into a product line: designed, measured, versioned, and published
to every marketplace your agents read, with receipts.*

## 6. Rulings requested

- R1: Adopt-first strategy (Mode B primary; `adopt` flagship) — yes/no/later?
- R2: Phase 16 after Phase 9, before publish (11)? Or fold into 11?
- R3: Elicit pilot — pursue?
- R4: Positioning sentence — adopt/revise/hold?
- R5: Dual-marketplace publish (claude + codex) in Phase 11 scope — or
  claude-first, codex-marketplace fast-follow?

## 7. Watch items

- GitHub `gh skill` adding evals (biggest single threat — distribution +
  CI + repo gravity in one company) [V-based inference].
- Anthropic making skill-creator's benchmark a publish requirement.
- agentskills.io spec evolution (both platforms build on it; our importer
  should track the open spec, not either vendor's extensions).
- Codex marketplace self-serve publishing opening fully [S].
