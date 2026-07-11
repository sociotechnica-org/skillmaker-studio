# Story 3 Friction Log — adopt two public skills, make them mine, prove it

Persona: senior engineer who vendors specific skills from repos he admires
(mattpocock/skills `engineering/code-review`, EveryInc/compound-engineering-plugin
`ce-commit`), personalizes them, and wants receipts that the edits didn't
break them. Environment: macOS arm64, fresh scratch HOME, installer v0.2.0
(`0.2.0+95560ec`), workspace `~/Documents/code/sm-story3-personal`.

Severity scale: P1 blocks or silently corrupts the core promise; P2 costs
real time or trust; P3 papercut.

---

## F1 (P1) — `version record` hashes nothing for in-place adopted bundles

The core "make it mine, with receipts" beat is broken. After personalizing
both SKILL.md files I ran `version record <slug> --label jess-v1`. Both
bundles — with completely different content — recorded the **same** hash
`sha256:4f53cda18c2b`, which is literally `sha256("[]")`: the empty file
set. `version record` hashes `design.md` + `output/`, and an in-place
adopted bundle has neither — its content is `SKILL.md` at the bundle root.

Worse, the failure is silent and then actively lies: after appending a real
content change to SKILL.md, `version record` refused with "a version was
already recorded for this exact content -- content is unchanged". It is
unchanged only in the sense that zero files are still zero files.

Meanwhile `adopt` and `run` both compute the *correct* content hash
(`status` shows `output: sha256:6c82ba…` and runs auto-record real hashes).
So the product has two version-hashing code paths that disagree, and the
user-facing one is the broken one — exactly on the adopt flow that v0.2.0's
CLI advertises.

