# Story 1 (rerun) — Expectation, written before touching the product

Persona: I maintain a personal repo of hand-written agent skills (commit
messages, code review, meeting notes). They work "on vibes" — no versioning,
no tests, no discipline. Skillmaker Studio claims to turn exactly this kind of
pile into "a measured, versioned, human-approved product." v0.2.1 just shipped;
I'm judging it fresh. Everything below comes only from https://skillmaker.studio
and https://docs.skillmaker.studio.

## What the sites promise me

- **Install**: `curl -fsSL https://skillmaker.studio/install.sh | sh` detects
  OS/arch, pulls the latest GitHub release tarball, installs to
  `~/.skillmaker/bin`. macOS arm64 is supported (that's me). Note: the landing
  page still says **v0.1.0 (Pre-alpha)** even though v0.2.1 is out — I expect
  the installer to give me the latest anyway.
- **Adopt**: `skillmaker init` in my existing repo (writes only
  `skillmaker.config.json` + `.skillmaker/events.jsonl`, touches nothing else),
  then `skillmaker adopt` writes a `bundle.json` next to each `SKILL.md`, no
  file moves, preserves my nonstandard frontmatter, journals
  `bundle.created` + `skill.version_recorded`, and is idempotent on re-run.
  Docs brag about 59/60 and 39/39 adoption rates on real repos.
- **Inspect**: `skillmaker list` and `skillmaker status <slug>`; `skillmaker
  start` serves a local viewer (board/catalog) + API from one origin, driven by
  the same append-only journal as the CLI.
- **Evals**: `skillmaker fixture add <slug> <case> --class golden --risks IN-1`
  scaffolds `evals/fixtures/<case>/` with `case.json`, `prompt.md`, `files/`,
  `expected/answer-key.md`. Six fixture classes (golden, refusal, empty, rerun,
  hard-case, trigger); risk map in `evals/risk-map.md` with five families
  (IN/RE/OUT/ADV/CHN). Validation problems surface as warnings, never blocks.
- **Runs**: `skillmaker run <slug> --fixture <case>` launches a real agent via
  ACP (claude-code default, via `npx @zed-industries/claude-code-acp`), copies
  fixture files into a temp workspace, installs the skill, captures
  `transcript.jsonl` + workspace-diff artifacts under `runs/<run-id>/`.
  Exit codes separate task failure (1) from infra faults (3) so auth problems
  never pollute pass rates.
- **Grading**: `skillmaker grade <slug> <runId> --verdict pass|fail|partial
  [--notes]`; regrades append, latest wins. `skillmaker measurements <slug>`
  buckets by (bundle, case, versionHash, provider, model): n, passes, passRate,
  CI (rule of three when 0 fails, Wilson otherwise; docs' own example: 2/3
  passes → [21%, 94%]). n≥5 = "smoke", n≥30 = "estimate".
- **Versioning**: `skillmaker version record <slug> --label vX` hashes
  `design.md` + `output/`; a new version starts a fresh measurement bucket at
  n=0, so before/after comparison across my one improvement iteration should
  be first-class.

## What I plan to do

1. Install for real under a fresh scratch HOME.
2. Build `~/Documents/code/sm-story1rerun-myskills`: three hand-written skills
   in my own plausible layout (`skills/<name>/SKILL.md`), one with imperfect
   frontmatter (meeting-notes: missing `description`, stray custom key) —
   because that's what real personal repos look like.
3. `init` + `adopt`; check the report, `list`, `status`, and the viewer
   board/catalog against the promises above.
4. Pick one skill (commit-message), add a golden fixture with a real answer
   key, run it k=3 on claude-code, grade honestly, read the transcripts, fix
   the skill based on what actually failed, `version record`, re-run k=3,
   and compare measurement cells.
5. Friction-log everything over 30 seconds of confusion, every unclear error,
   and time-to-why on any failure.

## Where I expect friction

- Adopted bundles vs. born-in-studio bundles: adopt writes `bundle.json` but
  evals talk about `design.md` + `output/` — where do fixtures/versions live
  for an *adopted in-place* skill that has neither? The docs never show an
  adopted skill going through the eval loop. That seam is exactly my story.
- Provider auth: first `run` on claude-code will hit auth under a scratch HOME;
  docs say exit 3, I expect to learn *why* quickly or lose time.
- The landing page's v0.1.0 badge vs v0.2.1 reality suggests site upkeep lags
  releases; I'll watch for other doc drift.
- Grading is manual per run-id; k=3 across two versions is 6 grade commands of
  UUID copy-paste unless the CLI or viewer makes this smoother.
