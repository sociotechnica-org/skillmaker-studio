# Phase 20 / Story 5 — Friction log (maintain / re-earn loop)

Persona: maintainer of one production skill (`incident-summary`), forced
environment change claude-code -> codex, honest re-validation. Fresh scratch
HOME install of v0.2.0; workspace `~/Documents/code/sm-story5-maintain`.
Expectations doc: `story-5-expectation.md` (written before install).

## Outcome in one line

The core thesis held: per version x fixture x provider/model measurement
cells, old numbers untouched, regression question answerable in one CLI
table and mirrored in the Skillbook "Receipts" — but I had to hand-build
auth wrappers for BOTH providers, and run-artifact capture copied live
OAuth credentials into git-trackable run dirs (worst finding of the story).

## Measurement record (final)

| Fixture | Version | Provider/model | n | Pass% |
|---|---|---|---|---|
| golden | v1 sha256:338edb3c | claude-code/default | 3 | 100% |
| hard-case-noisy-timeline | v1 sha256:338edb3c | claude-code/default | 3 | 67% (2 pass, 1 partial) |
| golden | v1 sha256:338edb3c | codex/gpt-5.6-sol[medium] | 3 | 100% |
| hard-case-noisy-timeline | v1 sha256:338edb3c | codex/gpt-5.6-sol[medium] | 3 | 100% |
| hard-case-noisy-timeline | v2 sha256:73eac9d3 | codex/gpt-5.6-sol[medium] | 3 | 100% |

Re-earn verdict: codex did NOT regress the skill (it did better on the
hard case). v2 iteration (add "diagnostic observations that supply
root-cause evidence" to the Timeline rule) fixed the one weakness both
providers showed (dropping the 09:40 evidence event).

## P1 — credentials leak into run artifacts (security)

- The auth workaround (below) seeds credentials into the sandbox config
  dir. Artifact capture then copies the ENTIRE sandbox config dir into
  `runs/<id>/artifacts/`, including `.credentials.json` (my Claude OAuth
  access+refresh tokens) and, for codex, `auth.json` (live OpenAI tokens)
  — codex-acp writes auth.json into CODEX_HOME on its own, so this leak
  does not even require my wrapper.
- `trackRuns: true` is the default, so `git add -A && commit` would have
  published my tokens. My pre-commit grep caught `auth.json` seconds
  before it landed in history. A fresh user doing the documented "commit
  your runs" flow WILL commit live credentials.
- Fix expectation: artifact capture should denylist credential filenames
  (`.credentials.json`, `auth.json`, `*.token`) or the default .gitignore
  should. I added local ignores for both.

## P1 — both providers fail auth out of the box on a keychain machine

- First `run` on claude-code: exit 3, `Authentication required`
  (`code -32000`) from the ACP server. Docs promise "Both providers ride
  your already-logged-in CLI session ... no separate API key needed" —
  false on macOS where claude credentials live in the Keychain and the
  run uses `isolation: sandbox-home` with a fresh config dir.
- Same failure on codex (`~/.codex/auth.json` not visible in sandbox).
- No troubleshooting doc exists for this; the CLI error names no fix. I
  wrote wrapper scripts for both providers that seed
  `$CLAUDE_CONFIG_DIR/.credentials.json` (from `security
  find-generic-password -s "Claude Code-credentials" -w`) and
  `$CODEX_HOME/auth.json`, and pointed `skillmaker.config.json` at them.
  ~20 minutes of spelunking a fresh user should not need.
- Credit: infra-errors were correctly kept OUT of measurements — the two
  auth failures never touched my pass rates. Exit-code split works.

## P2 — CI column shows [0%, 100%] for 3/3 cells

- Every n=3, 3/3 cell prints `CI [0%, 100%]`; the 2/3 cell prints
  `[21%, 94%]` (correct Wilson). A 3/3 Wilson 95% interval is ~[44%,
  100%]. The Skillbook shows the same `[0.0%, 100.0%]`. Looks like a
  degenerate-interval bug at p=1.0. For a product whose whole pitch is
  honest numbers, a wrong interval on the most common early cell (all
  passes) undermines trust in the math elsewhere.

## P2 — "not yet measured" is shown as absence, not as a cell

- The promise is "new cell starts honestly empty ('not yet measured')".
  Reality: before grading, the codex cell simply does not appear in
  `measurements` at all — and v2 rows for claude-code / golden-on-codex
  are just missing rows. Absence is honest but not self-explanatory: the
  table never says "v2 x claude-code: not yet measured", so you must
  remember what SHOULD be there to notice what's missing. A full matrix
  with explicit empty cells would make regression review safer.

## P2 — codex artifact capture is noisy (60+ junk files per run)

- Every codex run's artifact list includes the provider's entire seeded
  system-skills tree (imagegen, openai-docs, plugin-creator...), sqlite
  state, lock files — ~60 files drowning the one artifact I care about
  (`incident-summary.md`). claude-code runs similarly capture
  `.claude.json.backup.*` litter. The console summary prints all of it,
  so the signal (my skill's output) is buried.

## P3 — misc

- Site/version mismatch: marketing page says "pre-alpha v0.1.0"; installer
  actually delivers 0.2.0+95560ec. Also `skillmaker --version` doesn't
  exist (unknown command); version only visible in install output.
- `version record --label` on unchanged content: instead of attaching the
  label to the existing version, it refuses with a raw idempotency-key
  dump (`idempotency key "skill.version_recorded:..." was already appended
  with a different type/actor/payload`) — correct behavior, hostile
  message.
- risk-map validator: a row with `golden, hard-case-noisy-timeline` in the
  Fixture column warns `references fixture "golden, hard-case-noisy-timeline"
  which does not exist` — comma-separated fixture lists (the natural way
  to say one risk is covered by two fixtures) aren't parsed.
- Docs CLI page (`/cli/run/`) documents `--provider` but a fresh reader
  cannot find WHICH providers exist without opening
  `skillmaker.config.json`; nothing on the run page links auth setup.
- Viewer API guessing: `/api/bundles/<slug>/measurements` 404s
  ("unknown endpoint") while `/api/bundles/<slug>` works; endpoint names
  are not documented anywhere I found.
- Skillbook renders design.md raw (frontmatter `---` and `**bold**`
  markers visible as text) — the Receipts table is great, the prose above
  it looks broken.
- Stage never blocked me: I measured, versioned, and built a Skillbook
  while the bundle sat in `idea/working`. Convenient for a maintainer,
  but it means "published" gating is entirely advisory for this loop.

## Delights

- `run` auto-records a version before the first run — my "forgot to
  version" mistake was impossible to make.
- Measurement keying worked exactly as promised: provider cells never
  pooled; model id (`gpt-5.6-sol[medium]`) captured automatically and
  keyed into the cell; v1 numbers stayed pinned through the v2 bump.
- The regression question ("did codex regress my skill?") was answerable
  from ONE `skillmaker measurements` table — no hand-assembly. Skillbook
  "Receipts" mirrors it for sharing.
- `(below smoke)` guidance is honest about n=3 being thin evidence.
- Fixture scaffolding (`fixture add --class --risks`) put every file
  where the docs said it would be; answer keys never leaked into the
  agent workspace (verified: transcripts show only prompt + files/).
- No zombie "running" runs encountered this story (9 completed runs, 2
  infra-errors, all terminal states correct).
