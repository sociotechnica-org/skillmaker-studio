# Phase 20 / Story 5 — Expectation (written before touching the product)

Persona: maintainer of ONE production skill (`incident-summary`). My team is
about to switch environments under it (claude-code -> codex). I need honest
re-validation: old numbers must survive, the new environment must start from
"not yet measured," and "did the change regress my skill?" must be answerable
in one view.

Sources for this expectation: https://skillmaker.studio and
https://docs.skillmaker.studio only (homepage, introduction, CLI reference,
`run` page, fixtures-and-risk-maps page). I have not run the binary or read
any source code yet.

## What the sites promise (as I read them)

1. Install is one line: `curl -fsSL https://skillmaker.studio/install.sh | sh`
   (marketing page still says "pre-alpha v0.1.0"; I was told v0.2.0 is the
   released binary — that version mismatch on the site is already a small
   trust ding).
2. A Skill Bundle = design.md + SKILL.md output + fixtures + runs + status,
   moving through idea -> researching -> drafting -> evaluating -> published
   with guarded `advance`.
3. Fixtures live at `evals/fixtures/<case>/` with `case.json`, `prompt.md`,
   `files/`, `expected/answer-key.md`. Classes include `golden` and
   `hard-case` — exactly the two I need.
4. `skillmaker run <slug> --fixture <case> --provider <id>` drives one eval
   end to end; provider defaults to `claude-code`; docs' CLI pages show NO
   `--model` flag, so my "environment change" will be a provider switch to
   `codex` (homepage says claude-code and codex are "evaluated separately,
   never pooled").
5. If no version exists, `run` records one automatically, "so every run is
   pinned to a real content hash."
6. `grade` records a verdict per run; `measurements` shows cells with "n,
   pass rate, CI, guidance."
7. The core promise I'm here to test: "Measurements are version-pinned to
   content hashes; changes reset metrics to 'not yet measured'" and
   providers are never pooled. So the measurement cell should be keyed
   (at least) version x fixture x provider.

## Concrete expectations I will hold the product to

- E1. Install from the site works on a fresh HOME and `skillmaker --version`
  reports v0.2.0.
- E2. `init` + `new incident-summary` scaffolds a bundle where I can write
  design.md, SKILL.md, and add two fixtures (`golden`,
  `hard-case-noisy-timeline`) each with an answer key, without fighting the
  scaffold.
- E3. After k=3 runs per fixture on claude-code plus honest grades,
  `skillmaker measurements incident-summary` shows, for the current version,
  per-fixture cells with n=3 and a pass rate — my production "proof." The
  viewer (`skillmaker start`, :4322) and/or Skillbook shows the same numbers
  (two doors, one ground).
- E4. Running the SAME version under `--provider codex` creates a NEW cell
  that starts empty/"not yet measured" and never pools with claude-code.
  Old claude-code numbers remain untouched and visible.
- E5. One view (measurements table or viewer) lets me answer "did codex
  regress my skill?" by direct side-by-side comparison — no hand-assembly
  from raw run logs.
- E6. If I then edit SKILL.md for codex and record a new version, the new
  version starts "not yet measured" everywhere, while v1's cells (both
  providers) stay pinned to v1 and remain readable — history, not
  overwrite.
- E7. Failures split honestly: task failure (exit 1, counts against pass
  rate) vs infrastructure failure (exit 3, does NOT pollute measurements).
  Known issues I may hit: keychain/sandbox auth needing a wrapper, and
  long-run crashes leaving "running" zombie runs — I expect at minimum that
  zombies are visible and don't silently count as passes.

## What would falsify the thesis

- Provider switch silently reuses or overwrites the old cell (pooling).
- Version bump wipes or hides v1 measurements instead of pinning them.
- The regression question requires me to join JSON by hand.
- Codex support is claimed but not actually wired in v0.2.0.
