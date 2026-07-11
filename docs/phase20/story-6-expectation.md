# Story 6 — Expectation Document (written BEFORE touching the product)

Persona: failure-iteration user. I'm building a genuinely hard skill
(`sql-migration-review`) whose v1 will fail on purpose. The question this
story answers: when my runs fail, does the product make each failure teach
me something — fast — or do I have to go spelunking?

Sources used for these expectations: https://skillmaker.studio (landing) and
https://docs.skillmaker.studio (CLI reference, install, first-bundle,
fixtures-and-risk-maps, running-fixtures, grading-and-measurements). No
product source read, no binary run yet.

## What the sites tell me the loop looks like

1. `curl -fsSL https://skillmaker.studio/install.sh | sh` → binary in
   `~/.skillmaker/bin`.
2. `git init` + `skillmaker init` in a workspace, `skillmaker new
   sql-migration-review` scaffolds a bundle with `design.md`,
   `stations.json`, fixture slots.
3. `skillmaker fixture add sql-migration-review <case> --class golden
   --risks ...` scaffolds `evals/fixtures/<case>/` with `case.json`,
   `prompt.md`, `files/`, `expected/answer-key.md` (answer key never shown
   to the agent).
4. `skillmaker run sql-migration-review --fixture <case>` (provider
   defaults to `claude-code`, `--timeout 300`) → immutable
   `runs/<run-id>/` with `run.json`, `transcript.jsonl`, `artifacts/`
   (workspace diff).
5. `skillmaker grade <slug> <run-id> --verdict pass|fail|partial
   [--notes]`, with optional `grading.checks` checkboxes in the panel.
6. `skillmaker measurements <slug>` → cells keyed by (bundle, case,
   versionHash, provider, model): n, passRate, 95% CI, guidance bands
   (n≥5 smoke, n≥30 estimate, n≥100 ship-gate; below 5 = "(below smoke)").
7. `skillmaker version record <slug>` hashes `design.md` + `output/`; a new
   hash is a new measurement key starting at n=0.

## Concrete expectations (to check against reality)

E1. **Install** is one command and works on macOS arm64 with a fresh HOME;
    `skillmaker --help` works immediately. Docs say released binary exists;
    I expect v0.2.x. Risk: docs also describe from-source-only commands, so
    some documented commands may be missing from the binary.

E2. **k=3 runs**: the run doc shows no `-k`/`--repeat` flag, so I expect to
    invoke `skillmaker run` three times manually. A `rerun` fixture class
    exists, which hints repetition is a first-class idea — mild hope there's
    sugar for it; expectation: there isn't in v0.2.0.

E3. **Time-to-why on a failed run** (the heart of this story): the docs
    promise `transcript.jsonl` (raw ACP stream) and `artifacts/` (diff).
    Notably **no `response.md` or human-readable answer file is documented**.
    My expectation/fear: to see WHY a run failed I'll be reading raw JSONL
    or the artifacts diff, comparing by hand against `expected/answer-key.md`.
    Target: under 2 minutes per failed run to a diagnosis; I expect the
    viewer's run detail / grading panel (with `grading.checks`) to be the
    fast path and the CLI to be the slow path.

E4. **Grading at volume**: 3 runs × 3+ iterations × grading = 9+ grades. The
    grade command is per-run with a long run-id argument. Expectation:
    repetitive; I'll be copy-pasting run ids from `skillmaker run` output or
    `--json` listings. No documented batch grading.

E5. **Version story**: `version record` + measurements keyed per versionHash
    should give me a v1 vs v2 vs v3 table. Expectation: `measurements`
    shows per-version cells side by side (or at least all cells), and the
    Skillbook (`book build`) narrates history. Uncertain whether anything
    explicitly says "v2 improved on v1 because…" — I expect the *numbers*
    story but not a *narrative* story.

E6. **Below-smoke guidance**: with n=3 per version I should see "(below
    smoke)" everywhere. Good behavior = it nudges me toward more runs
    without blocking iteration. I expect it displayed, not enforced.

E7. **Refusal fixture**: `--class refusal` is first-class ("skill should
    decline"). Expectation: run + grade works identically; nothing special
    needed; grading is still manual judgment against the answer key.

E8. **Auth**: docs say nothing about provider auth for `claude-code`. With
    a fresh scratch HOME I expect the first `skillmaker run` to fail with an
    auth/infra error (exit 3 — docs promise infra errors never pollute pass
    rates; I will verify that promise). Known issue to watch: keychain-mac
    auth may need credential seeding into the sandbox config dir.

E9. **Weak v1 will fail the strict key**: my answer key demands an exact
    verdict format + 3 specific flagged dangers. A vague SKILL.md should
    miss the format and probably at least one danger. If it accidentally
    passes 3/3, the fixture is too easy and I'll tighten the key (that's a
    finding about my fixture, not the product).

## What "the product wins" looks like

Each failed run hands me, within a couple of minutes: what the agent
actually said, next to what the key demanded, with checks I can tick. Each
iteration shows up as a distinct version with its own measured cell, and
somewhere (measurements table, skillbook, status/journal) I can see the
v1→v2→v3 arc without assembling it by hand. If instead I'm grepping
transcript.jsonl and hand-diffing markdown nine times, that's where a user
falls out of love.
