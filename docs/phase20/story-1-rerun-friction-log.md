# Story 1 (rerun) — Friction log

Persona: personal-skills-repo maintainer, macOS arm64, v0.2.1 via the public
installer, fresh scratch HOME. Full journey: install → build 3-skill repo →
init/adopt → viewer → fixture → k=3 runs → grade → iterate skill → re-version →
k=3 runs → compare.

Timings: install 0.8s end-to-end. `init` 0.06s, `adopt` 0.09s (3/3 adopted).
Eval runs 55–80s each on claude-code (Opus 4.6). Baseline cell: n=3, 67%,
CI [21%, 94%]. v2 cell: n=3, 100%, CI [44%, 100%]. Total story ~75 min.

## Findings

### F1. Adapter spawn failure reports "code 126" with empty stderr — no why

- What happened: first `skillmaker run` died instantly:
  `adapter exited immediately (code 126) before handshake. stderr:` (nothing).
  Root cause was my environment (asdf npx shim unusable under the scratch
  HOME), but the product gave me zero to go on; time-to-why was ~4 minutes of
  manually running `npx` myself.
- Expected: when the provider process exits pre-handshake with a spawn-ish
  code (126/127), say so: "provider command `npx …` could not be executed —
  check that node/npx is installed and on PATH". Also capture the shell-level
  spawn error, not just child stderr.
- Severity: Medium (High for anyone less used to exit-code archaeology; this
  is the very first `run` a new user executes).
- Proposal: special-case exit 126/127 and empty-stderr-pre-handshake with a
  provider-command diagnostic; print the resolved command line it tried.

### F2. Adopted, shipping skills land in the "idea" stage

- What happened: my three skills — in daily use for years — adopt into
  `idea/working`, the leftmost board column. The board tells me my production
  toolkit is three ideas. Getting them to "published" means walking every
  gate (research → draft → evaluate → review) for skills that already shipped.
- Expected: adoption to acknowledge reality — e.g. an `adopted` substate, or
  land in `drafting`/`evaluating`, or an explicit choice at adopt time.
- Severity: Medium. Nothing breaks, but the org model contradicts the user's
  reality on day one, and the docs' adoption page never mentions stage
  placement at all.
- Proposal: `adopt --stage <stage>` (guard-journaled), and document where
  adopted bundles land and why.

### F3. No repeat/batch flag on `run`, and grading is UUID copy-paste

- What happened: the product's own measurement guidance says n≥5 is "smoke",
  n≥30 is an "estimate" — but every run is one CLI invocation, and every grade
  is `grade <slug> <36-char-uuid> --verdict …`. k=3 across two versions was 6
  runs + 6 grades of UUID shuttling. There's also no `runs list <slug>` to
  recover ids (I scraped run output and the runs/ dir; the viewer has them).
- Expected: `run <slug> --fixture <case> -n 3`, and either `grade --last` /
  short-id prefixes, or a `runs list` with ungraded-first ordering.
- Severity: Medium-High for the core loop — this is the friction that will
  stop people short of n=5, never mind n=30.
- Proposal: `-n <count>` on run (sequential is fine), unique-prefix run-id
  matching on grade, and a `runs <slug>` listing command.

### F4. `--risks` accepted with no risk map, and CLI coverage line explains nothing

- What happened: `fixture add … --risks OUT-1` succeeded silently with no
  `evals/risk-map.md` in existence. `status` then shows
  `coverage: 0 covered, 0 partial, 0 gap` with no hint why the fixture's
  risk tag bought nothing. The docs promise unbanded risk ids "surface as
  warnings". The viewer does better: "No risk-map.md authored yet."
- Expected: the documented warning at `fixture add` time, and a
  `coverage: (no risk-map.md)` annotation in `status`.
- Severity: Low-Medium (docs/product mismatch plus a silent no-op).
- Proposal: emit the promised warning; make the CLI coverage line say what
  the viewer says.

