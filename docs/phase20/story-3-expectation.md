# Story 3 Expectation — "Make other people's skills mine, with receipts"

Written BEFORE touching the product. Sources: https://skillmaker.studio and
https://docs.skillmaker.studio only (landing page, introduction, concepts nav,
fixtures-and-risk-maps, CLI reference).

## Who I am

I'm a senior engineer with strong opinions about my own process. I don't write
skills from scratch — I admire other people's skills and steal them. My plan:
vendor two specific skills from public repos I respect (one from
mattpocock/skills, one from EveryInc/compound-engineering-plugin), adopt them
into my workspace, rewrite them to match *my* process, and then prove with
real eval runs that my edits didn't break what made them good.

## What the sites tell me to expect

### Install

Landing page says one command:

```
curl -fsSL https://skillmaker.studio/install.sh | sh
```

macOS arm64 supported. The landing page badge still said **pre-alpha v0.1.0**
when I read it; I'm told v0.2.0 shipped, so I expect the installer to deliver
v0.2.0 with a complete command set — the CLI reference documents `adopt`,
`fixture add`, `run`, `grade`, `measurements`, `version record`, `publish`,
`advance`, `review request`, `start`, `book build`, `todo`, `reindex`. If the
installed binary is missing any of those, that's a release-pipeline failure.

### The flow I expect to live

1. `skillmaker init` in my own git repo — creates a workspace
   (`.skillmaker/`, journal, SQLite index rebuildable via `reindex`).
2. Copy vendored skill dirs (each has a `SKILL.md`) into `skills/`, then
   `skillmaker adopt` — docs say adopt "imports pre-existing SKILL.md files as
   in-place Skill Bundles" with "no file reorganization or rewrites". I expect
   both skills to become bundles wrapping my files where they sit, each with a
   design doc scaffold and a journaled adoption event.
3. Edit `SKILL.md` to my taste; `version record <slug>` should hash
   `design.md` + `output/` so my personalized version is pinned. (Open
   question from the docs: is `SKILL.md` part of `output/` for an adopted
   bundle? The hash targets named in the CLI ref are `design.md` + `output/`.)
4. `fixture add <slug> <case>` scaffolds `evals/fixtures/<case>/` with
   `case.json`, `prompt.md`, `files/`, `expected/answer-key.md` (rubric hidden
   from the agent). Classes: golden / refusal / empty / rerun / hard-case /
   trigger; risks mapped to IN/RE/OUT/ADV/CHN families in `evals/risk-map.md`.
5. `run <slug>` executes a fixture through an ACP provider (claude-code and
   codex are peers, never pooled). I'll run k=3 per fixture on claude-code.
6. `grade <slug> <runId>` records a verdict per run; `measurements <slug>`
   shows cells: n, pass rate, CI, guidance. "A single run is a sample, not a
   measurement" — so I expect the tool to actively push me toward k>1.
7. `advance` through the state machine (idea → researching → drafting →
   evaluating → published) with guards and journaled decisions.

### The provenance question (my real test of this product)

These two skills are **not mine**. They came from mattpocock/skills and
EveryInc/compound-engineering-plugin, and I'm deliberately diverging from
upstream. What I *want* from a tool that claims "versioned, with receipts":

- Somewhere to record **where the skill came from** (repo URL, commit) at
  adopt time — ideally `adopt` asks or accepts a `--source` flag.
- The bundle's identity/status to show that origin.
- Some notion of **drift vs upstream** — even just "adopted from X at hash Y;
  local version has diverged" would do. I don't expect auto-sync.

What the sites actually promise: the CLI reference says adoption is tracked
"through the journal mechanism" but does **not** document upstream/source
tracking anywhere. So my honest expectation: provenance will be **on me** —
I'll get an adoption event with a timestamp and nothing about origin. I'd love
to be wrong. If `adopt` doesn't even leave room for a source note, that's a
gap I'll log: a tool whose whole pitch is receipts should have a receipt for
"this skill's ancestry".

### Predicted friction

- Version confusion: landing page says v0.1.0 while v0.2.0 is current.
- Adopt on a *subset* copied out of a larger repo (skill dir without its
  original repo context) — will adopt handle a directory whose SKILL.md has
  frontmatter conventions from another ecosystem (e.g. plugin-style metadata)?
- The gated state machine may feel heavy for "I just want to personalize and
  verify two skills" — I expect to fight `advance` guards or discover I can
  ignore them.
- Grading is manual (`grade <slug> <runId>`); with 2 skills × ≥2 fixtures × 3
  runs that's ≥12 grade invocations. Ergonomics will matter.

## Success criteria for the story

- Both adopted skills personalized with real, opinionated edits.
- Fixture + answer key per skill encoding MY desired behavior; k=3 real runs
  each on claude-code; honest grades; one iteration if a run exposes a flaw.
- A clear verdict on how the product treats the upstream relationship.
