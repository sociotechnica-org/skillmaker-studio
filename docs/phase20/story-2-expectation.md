# Phase 20 — Story 2 Expectation: Porting a Model-Tuned Skill to a New Model

**Persona:** Staff engineer. My team has a `pr-description` skill tuned over months
for one model. A new model just became our default. I need to port the skill and
*prove* the port — "is the ported version at least as good?" — with measurements,
not vibes.

**Written before touching the product.** Sources: https://skillmaker.studio and
https://docs.skillmaker.studio only.

## What the sites tell me

- Install: `curl -fsSL https://skillmaker.studio/install.sh | sh` (macOS arm64
  supported; pre-alpha v0.1.0). From-source path: clone
  `sociotechnica-org/skillmaker-studio`, `bun install`, `bun run build:viewer`,
  run via `bun packages/cli/src/main.ts` (alias to `skillmaker`). Note: the CLI
  reference page says "No published package exists yet — users must install from
  source," which contradicts the marketing page's one-liner. I expect the binary
  to exist but possibly lag the docs.
- Workspace: `git init` + `skillmaker init` → creates `skillmaker.config.json`
  ("tracked app config" — format undocumented) and `.skillmaker/events.jsonl`.
- Bundle: `skillmaker new pr-description` → `skills/pr-description/` with
  `bundle.json`, `design.md`, `stations.json`, `research/`, `evals/`, `output/`.
  The distributable skill lives at `output/SKILL.md`.
- Fixtures: `skillmaker fixture add <slug> <case>` →
  `evals/fixtures/<case>/{case.json, prompt.md, files/, expected/answer-key.md}`.
  Classes include `golden` and `hard-case` — exactly my two cases.
- Runs: `skillmaker run <slug> --fixture <case> [--provider <id>] [--timeout <s>]`.
  Provider defaults to `claude-code`. **No documented repeat/k flag** — I expect
  to invoke `run` three times per fixture by hand for k=3.
- Grading: `skillmaker grade <slug> <runId> --verdict pass|fail|partial [--notes]`.
- Measurements: `skillmaker measurements <slug>` — one row per
  `{fixture, version, provider/model}`; columns N, PASS%, CI, GUIDANCE
  (below-smoke until n=5). Rows are **never pooled** across versions or models —
  good: that's precisely the isolation my port comparison needs.
- Versioning: `skillmaker version record <slug>` hashes `design.md` + `output/`.

## Expectations for this story

1. **Install** — the one-liner works on my M-series Mac, or fails with a clear
   error. If the released binary lacks commands the docs describe, that's a
   finding; fall back to the documented from-source path.
2. **Setup** — `git init` + `skillmaker init` + `skillmaker new pr-description`
   + two `fixture add` calls give me an obvious place to put the skill text,
   the two prompts, and the two answer keys, without reading source.
3. **Baseline** — 6 runs (2 fixtures × k=3) against `claude-code` complete;
   I can grade each and see two measurement rows with n=3. The run record
   should tell me **which model was actually used** — the measurements docs
   show a `provider/model` cell (`claude-code/fake-model-1` in the example),
   so the product clearly *tracks* model identity. If run output/`run.json`
   never surfaces the real model name, that's a finding.
4. **Model selection (the crux)** — the docs document **no flag, config field,
   or env var to pin or switch the model** for a provider. `--provider <id>`
   references ids in `skillmaker.config.json`, whose format is undocumented.
   My hope: the generated config exposes a provider command/args I can
   duplicate (e.g. a second provider entry pointing claude-code at another
   model via a flag or `ANTHROPIC_MODEL`). Budget: 20 minutes on docs + the
   generated config. If there is genuinely no supported way, that is the
   headline P1 — a skill-porting product that can't target a model — and I'll
   simulate the port with a revised skill version on the same provider.
5. **The port** — edit `output/SKILL.md` (trim the old model's scaffolding),
   `version record`, re-run k=3 both fixtures, grade. Expect fresh rows at the
   new version hash.
6. **The comparison** — the product should help me answer "is v2 ≥ v1?"
   side-by-side: ideally `measurements` prints both version rows adjacently,
   or the viewer shows a version × fixture grid. If I end up diffing `--json`
   output by hand, that's a finding. With n=3 (below smoke), I expect the
   product to warn me my evidence is thin rather than pretend 3/3 is proof.

## Success criteria

- A measurement table I could paste into a team decision doc: version ×
  fixture × provider/model × n × pass rate × CI.
- A defensible answer to "at least as good?", plus an honest account of
  whether the product produced that answer or I assembled it manually.