### F5. Landing page still advertises v0.1.0 Pre-alpha

- What happened: skillmaker.studio says "v0.1.0 (Pre-alpha)" while the
  installer (correctly) fetched v0.2.1. I trusted the installer only because
  it prints the resolved version.
- Expected: the site version badge to track the latest release.
- Severity: Low (but it's the first impression, and it made me double-check
  everything else the site claimed).
- Proposal: derive the badge from the GitHub latest-release API at build or
  render time.

### F6. Board header said "0 bundles" while showing 3 cards

- What happened: first viewer load after `start` rendered the board with 3
  bundle cards but "0 bundles" in the header; it corrected after switching
  tabs.
- Expected: one source of truth for the count.
- Severity: Low (cosmetic, transient).
- Proposal: drive header count from the same fetch as the board columns.

### F7. Deep links render the Board regardless of URL until a tab is clicked

- What happened: navigating directly to `http://localhost:4323/catalog`
  showed the Board view (Board tab highlighted) with `/catalog` in the URL
  bar; clicking Catalog then rendered it.
- Expected: URL to drive the initial view.
- Severity: Low today; Medium once people share viewer links in PRs.
- Proposal: initialize router state from location on first render.

### F8. `--version` isn't a command

- What happened: `skillmaker --version` → `unknown command "--version"`,
  exit 2, plus a full help dump. Every bug report starts with a version
  string; the binary knows it (the installer printed `0.2.1+74c66f9`).
- Expected: `--version`/`-v` prints the version.
- Severity: Low.
- Proposal: add it; also put the version in `--help`'s first line.

### F9. Drift is structurally meaningless for adopted bundles (unflagged)

- What happened: adopted bundles have no `design.md`; the design hash is the
  empty-string sha256 and drift reads "in-sync" forever. That's the feature
  reporting a green state it cannot actually measure.
- Expected: `drift: n/a (no design.md)` or similar.
- Severity: Low-Medium — "in-sync" is exactly the kind of false comfort this
  product exists to eliminate.
- Proposal: distinguish "no design authored" from "in sync" in status, API,
  and viewer.

### F10. Provider/model label is a marketing string in the measurements table

- What happened: the PROVIDER column renders
  `claude-code/Opus 4.6 · Most capable for complex work`, blowing out table
  width; presumably the ACP-advertised display name is stored raw. It also
  makes the measurement-cell key fragile — if the adapter reworded its
  blurb, my history would split into a new bucket.
- Expected: a stable short model id (`opus-4.6`) as the cell key and label.
- Severity: Low (cosmetic) / Medium (bucket-key fragility, if real).
- Proposal: key cells on model id, keep display names as display only.

### Delights (so the praise is on the record)

- Install is genuinely one command and sub-second; the binary works offline
  from `~/.skillmaker/bin` with zero dependencies.
- `adopt` did exactly what the docs promise: 3/3, no file moves, idempotent
  re-run, nonstandard frontmatter preserved with precise warnings
  (`"author" preserved, not applied`) — and my missing-description skill
  degraded gracefully (empty one-liner, no crash).
- The auth failure message is the best I've seen in this genre: it names the
  two exact credential locations it checked and the command to fix it. Exit
  code 3 kept both infra failures out of my pass rates, exactly as
  documented.
- The measurements table is the product thesis in one screen: adopted 67%
  [21%, 94%] vs v2 100% [44%, 100%], both labeled "(below smoke)" so I don't
  over-trust n=3. The CI math even matches the docs' worked example.
- `version record` on an adopted bundle "just worked", and the new version
  started a fresh bucket at n=0 as promised.
- Run artifacts are honest and complete: transcript.jsonl, response.md,
  workspace-diff artifacts, and a `skillInvoked` flag that would have caught
  a skill that never fired.

### Usage limits

Not hit: 8 runs on claude-code completed without rate/usage-limit UX
appearing, so that path is unobserved in this story.
