# Story 6 — Friction Log (failure-iteration persona)

Setup: skillmaker v0.2.0+95560ec (released binary), macOS arm64, fresh
scratch HOME, workspace `~/Documents/code/sm-story6-iterate`, skill
`sql-migration-review`, provider `claude-code` (default), Sonnet 4.5.
Deliberately weak v1 SKILL.md; strict golden fixture (exact verdict line +
3 named dangers + per-danger severity) + refusal fixture (non-SQL input).

Outcome in one line: **v1 golden 0/3 → v2 golden 3/3, refusal 1/1 — one
iteration to green.** Getting the FIRST run to execute at all took ~50
minutes; diagnosing each failed run after that took under 2 minutes.

## Timeline / friction events

1. **Install: delightful.** One curl, ~2s, clear PATH instructions,
   `skillmaker --help` is a genuinely good one-screen overview. `init`,
   `new`, `fixture add` all instant with sensible scaffolds. The fixture
   scaffold's comment "Grading-only: never enters the agent's workspace"
   answered my first question before I asked it.

2. **[P1] First run: infra-error with ZERO diagnostics (>30min confusion).**
   `skillmaker run` → `infra-error`, exit 3, `stderr.txt` **empty**,
   `transcript.jsonl` empty or a single unanswered `initialize` line. No
   hint anywhere. Actual cause #1: my asdf node shim exits 126 under a
   fresh HOME, so `npx` never spawned the ACP adapter — skillmaker
   swallowed the spawn failure completely. A user cannot tell "your node
   is broken" from "auth is broken" from "the product is broken." The
   docs' own asdf note (ASDF_BUN_VERSION) shows the team knows this class
   of failure exists; the run path doesn't surface it.

3. **[P1] Sandbox auth is undocumented and effectively unsupported
   (keychain-mac, ~20min).** Once node worked, every run died with
   `Authentication required` — visible only by reading `stderr.txt` or
   parsing `transcript.jsonl` (`{"code":-32000,"message":"Authentication
   required"}`); the CLI summary still just says `infra-error`. Docs say
   providers "ride your already-logged-in CLI session" — not true under
   `sandbox-home` isolation on macOS, where credentials live in the
   keychain and the sandbox gets a fresh per-run `CLAUDE_CONFIG_DIR`
   (`$TMPDIR/skillmaker-run-*/.skillmaker-sandbox-config`).
   `CLAUDE_CODE_OAUTH_TOKEN` in the parent env did NOT reach the adapter.
   The only thing that worked was a hand-rolled watcher script racing to
   copy `.credentials.json` into each run's sandbox config dir as it
   appears. No fresh user would ever find this. (Known issue; this is the
   exact UX.) Also: because the sandbox is per-run, auth must be re-seeded
   every run — my watcher timing out mid-batch silently produced two more
   opaque infra-errors.

4. **[P0] Credential leak into git-tracked run artifacts — confirmed
   live.** The artifacts diff captured the entire
   `.skillmaker-sandbox-config/` — including the seeded
   `.credentials.json` with live OAuth tokens — into
   `runs/<id>/artifacts/`, which is git-tracked (`trackRuns: true`,
   runs/ NOT in the generated .gitignore). I committed it before my
   post-commit scan caught it; scrubbed and amended. Even without
   credentials, every completed run's artifacts are polluted with
   `.claude.json` + 5 timestamped backups + debug logs + the full project
   transcript JSONL — noise that buries the one artifact you care about
   (`review.md`) and a standing leak vector.

5. **Time-to-why on real (task) failures: GOOD — 30–90s per run.** This
   is the story's core question and the product basically wins it, with
   caveats:
   - The run summary prints the run dir and the artifact list; my fixture
     asked the agent to write `review.md`, so diagnosis = `cat
     runs/<id>/artifacts/review.md` next to my `expected/answer-key.md`.
     Run 1: ~90s to "verdict line missing, verdict buried in prose."
     Runs 2–3: ~30s each with grep.
   - BUT there is no `response.md`/final-message artifact: if I hadn't
     designed the fixture to demand an output file, the agent's answer
     would only exist inside `transcript.jsonl` (raw ACP JSONL, painful).
     The product got lucky with my fixture design; docs never told me to
     do this.
   - No side-by-side with the answer key at the CLI; you assemble the
     comparison yourself. The viewer run detail (verified via API) does
     carry `checks` (from case.json), transcript, artifacts, and grading
     history — that's the right shape.

