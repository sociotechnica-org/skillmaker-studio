# Story 1 — Friction Log (fresh-eyes user, personal skills repo takeover)

Persona: engineer with a personal repo of 3 hand-written skills
(`~/Documents/code/sm-story1-myskills`), following only skillmaker.studio,
docs.skillmaker.studio, and the product's own output. Run on 2026-07-11,
macOS arm64. Release binary `0.1.0+0df50e0` via the official installer;
fell back to a source checkout (per the docs' install page) when the
release turned out not to have the feature the docs sent me to.

Severity: P1 = blocked me or silently invalidated my work; P2 = real
friction, worked around; P3 = paper cut.

---

## F1 — P1 — The documented `adopt` flow does not exist in the released binary

**What happened:** `curl -fsSL https://skillmaker.studio/install.sh | sh`
installs `0.1.0+0df50e0` (the latest GitHub release). The docs have a whole
"Adopting an existing repo" getting-started page. `skillmaker adopt` →
`unknown command "adopt"`, exit 2. `skillmaker list` then shows
"no skill bundles yet" — my existing SKILL.md files are invisible. The docs
homepage explicitly promises "the site documents only merged, runnable
functionality."

**What I expected:** the flagship onboarding path for people who already
have skills to work with the binary the marketing site tells me to install.

**Workaround:** built from source per `/getting-started/install/` (clone,
`bun install`, `bun run build:viewer`, run `packages/cli/src/main.ts`).

**Proposed improvement:** cut a release whenever a documented feature lands,
or version-gate docs pages ("since v0.2 / main only") with a banner. A
`skillmaker --version` + docs version badge would have saved me 15 minutes
of "am I holding it wrong?"

## F2 — P1 — Eval runs on adopted bundles silently test a naked agent

**What happened:** first `skillmaker run` on my adopted `commit-message`
bundle "completed" happily and produced an artifact — but the transcript
shows the skill was never in the session (0 occurrences of the skill name
or any body text). Per `/cli/run/`, run installs "the bundle's `output/`";
adopted bundles are `layout: in-place` (`.skillmaker-adopt.json` says
`skillPath: SKILL.md`) and have no `output/`. So the run measured a raw
agent, recorded it against an auto-recorded version hash, and nothing —
not the CLI, not the run record — warned me. This poisons exactly the thing
the product exists to protect: measurement integrity.

**What I expected:** either run resolves the adopted skill path, or it
refuses ("bundle has no output/ to install") with exit 3.

**Workaround:** `mkdir output && cp SKILL.md output/SKILL.md` — after which
the skill appeared in the agent's skill list. But now I have two copies of
SKILL.md to keep in sync by hand, and `status` permanently reports
`drift: output-hand-edited`.

**Proposed improvement:** make `run` honor `.skillmaker-adopt.json`'s
`skillPath`, and hard-fail when the resolved skill payload is empty. A
post-run assertion ("skill visible in session: yes/no") in run.json would
make this class of silent failure impossible.

## F3 — P1 — A duplicate journal event bricked the entire workspace

**What happened:** after my output/ workaround, `run` auto-recorded a
version whose content hash equaled the adopt-time version. The manual
`version record` command refuses exactly this ("already recorded under a
different label"), but run's auto-record appended it anyway. From then on
every index-touching command — `list`, `status`, `reindex`,
`measurements` — died with `could not write .skillmaker/studio.db`.

**What I expected:** commands that share one journal to share one
idempotency guard; and a broken index to never take `list` down.

**The error UX made it worse (see F4).** Since the journal is append-only
by design, the product offered no recovery path at all. I had to back up
`events.jsonl` and hand-delete the duplicate line — violating the
product's own core rule — to get my workspace back.

**Proposed improvement:** (a) route auto-record through the same
idempotency check as `version record`; (b) make the indexer tolerate — or
at minimum skip-and-warn on — journal lines it can't ingest; (c) add
`skillmaker doctor` for "index won't build" situations.

## F4 — P2 — "could not write studio.db" is the only error the indexer knows

**What happened:** the F3 failure surfaced as a file-write error. It was
not a write error — the file was created fine (I deleted it; the failing
command recreated it). No stack, no offending event id, no hint, and
`--json` returns the same one-liner. I burned ~10 minutes on permissions,
locks, and stray processes before bisecting the journal by hand.

**Proposed improvement:** propagate the real exception (constraint
violation + event id + line number) and add a `--verbose` flag. An
append-only-journal product must treat "indexer rejected an event" as a
first-class, precisely-reported condition.

## F5 — P2 — Adopted bundles land at stage `idea`, and there's no CLI way out

**What happened:** three mature, in-daily-use skills adopted as
`idea/working` — the earliest stage, pre-research. `advance` correctly
refuses without an approved review; `review request` works, but the CLI has
no `review resolve/approve`. So resolution lives in the viewer only: a
CLI-first product whose docs tout "two doors, one journal" has a
one-door state machine. (Grading, to its credit, genuinely has both doors —
`grade` worked fine; though the fixture "checks" checkboxes the docs
mention have no CLI flag either.)

**Proposed improvement:** `adopt --stage <stage>` (or infer: has output +
in use ⇒ at least `drafting`), plus `review resolve <slug> --decision
approve` in the CLI.

## F6 — P2 — The eval sandbox isn't a sandbox: my personal ~/.claude skills leaked in

**What happened:** the run transcript shows my machine-global skills
(Railway deploy, effect-ts, meeting tools…) in the eval agent's available
skill list. So measurements depend on whatever is installed in the
operator's home directory — unreproducible across machines and a
contamination channel the "measurements stay honest" story doesn't mention.

**Proposed improvement:** launch the ACP agent with an isolated config
home (or document loudly that runs inherit user-level agent config).

## F7 — P2 — Nothing tells you the agent never *read* your skill

**What happened:** in the runs where the skill was correctly installed, the
agent still never invoked it — only the frontmatter `description` entered
context via the skill list. My v2 body edit ("Refs #123, never Fixes")
measurably changed nothing because bodies only matter if the skill is
invoked. I diagnosed this by grepping transcript.jsonl myself. This is
gold — exactly what a skill-eval product should surface — and today it's
invisible unless you know ACP internals. (The `trigger` fixture class hints
the team knows; nothing connects it to run output.)

**Proposed improvement:** run.json should record `skillInstalled: bool`
and `skillInvoked: bool`, and `measurements` could annotate cells where
the skill was never invoked. That single field would have explained all
five of my grades instantly.

## F8 — P3 — Measurements have no "partial" column

**What happened:** v1 = {fail, partial}, v2 = {partial, partial}. Both
cells read `N 2, PASS% 0` — a real fail→partial improvement is invisible
in the table I'm supposed to compare versions with. Verdicts support
partial; measurements don't show it.

**Proposed improvement:** add partial% (or pass/partial/fail counts) to
the cell display.

## F9 — P3 — Version/drift bookkeeping is baffling on adopted bundles

**What happened:** immediately after adopt (no edits by me), the first run
auto-recorded a *different* version hash (`4f53cda…`) than adopt had
(`76062d…`), and `status` reported `drift: output-hand-edited` when I had
edited nothing. After the output/ workaround, drift stayed
`output-hand-edited` forever even with the copies in sync. I still don't
know what "output" hashes over for an in-place bundle. Each concept
(hash-bound versions, drift) is great; their behavior on the adopt path
reads like noise, which teaches users to ignore drift warnings.

**Proposed improvement:** define and document version/drift semantics for
`layout: in-place` bundles; `status` should say *which file* drifted.

## F10 — P3 — Small stuff

- `skillmaker --version` doesn't exist; the installer's tarball name is
  the only place the version appears. (`unknown command "--version"`.)
- Installer requires manual PATH export; fine, but it says "open a new
  shell" rather than offering to append to the profile.
- `fixture add` scaffolds near-empty templates (one HTML comment each) —
  no example prompt/answer-key shape, no mention of how to define the
  "checks" that the grading docs reference. I wrote mine from the docs'
  prose.
- The `version record` idempotency refusal dumps a 100+-char idempotency
  key at the user and exits 1 even though the state is exactly what I
  wanted ("content unchanged" feels like exit 0 with a note).
- `run` prints progress as bare dots with no elapsed time; "auto-approved
  a permission request" with no detail of *what* was approved is a little
  chilling in an eval harness.
- Docs don't document the viewer's HTTP API at all; I found `/api/catalog`
  and `/api/bundles/<slug>` by guessing. `/api/board` and `/api/report`
  don't exist (the "board" is client-rendered, so curl users get nothing).

## Delights (credit where due)

- `adopt` itself (in source builds) is excellent: 3/3 in place, nothing
  moved, nonstandard frontmatter preserved with a precise warning
  (`notes_style preserved, not applied`), idempotent on re-run.
- The docs pre-warned the exact asdf/bun PATH failure I then hit, with the
  exact fix (`ASDF_BUN_VERSION`). Rare and appreciated.
- Run records are genuinely great: immutable `runs/<id>/` with run.json +
  full ACP transcript + artifacts made every one of my diagnoses possible.
- Measurement cells keyed on version hash worked exactly as advertised —
  v2 started at n=0, no pooling — and the sub-5-run "(below smoke)" tag is
  honest in a way most eval tooling isn't.
- `advance`'s guard refusal message says precisely what event is missing.

## Measurements achieved (commit-message / golden-basic / claude-code/default)

| Version | n | pass% | partial | fail | Note |
|---|---|---|---|---|---|
| `4f53cda…` (accidental, no skill) | 1 | 0% | 0 | 1 | agent ran naked (F2) |
| `76062d…` "v1" | 2 | 0% | 1 | 1 | subject-length + Refs misses |
| `116fe2c…` "v2" | 2 | 0% | 2 | 0 | subject fixed; Refs unreachable (F7) |
