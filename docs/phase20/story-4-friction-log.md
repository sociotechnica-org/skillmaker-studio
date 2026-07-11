# Phase 20 — Story 4 Friction Log: Marketplace Publisher

Persona: team lead publishing a shared skills marketplace. Full loop lived
on 2026-07-11: install → new repo → standup-summary through
idea→researching→drafting→evaluating→published → `.claude-plugin/
marketplace.json` → public repo → teammate install → skill fires.

Severity: P1 blocks the promised flow, P2 costs real time/trust, P3 polish.

## Findings

1. **[P1] Released binary lacks `publish` (and `adopt`, `book build`).**
   `curl -fsSL https://skillmaker.studio/install.sh | sh` installs
   v0.1.0+0df50e0; `skillmaker publish` → `skillmaker: unknown command
   "publish"` (exit 2). The marketing site's whole pitch ends at
   marketplace publishing, and the one-command install can't do it; docs
   document commands the release doesn't have. Proposed: cut a release on
   every docs deploy, or version-stamp docs and make the site's install
   section say which commands the current release includes.

2. **[P2] Review approval clicks silently don't register while the page is
   hydrating.** Three separate times, clicking Approve immediately after
   load produced no `review.resolved` event and no UI feedback; `advance`
   then failed with the guard error and I had to re-click. >30s confusion
   the first time (state said awaiting-review while I believed I'd
   approved). Proposed: disable the button until hydrated, and show a
   toast/optimistic substate change on success.

3. **[P2] No CLI/API story for resolving reviews — solo users must
   round-trip through the viewer for every stage.** Four times per skill I
   had to leave the terminal, open the board, click Approve, and come back
   to run `advance`. Fine for a real two-person review, hostile to the
   solo/self-review case and to any CI automation. Proposed: `skillmaker
   review resolve <slug> --approve --notes ...` (journaled with actor), or
   at least document the POST endpoint the viewer uses.

4. **[P2] The generated marketplace manifest is bare to the point of
   anonymity on the consumer side.** `.claude-plugin/marketplace.json`
   names the plugin `skills` (generic), `owner.name` is just the repo
   name, and there's no description or version — the bundle's `oneLiner`,
   `tags`, and recorded version label (`v2`) all exist and none of them
   flow through. Teammate sees plugin "skills", Version `419bb565ddf1`
   (a hash, not `v2`). Also no README is generated for the repo that "IS
   the marketplace". Proposed: map bundle name/oneLiner/tags/version-label
   into the manifest and offer a `--plugin-name`; generate a marketplace
   README listing published skills with their eval numbers — that's the
   product's own best selling point.

5. **[P2] Run artifacts hide the agent's answer — grading means reading
   raw JSONL.** A run dir has only `run.json` + `transcript.jsonl`
   (ACP protocol frames). To grade against the answer key I had to write
   a jq/python extractor for `agent_message_chunk` texts. The viewer may
   render it, but the CLI loop (`run` → `grade`) gives no way to see what
   you're grading. Proposed: write `response.md` (final agent message)
   into the run dir and print its path in `skillmaker run` output.

6. **[P3] Confidence intervals look wrong at the extremes.** 3/3 passes
   reports `100% [0%, 100%]` — an interval that contains 0% for a fixture
   that never failed reads as a bug and undermines the "honest math"
   pitch (Wilson 95% for 3/3 is ≈[44%, 100%]). The `(below smoke)`
   guidance label is also unexplained anywhere in CLI output. Proposed:
   fix/label the interval method; make guidance self-describing ("n<5:
   below smoke threshold — collect more runs").

7. **[P3] `bun`-from-source path trips over asdf in *other* directories.**
   The alias runs bun in the workspace cwd, so asdf demanded a bun version
   pin in my brand-new skills repo (`No version is set for command bun`).
   The install docs do mention `ASDF_BUN_VERSION=1.3.11` — credit — but
   it's easy to miss and the error appears in a repo that has nothing to
   do with bun. Proposed: ship the compiled binary as the primary path
   (see #1) and mention the asdf caveat in first-bundle docs too.

8. **[P3] Board header count lagged reality.** With one bundle created and
   on the board, the header read "0 bundles" until some later refresh
   ("1 bundle" appeared after navigation). Minor trust ding on first run.

9. **[P3] Docs gaps I hit exactly where the docs stop.** The first-bundle
   guide ends before reviews/advance; how the publish gate decision is
   recorded is documented nowhere (I found the "Approve gate & publish"
   panel by poking the Overview tab); the Claude manifest is called "a
   known, documented format" but its filename/shape is never shown; no
   `--k`/repeat flag documented (or present) for k>1 runs — you invoke
   `run` k times by hand. Proposed: extend the walkthrough through one
   full publish, document the gate panel, show a sample manifest, add
   `--repeat <k>`.

## Delights

- The publish gate is real: "Approve gate & publish" refuses without an
  evidence basis, and the basis lands in the journal (`bundle.gate_decided`)
  next to `bundle.stage_changed`. The guard errors from `advance` are
  precise and quote exactly which event is missing.
- Measurements are genuinely version-bound: after editing SKILL.md, new
  runs auto-attached to the new hash and old numbers stayed with v1 —
  the 33%→67% improvement story fell out of the tool, not my notes.
- `run` sandboxing (temp workspace seeded from `files/`, skill installed
  from `output/`) worked first try, three-for-three fixtures, and the
  auto-`version record` before the first run is exactly the right default.
- Consumer side: `claude plugin marketplace add
  sociotechnica-org/sm-story4-marketplace` → install → the skill fired
  unprompted on a natural request and produced the exact format. Zero
  hand-editing of the manifest needed.

## Where interactivity forced a stop (consumer side)

`claude plugin marketplace add/list`, `plugin install`, `plugin details`,
and a headless `claude -p` smoke test all worked non-interactively. Only
the `/plugin` browsing UI (visual marketplace browsing) requires an
interactive session. `claude plugin marketplace info` doesn't exist
(unknown command); `details` covers it.

## Measurements (for the record)

- v1 `sha256:73d4c72abde7`: golden-basic 1 pass / 2 partial = 33%
  [6%, 79%] n=3; empty-input 3 pass = 100% n=3.
- v2 `sha256:f4826bb91e78` (strengthened no-preamble rule): golden-basic
  2 pass / 1 partial = 67% [21%, 94%] n=3; empty-input 3 pass = 100% n=3.
- Residual v2 failure: cosmetic "Let me use the standup skill…" narration
  preamble in 1/3 runs; content correct in 6/6 golden runs across versions.
- Wall-clock per eval run: ~15–25s on claude-code/default (Opus 4.6).