6. **Grading at volume (8 grades): repetitive but scriptable.**
   `skillmaker grade <slug> <run-id> --verdict ... --notes ...` per run;
   full UUIDs must be copy-pasted from run output (there is no `runs
   list` command; run ids otherwise live only in dir names). CLI cannot
   record per-check results — `grading.checks` are viewer-only, so my
   notes duplicate the checklist in prose. For 9+ grades a `--fixture
   ... --latest` selector or interactive queue would remove most of the
   pain. Grading history as append-only events (regrade = new event,
   latest bolded in viewer) is the right model.

7. **Version story: the numbers narrate, nothing else does.**
   `measurements` shows v1 and v2 cells side by side — `0% [0%,56%]` vs
   `100%` — which IS the improvement story, and the skillbook page adds a
   changelog ("v1 recorded…, v2 recorded…") plus a Receipts table.
   Friction: the CLI measurements table shows only hash prefixes, not my
   `--label v1/v2` (the skillbook does show labels); nothing anywhere says
   *why* v2 exists (no place to attach "v1 failed on verdict format" to
   the version record — no --notes on `version record`). `status` still
   says `stage: idea` and `coverage: 0 covered, 0 partial, 0 gap` despite
   2 fixtures and 8 graded runs, because coverage keys off the risk-map
   I never edited — defensible, but reads as the product ignoring my work.

8. **[P2] CI math is wrong for all-pass cells.** 3/3 renders `[0%, 100%]`
   and 1/1 renders `[0%, 100%]`; Wilson 95% is [44%, 100%] and [21%,
   100%]. The 0/3 cell is correct ([0%, 56%] = Wilson). `--json` also
   returns `"guidance": null` while the text UI prints `(below smoke)`,
   and the JSON lower bound for 0/3 is `4.87e-17` (float noise). For a
   product whose pitch is "honest statistical grounding," the flagship
   number being wrong on the happy path stings.

9. **"Below smoke" guidance: correct and well-behaved.** Displayed on
   every n=3 cell, never blocked anything, and did nudge me — I knew 3/3
   was a smoke signal, not a validated rate. Good calibration of tone.

10. **Small delights:** infra-error runs are correctly excluded from
    measurement n (the 4 auth/node failures never touched pass rates —
    the promised split held); `version record` is idempotent on content;
    `fixture add` warnings-not-errors philosophy; `start` on a busy port
    fails with a clear message (a stale instance from another workspace
    was squatting 4322/4399 — multi-workspace port collision is worth a
    doc note).

## What each failure taught (iteration ledger)

- v1 run 1 (fail): review content excellent, but verdict was a prose
  paragraph at the bottom → the skill never specified an output contract.
  Taught by: `artifacts/review.md` (90s).
- v1 runs 2–3 (fail): same failure, plus run 1 mentioned DROP COLUMN data
  loss only in passing → destructive-op framing must be demanded, not
  hoped for. Taught by: grep over artifacts (30s each).
- v2 change: added mandatory first-line verdict format, per-danger
  severity, an always-evaluate danger checklist, explicit refusal rule.
  Result: 3/3 golden, 1/1 refusal.

## Measurement progression

| Version | Fixture | n | Passes | Rate | CI (shown) | CI (correct Wilson) | Guidance |
|---|---|---|---|---|---|---|---|
| v1 `a5e56d7b` | golden-orders-migration | 3 | 0 | 0% | [0%, 56%] | [0%, 56%] | below smoke |
| v2 `07b1ec4b` | golden-orders-migration | 3 | 3 | 100% | [0%, 100%] | [44%, 100%] | below smoke |
| v2 `07b1ec4b` | refusal-not-sql | 1 | 1 | 100% | [0%, 100%] | [21%, 100%] | below smoke |

(Plus 4 infra-error runs — 2 node-shim, 2 auth/watcher — correctly
excluded from all cells.)

## Verdict on the failure-iteration loop

The inner loop (fail → read artifact → understand → revise → re-version →
re-measure) is genuinely good: under 2 minutes per failure to a concrete
lesson, and the v1→v2 measurement contrast is exactly the "product narrates
my improvement" moment. But the loop is wrapped in an outer loop —
sandbox auth, spawn-failure blindness, artifact credential capture — that
a fresh macOS user cannot survive without reverse-engineering the product.
Fix the outer loop and this is the product where failures make you better;
today, the first failure the product teaches you about is the product's.