Proposal: make `version record` hash the same content set `adopt`/`run`
hash (the adopt layout's `skillPath` plus design doc when present), and
error loudly if the computed file set is empty rather than minting
sha256("[]") receipts.

## F2 (P1) — artifact capture crashes on transient files and the run is lost

Three consecutive `run code-review` sessions (sub-agent-heavy, ~3-4 min)
completed agent-side, then skillmaker crashed during workspace capture:

    Error: ENOENT ... .skillmaker-sandbox-config/shell-snapshots/snapshot-zsh-….sh
    at copyPreservingPath ...

Claude Code deletes its transient shell-snapshot files while skillmaker is
crawling the workspace; `copyPreservingPath` has no ENOENT tolerance. The
blast radius is the whole run: `run.json` is left truncated mid-write with
`"status": "running"`, the journal keeps a dangling `run.started` with no
terminal event, and — see F3 — the run can never be graded, even though the
full transcript survived and contained a flawless review. Short runs
(ce-commit, ~30s) never hit it; long runs hit it 3/3. The v0.2.0 notes say
"sandbox isolation" and "error clarity" were just fixed; this is the next
bug in that same seam.

Proposal: tolerate ENOENT/disappearing files during capture (skip, don't
throw), exclude the provider's own config dir (`.skillmaker-sandbox-config/`)
from workspace diffing entirely, and write `run.json` atomically
(temp + rename) so a crash never leaves corrupt state.

## F3 (P2) — no escape hatch for a run stuck in "running"

`grade` on a crashed run: `status is "running", not "completed"
(infra-error/running runs are never graded)`. Reasonable policy — except
nothing can ever move that run out of "running". No `run repair`, no
`run abandon`, no re-derive-from-transcript. The evidence (full transcript
with a passing report) exists on disk and the measurement system refuses it
forever, while the journal accumulates zombie `run.started` events.

Proposal: a `run reconcile` (or `reindex`-time sweep) that terminal-states
orphaned runs from their transcripts, plus allow `grade --force` with a
journaled caveat for runs whose transcript is intact.

## F4 (P2) — provider auth is undocumented and sandbox-hostile

First real run: `infra-error (4 session update(s), skill NOT invoked)`. The
actual cause — `Authentication required` from claude-code-acp — appears
only in the run dir's `stderr.txt`, not in the CLI summary. Neither the
docs site nor `docs.skillmaker.studio/cli/run/` says one word about how to
authenticate a provider. The sandbox-home isolation (a v0.2.0 feature)
hides both my keychain-backed `claude` login state and the parent env, so
there is *no supported way* to auth at all on a machine that uses normal
`claude login`. I got unblocked only by writing a wrapper script that pulls
the OAuth token out of the macOS keychain and exec's claude-code-acp — a
thing no fresh user should have to invent (~20 minutes).

Proposal: surface the provider's stderr error class in the CLI failure
line ("infra-error: provider reported 'Authentication required' — see
docs → Provider auth"); document auth per provider; and let the sandbox
pass through an allowlist (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY) or
copy the host's credential state read-only.

## F5 (P2) — adopt records no upstream provenance

The product question I came with. `adopt` was genuinely pleasant (found
both SKILL.md files, wrapped in place, journaled, baseline "adopted"
version with a real content hash, and `status` shows honest
`drift: output-hand-edited` after my edits — that drift signal is the
delight of the story). But nothing anywhere records **where the skills
came from**: `.skillmaker-adopt.json` has `adoptedAt`, `layout`,
`skillPath`, frontmatter — no source repo, no upstream commit, and `adopt`
takes no `--source`/`--from` flag and asks nothing. For a tool whose whole
pitch is receipts, the ancestry receipt is missing; my provenance lives in
a hand-written `skills/VENDORED.md` and a git commit message, invisible to
`status`, the journal, and the viewer. "Drift vs upstream" is therefore
unanswerable by the product, only drift vs adopt-time.

Proposal: optional `adopt --source <url>[@<rev>]` (or prompt) persisted in
`.skillmaker-adopt.json` and the `bundle.created` payload, shown by
`status`; a later `skillmaker upstream diff` can build on it.

## F6 (P2) — fixture workspaces that are git repos fight the host repo, and their results are invisible

Both of my skills operate *on a git repo*, so each fixture's `files/` must
contain one. Two walls: (a) the outer repo can't track an embedded repo —
`git add` records a gitlink and warns; my fixtures' workspaces are now
gitignored, i.e. the eval inputs aren't versioned, in a product built on
"files + journal in git". `case.json`'s `setup` supports files/env but no
setup command that could materialize a repo at run time. (b) On the other
end, a committed result is invisible: the run's `artifacts/` diff captured
nothing for ce-commit because the skill's entire effect lives in `.git/`
(and the sandbox config noise was the only "artifact"). I graded every run
from the raw transcript instead of the workspace state the answer key
targets.

Proposal: support a fixture `setup.sh` (journaled, run before the agent),
and include `.git` state — or at least `git log -p` output — in the
workspace diff so repo-effecting skills are gradeable from artifacts.

## F7 (P3) — bundle identity goes stale the moment you personalize

I rewrote both descriptions in SKILL.md frontmatter; `status` and `list`
still show the upstream description (`bundle.json` snapshot from adopt
time), even after `reindex`. So the catalog describes Matt's process while
the skill implements mine.

Proposal: re-derive `oneLiner`/`name` from SKILL.md frontmatter on
`reindex`, or flag the mismatch in `status`.

## F8 (P3) — measurement CI is degenerate and the version column is ambiguous

`measurements` for 3/3 passes shows `CI [0%, 100%]` — a Wilson interval
would be ~[44%, 100%]; [0%, 100%] carries zero information and reads like a
placeholder. The "(below smoke)" guidance is honest and genuinely good —
it told me n=3 is still below their smoke bar. Also the VERSION column
shows the run-time auto-recorded content hash, which never matches
anything `version record` produced (see F1), so "which version did I
measure" has two inconsistent answers.

Proposal: compute a real binomial interval, and unify version hashes with F1.

## F9 (P3) — no `--version` flag; papercuts around identity

`skillmaker --version` → `unknown command`. To know what the installer
gave me I had to read the tarball name in the install output. For a product
that just shipped a version-completeness fix, the binary should say what it
is.

## Delights (recorded honestly)

- Install was one command and delivered a complete v0.2.0 binary — every
  command in the docs' CLI reference exists (the story-2 era gap is fixed).
- `adopt` on a vendored subset: zero config, in-place, idempotent
  (`skipped 0 (already adopted)` messaging), and it journaled a baseline
  version with a real content hash.
- `drift: output-hand-edited` in `status` is exactly the right signal at
  exactly the right moment — it noticed my personalization before I told
  it anything.
- `fixture add` scaffolding matches the docs' promised shape precisely;
  `run` auto-pinning a content version before first run is the right
  reproducibility default.
- The run summary's `invoked: yes/no (transcript shows...)` activation
  signal is a genuinely useful discriminator — it caught that my first
  auth-failed session never touched the skill.

## Measurement summary

| Skill (upstream) | Fixture | Provider | k | Pass | Verdict |
| --- | --- | --- | --- | --- | --- |
| code-review (mattpocock/skills @ 391a270) | spec-first-review (golden) | claude-code/default | 3 | 3/3 | pass |
| ce-commit (EveryInc/compound-engineering-plugin @ 7f86be9) | house-style-commit (golden) | claude-code/default | 3 | 3/3 | pass |

Plus one crashed-but-recovered code-review run whose transcript also met
all six criteria; the product refused the grade (F3), so it is not in the
table.
