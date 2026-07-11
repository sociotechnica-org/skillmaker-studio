# Phase 20 — Story 4 Expectation: Shared Skills Marketplace

Written BEFORE touching the product, from https://skillmaker.studio and
https://docs.skillmaker.studio only.

## Who I am

I lead a small team. I want to take one skill ("standup-summary": turns a
bullet list of updates into a crisp standup post) through Skillmaker Studio's
full promised loop and publish it as a shared marketplace my teammates can
add with `claude plugin marketplace add`.

## What the marketing promises

- "Idea → researching → drafting → evaluating → published", each stage with
  guarded gates and human approvals.
- Design rationale as a first-class artifact; fixtures organized by failure
  class; "honest math" evals bound to specific content versions; everything
  git-tracked in an append-only journal.
- Publishing to git directories or marketplace manifests, including a
  Claude-format marketplace manifest ("known, documented format").

## The exact path I expect to follow

1. **Install**: `curl -fsSL https://skillmaker.studio/install.sh | sh`
   installs a binary to `~/.skillmaker/bin` (macOS arm64 supported). If the
   released binary lacks newer commands, fall back to from-source:
   `bun install` in the repo, then
   `alias skillmaker="bun <repo>/packages/cli/src/main.ts"`, with
   `bun run build:viewer` before `skillmaker start`.
2. **Workspace**: `mkdir sm-story4-marketplace && git init`, then
   `skillmaker init` → creates `skillmaker.config.json` and
   `.skillmaker/events.jsonl`.
3. **New skill**: `skillmaker new standup-summary` → scaffolds
   `skills/standup-summary/` with `bundle.json`, `design.md`,
   `stations.json`, research/evals/output dirs. Starts at stage `idea`,
   substate `working`.
4. **Stage advancement**: at each stage do the work (design.md, research
   notes, drafted `output/SKILL.md`), then
   `skillmaker review request standup-summary --question "..."` →
   `awaiting-review`. Resolution "happens in the viewer's review panel"
   (`skillmaker start`, port 4323) — I expect to approve my own reviews
   there as the team lead. Then `skillmaker advance standup-summary` moves
   one stage forward.
5. **Evals**: `skillmaker fixture add standup-summary <case> --class golden
   --risks IN-1` → `evals/fixtures/<case>/` with `case.json`, `prompt.md`,
   `files/`, `expected/answer-key.md` (rubric hidden from the agent). Fill
   `evals/risk-map.md` (risk families IN/RE/OUT/ADV/CHN; no results column).
   Then `skillmaker run standup-summary --fixture <case>` (provider defaults
   to `claude-code`) three times (k=3 — I saw no `--k` flag documented, so I
   expect to invoke run 3x). Grade each honestly:
   `skillmaker grade standup-summary <runId> --verdict pass|fail|partial
   --notes ...`. Check `skillmaker measurements standup-summary` for n, pass
   rate, CI, guidance.
6. **Publish gate**: `evaluating → published` requires an approved review
   AND an approved publish gate (`bundle.gate_decided`, gate `"publish"`).
   The docs do NOT say which command records the gate decision — I expect
   it's in the viewer's guided publish flow. I will cite my measured numbers
   in the gate decision.
7. **Publish**: add to `skillmaker.config.json`:
   `"publishTargets": [{ "id": "team-marketplace", "kind":
   "claude-marketplace" }]` (path defaults to workspace root), then
   `skillmaker publish standup-summary`. Requires stage `published` and
   drift `in-sync` (version hash matches files; `skillmaker version record`
   if needed).
8. **Ship**: `gh repo create sociotechnica-org/sm-story4-marketplace
   --public --source . --push`. The repo IS the marketplace.
9. **Consumer**: a teammate runs
   `claude plugin marketplace add sociotechnica-org/sm-story4-marketplace`
   and can see/install the standup-summary skill in the plugin browser with
   a sensible name and description.

## What I expect to be true if the product delivers

- Every transition refused until its review is approved; the refusals have
  clear error messages telling me what to do next.
- The eval loop gives me real numbers (3 runs, pass rate, CI) tied to a
  version hash, and the publish gate makes me cite them.
- The published manifest is a valid Claude marketplace
  (`.claude-plugin/marketplace.json` is my guess — docs don't name the
  file) that `claude plugin marketplace add` accepts without hand-editing.
- The whole audit trail (journal, runs, grades, gate) is in git and
  survives the push.

## Known risks going in

- Released binary may lack newer commands (another tester hit this).
- Review resolution and possibly the publish gate are viewer-only — an
  automation/CI story may not exist.
- No documented `--k` flag for repeated runs; no documented file name for
  the Claude marketplace manifest.
