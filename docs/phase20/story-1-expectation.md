# Story 1 — Expectation Log (written BEFORE touching the product)

Persona: experienced engineer with a personal repo of hand-written agent skills
(`skills/<name>/SKILL.md`), wanting real discipline — versioning, evals,
measurements — instead of vibes. Everything below is based ONLY on reading
https://skillmaker.studio and https://docs.skillmaker.studio. No source code,
no product yet.

## What I think the product is

A local-first CLI (+ a viewer served by `skillmaker start`) that treats a
skill as a **Skill Bundle** — research, design doc, eval fixtures, run
records — with `SKILL.md` as a generated *output*. State machine
(idea → researching → drafting → evaluating → published), append-only journal
(`.skillmaker/events.jsonl`), regenerable SQLite index, no server dependency.
Pre-alpha v0.1.0. That framing genuinely appeals to me: "measurements bind to
content hashes, new version starts at n = 0" is exactly the discipline I lack.

## Step-by-step expectations

### 1. Install

`curl -fsSL https://skillmaker.studio/install.sh | sh` on macOS arm64 should
drop a single `skillmaker` binary somewhere on my PATH (I expect
`~/.local/bin` or similar) and tell me what it did. I expect
`skillmaker --help` to work immediately, and `skillmaker --version` to say
0.1.0. Mild worry: curl-pipe-sh installers often silently assume PATH setup.

### 2. My skills repo

I'll make `~/Documents/code/sm-story1-myskills` with three skills the way I'd
actually have them: `skills/commit-message/SKILL.md`,
`skills/code-review-checklist/SKILL.md`, `skills/meeting-notes/SKILL.md`.
One will have sloppy frontmatter (missing `description`, stray field) because
that's realistic. Git repo, a couple of commits.

### 3. Adopt

Per the docs: `skillmaker init` in the repo (creates only
`skillmaker.config.json` + `.skillmaker/events.jsonl`), then
`skillmaker adopt`. I expect:

- a `bundle.json` written **next to each** SKILL.md, nothing moved;
- a `bundle.created` journal event per skill and an initial version hash;
- the sloppy-frontmatter skill to still adopt (docs brag 59/60 on gstack,
  "nonstandard frontmatter preserved") — I expect a warning, not a failure;
- `skillmaker adopt` again to be a no-op (idempotent);
- `skillmaker list` to show 3 bundles, probably in some adopted/drafting-ish
  stage — the docs don't say WHICH stage an adopted bundle lands in, which I
  flag now as a likely confusion point;
- `skillmaker status commit-message` to show identity, state, event history.

The task mentions "report + board + catalog" after adoption — the docs I read
didn't describe an adoption *report* or a *board* explicitly, so I expect
either the CLI prints a summary report and the viewer has a board/catalog
view, or I'm about to be surprised.

### 4. Evals on one skill (commit-message)

- `skillmaker fixture add commit-message golden-basic --class golden --risks IN-1`
  scaffolds `evals/fixtures/golden-basic/` with `case.json`, `prompt.md`,
  `files/`, `expected/answer-key.md`. I fill in prompt + workspace files +
  answer key by hand.
- `skillmaker run commit-message --fixture golden-basic` drives claude-code
  over ACP in a temp workspace, records `runs/<run-id>/` with `run.json`,
  `transcript.jsonl`, `artifacts/`. Default provider claude-code, 300s
  timeout. Exit code 0/1 = task outcome, 3 = infra. I half-expect auth or
  ACP plumbing pain here — this is the step most likely to break for a fresh
  user (where does it find the claude-code binary? my subscription auth?).
- Grading: `skillmaker start` serves viewer + API; the grading *panel* is the
  viewer, but `skillmaker grade <slug> <runId> --verdict pass --notes ...`
  exists, and "two doors, one journal". I cannot drive a browser, so I'll
  grade via CLI and poke the viewer's API with curl. The docs did NOT
  document API endpoints — if I need the viewer for anything CLI can't do
  (checks checkboxes? the grading panel's per-check boxes weren't in the
  grade CLI flags), that's a finding I'm pre-registering.
- `skillmaker measurements commit-message` shows cells keyed on
  (bundle, fixture, versionHash, provider, model): n, pass rate, 95% CI,
  guidance ("below smoke" under 5 runs).
- Iterate: edit the skill text once based on the transcript,
  `skillmaker version record commit-message` to hash the new version, re-run,
  and expect the new version's cell to start at n = 0 while the old cell
  stays intact. That reset-to-zero behavior is the thing I most want to see
  actually work.

## Pre-registered worries

1. Adopted repo layout: my SKILL.md files are at `skills/<name>/SKILL.md`
   but fixtures scaffold at `evals/fixtures/<case>/` — per-bundle or global?
   Docs example paths were ambiguous about where evals live for an adopted
   in-place bundle.
2. State machine gates: will `run`/`fixture add` refuse because an adopted
   bundle isn't in `evaluating` stage? Docs say `advance` is "guarded" and
   review-gated — friction ahead if adoption lands me in a stage that can't
   eval.
3. claude-code provider setup: zero doc detail I found on configuring the
   provider binary/auth in `skillmaker.config.json`.
4. Viewer-only affordances: fixture "checks" grading looked viewer-shaped.
5. `version record` — does it prompt? Does it detect drift automatically or
   do I have to remember to run it after every edit?

## What success looks like

Three adopted bundles; one skill with a real fixture + answer key; ≥2 graded
runs on v1; one text improvement; a new version hash; ≥2 graded runs on v2;
`measurements` showing two separate cells I can compare honestly.
